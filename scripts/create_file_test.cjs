/* Optional browser QA: use seeded accounts and temporary data, never a personal workspace. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const url=process.env.PQE_URL || 'http://127.0.0.1:8765';
const out=process.env.PQE_SCREENSHOTS || path.resolve(__dirname,'../docs/screenshots');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[],errors=[],uploads=[],created=[];
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.method()==='POST')uploads.push({url:request.url(),body:request.postData()});});
  await page.goto(url);await page.locator('#username').fill('carol');await page.locator('#password').fill('demo1234');
  await page.getByRole('button',{name:'Sign in \u2192',exact:true}).click();
  await page.getByRole('heading',{name:/Good .*carol/}).waitFor();
  async function open(){await page.getByRole('button',{name:'\uff0b Create escrow',exact:true}).click();await page.locator('#create-dialog').waitFor({state:'visible'});await page.locator('#seller').selectOption('bob');await page.locator('#description').fill('Expected-file picker QA');await page.getByRole('button',{name:'Continue to file check',exact:true}).click();}
  async function pick(text,name='reference.txt'){
   const buffer=Buffer.from(text);await page.locator('#expected-file').setInputFiles({name,mimeType:'text/plain',buffer});
   await page.waitForFunction(hash=>document.querySelector('#expected').value===hash,sha(buffer));return sha(buffer);
  }
  async function create(expected){
   await page.getByRole('button',{name:'Review agreement',exact:true}).click();
   await page.getByRole('button',{name:'Review and sign terms',exact:true}).click();
   await page.locator('#confirm-dialog').waitFor({state:'visible'});
   if(expected)assert.ok((await page.locator('#confirm-body').textContent()).includes(expected));
   await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();
   await page.waitForURL(/#escrows\/[0-9a-f]{64}$/);await page.locator('.instrument').waitFor();
   const record=await (await context.request.get(url+'/api/escrows/'+page.url().split('/').pop())).json();
   assert.equal(record.terms.expected_sha256??null,expected);assert.equal(record.delivery,null);created.push(record.escrow_id);
   assert.equal(await page.locator('#expected').inputValue(),'');assert.equal(await page.locator('#expected-file').evaluate(el=>el.files.length),0);
   assert.equal(await page.locator('#expected').evaluate(el=>el.readOnly),false);
  }
  await open();let before=uploads.length;
  const first=await pick('local expected content','reference <one>.txt');
  assert.equal(uploads.length,before,'Choosing a file must make no POST request');
  assert.equal(await page.locator('#expected').evaluate(el=>el.readOnly),true);
  assert.ok((await page.locator('#expected-file-name').textContent()).includes('reference <one>.txt'));
  await pick('replacement file');assert.notEqual(await page.locator('#expected').inputValue(),first);
  checks.push('Known SHA-256 matches Node; replacing a file replaces the hash; selection sends no network POST');
  await page.getByRole('button',{name:'Remove file',exact:true}).click();
  assert.equal(await page.locator('#expected').inputValue(),'');assert.equal(await page.locator('#expected').evaluate(el=>el.readOnly),false);
  await pick('');assert.equal(await page.locator('#expected').inputValue(),sha(Buffer.alloc(0)));
  await page.getByRole('button',{name:'Remove file',exact:true}).click();
  checks.push('Remove clears both file and hash; an empty file receives the correct SHA-256');

  // Hold digest completion so older reads can finish after a newer selection.
  await page.evaluate(()=>{
   window.savedDigest=crypto.subtle.digest;window.hashWaiters=[];window.hashFinished=0;
   crypto.subtle.digest=function(...args){const self=this;return new Promise(resolve=>window.hashWaiters.push(()=>resolve(window.savedDigest.apply(self,args)))).then(result=>{window.hashFinished++;return result;});};
  });
  await page.locator('#expected-file').setInputFiles({name:'slow.txt',mimeType:'text/plain',buffer:Buffer.from('slow')});
  await page.waitForFunction(()=>window.hashWaiters.length===1);
  assert.equal(await page.locator('#create-form button[type=submit]').isDisabled(),true);
  await page.locator('#expected-file').setInputFiles({name:'fast.txt',mimeType:'text/plain',buffer:Buffer.from('fast')});
  await page.waitForFunction(()=>window.hashWaiters.length===2);await page.evaluate(()=>window.hashWaiters[1]());
  await page.waitForFunction(hash=>document.querySelector('#expected').value===hash,sha('fast'));
  await page.evaluate(()=>window.hashWaiters[0]());await page.waitForFunction(()=>window.hashFinished===2);
  assert.equal(await page.locator('#expected').inputValue(),sha('fast'));
  await page.locator('#expected-file').setInputFiles({name:'removed.txt',mimeType:'text/plain',buffer:Buffer.from('removed')});
  await page.waitForFunction(()=>window.hashWaiters.length===3);await page.getByRole('button',{name:'Remove file',exact:true}).click();
  await page.evaluate(()=>window.hashWaiters[2]());await page.waitForFunction(()=>window.hashFinished===3);
  assert.equal(await page.locator('#expected').inputValue(),'');
  await page.evaluate(()=>{crypto.subtle.digest=window.savedDigest;});
  checks.push('Signing is disabled while hashing; a late hash cannot replace a newer file or restore a removed file');

  await page.evaluate(()=>{
   const input=document.querySelector('#expected-file'),transfer=new DataTransfer();
   transfer.items.add(new File([new Uint8Array(25*1024*1024+1)],'too-large.bin'));
   input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.locator('#expected-file-status').getByText(/Choose a file up to 25 MB/).waitFor();
  assert.equal(await page.locator('#create-form button[type=submit]').isDisabled(),true);
  await page.getByRole('button',{name:'Remove file',exact:true}).click();
  await page.evaluate(()=>{window.savedDigest=crypto.subtle.digest;crypto.subtle.digest=async()=>{throw Error('Could not read the selected file');};});
  await page.locator('#expected-file').setInputFiles({name:'unreadable.txt',mimeType:'text/plain',buffer:Buffer.from('unreadable')});
  await page.locator('#expected-file-status').getByText('Could not read the selected file',{exact:true}).waitFor();
  assert.equal(await page.locator('#create-form button[type=submit]').isDisabled(),true);
  await page.getByRole('button',{name:'Remove file',exact:true}).click();await page.evaluate(()=>{crypto.subtle.digest=window.savedDigest;});
  checks.push('Oversized files and hashing errors block signing; Remove file recovers the form');

  await create(null);await page.goto(url+'/#overview');await page.getByRole('heading',{name:/Good .*carol/}).waitFor();await open();
  const manual=sha('manually provided fingerprint');await page.locator('#manual-fingerprint summary').click();await page.locator('#expected').fill(manual.toUpperCase());await create(manual);
  await page.goto(url+'/#overview');await page.getByRole('heading',{name:/Good .*carol/}).waitFor();await open();
  const bound=await pick('local file is not uploaded during creation','agreed-file.txt');
  await page.screenshot({path:path.join(out,'desktop-create-file.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#create-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:path.join(out,'mobile-create-file.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:path.join(out,'dark-create-file.png'),fullPage:true});
  await create(bound);
  checks.push('Optional, manual and automatically calculated fingerprints create signed terms correctly and reset after success');
  for(const request of uploads.filter(r=>new URL(r.url).pathname==='/api/escrows')){
   const body=JSON.parse(request.body);assert.deepEqual(Object.keys(body).sort(),['amount_wei','description','expected_sha256','expires_at','seller']);
  }
  assert.deepEqual(errors,[]);
  checks.push('Creation submits only terms and hash; desktop, mobile and dark dialog captures fit; no JavaScript errors');
  fs.writeFileSync(path.join(out,'create-file-results.json'),JSON.stringify({passed:true,checks,createdRecords:created.length,consoleErrors:errors},null,2));
  console.log(JSON.stringify({passed:true,checks},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
