/* Optional QA dependency only: Playwright. The application has no JS dependencies. */
const { chromium } = require(process.env.PQE_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash}=require('node:crypto');
const url = process.env.PQE_URL || 'http://127.0.0.1:8765';
const out = process.env.PQE_SCREENSHOTS || path.resolve(__dirname,'../docs/screenshots');
fs.mkdirSync(out,{recursive:true});
const errors=[], external=[], checks=[];
const screenshotCount=()=>fs.readdirSync(out).filter(x=>x.endsWith('.png')&&!x.startsWith('failure-')).length;
const headings={overview:/Good /,escrows:'Your agreements',wallet:'Your wallet.',ledger:'The local ledger.',verify:'Verify the evidence.',lab:'Try to break the agreement.',activity:'Every step leaves a trace.',settings:'Settings',help:'A clear path from agreement to payment.'};
async function ready(page){await page.locator('.workspace').waitFor();await page.locator('.loading').waitFor({state:'detached'});}
async function login(page,name='alice',password='demo1234'){
 await page.locator('#username').fill(name);await page.locator('#password').fill(password);
 await page.getByRole('button',{name:'Sign in →',exact:true}).click();
 await ready(page);await page.getByRole('heading',{name:new RegExp('Good .*'+name)}).waitFor();
}
async function consent(page){await page.getByRole('dialog',{name:/\?/}).waitFor();await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();}
async function route(page,key){const target=url+'/#'+key;if(page.url()===target)await page.reload();else await page.goto(target);await ready(page);if(headings[key])await page.getByRole('heading',{name:headings[key],exact:typeof headings[key]==='string'}).waitFor();}
async function shot(page,name){await page.waitForFunction(()=>!document.querySelector('.toast'));await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled'});}
(async()=>{
 const browser=await chromium.launch({headless:true});
 const alice=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
 await alice.addInitScript(()=>{try{if(!localStorage.getItem('pqe-design'))localStorage.setItem('pqe-theme','dark');}catch{}});
 const bob=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});
 const registration=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});
 for(const ctx of [alice,bob,registration]){
  ctx.on('page',page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(url).origin)external.push(r.url());});});
 }
 try{
  const a=await alice.newPage(),b=await bob.newPage(),n=await registration.newPage();
  await a.goto(url);await a.locator('#auth-form').waitFor();
  assert.equal(await a.evaluate(()=>document.documentElement.dataset.theme),'light');
  assert.equal(await a.evaluate(()=>localStorage.getItem('pqe-design')),'finance-2');
  checks.push('Light finance design overrides legacy dark preference and dark device appearance on first visit');
  await shot(a,'desktop-sign-in');
  await a.setViewportSize({width:390,height:844});await shot(a,'mobile-sign-in');
  await a.setViewportSize({width:1440,height:1000});await a.evaluate(()=>document.documentElement.dataset.theme='dark');await shot(a,'dark-sign-in');
  await a.evaluate(()=>document.documentElement.dataset.theme='light');
  await login(a);await shot(a,'desktop-empty-overview');
  await a.setViewportSize({width:390,height:844});await shot(a,'mobile-empty-overview');
  await a.setViewportSize({width:1440,height:1000});await b.goto(url);await login(b,'bob');
  await a.getByRole('button',{name:'＋ Create escrow',exact:true}).click();
  await a.locator('#create-dialog').waitFor({state:'visible'});
  await a.keyboard.press('Escape');
  await a.locator('#create-dialog').waitFor({state:'hidden'});
  await a.getByRole('button',{name:'＋ Create escrow',exact:true}).click();
  await a.locator('#seller').selectOption('bob');await a.locator('#amount').fill('1');
  await a.locator('#description').fill('Editorial identity files, final delivery');
  await shot(a,'desktop-create-details');await a.getByRole('button',{name:'Continue to file check',exact:true}).click();
  const deliveryBytes=Buffer.from('Final identity files. Delivery verified by both parties.\n');
  const expectedHash=createHash('sha256').update(deliveryBytes).digest('hex');
  await a.locator('#expected-file').setInputFiles({name:'expected-identity.txt',mimeType:'text/plain',buffer:deliveryBytes});
  await a.waitForFunction(hash=>document.querySelector('#expected').value===hash,expectedHash);
  assert.equal(await a.locator('#expected').evaluate(el=>el.readOnly),true);
  await shot(a,'desktop-create-file-check');await a.getByRole('button',{name:'Review agreement',exact:true}).click();
  await shot(a,'desktop-create-escrow');
  await a.getByRole('button',{name:'Review and sign terms',exact:true}).click();await consent(a);
  await a.waitForURL(/#escrows\/[0-9a-f]{64}$/);await ready(a);
  const id=a.url().split('/').pop();
  const created=await (await alice.request.get(url+'/api/escrows/'+id)).json();
  assert.equal(created.terms.expected_sha256,expectedHash);assert.equal(created.delivery,null);
  assert.equal(await a.locator('#expected').inputValue(),'');
  assert.equal(await a.locator('#expected-file').evaluate(el=>el.files.length),0);
  checks.push('Creation hashes a local expected file and binds its SHA-256 to signed terms; file selection resets after creation');
  await route(b,'escrows/'+id);await b.getByRole('button',{name:'Agree and sign',exact:true}).click();await consent(b);
  await b.locator('#delivery-file').waitFor();
  await b.locator('#delivery-file').setInputFiles({name:'wrong-delivery.txt',mimeType:'text/plain',buffer:Buffer.from('This is a different file')});
  await b.locator('#delivery-file-status').getByText('Wrong file — delivery blocked',{exact:true}).waitFor();
  assert.equal(await b.getByRole('button',{name:'Send delivery',exact:true}).isDisabled(),true);
  const rejectedUpload=await bob.request.post(url+'/api/escrows/'+id+'/deliver',{data:Buffer.from('This is a different file'),headers:{'X-Requested-With':'PQEscrow','X-Filename':'wrong-delivery.txt'}});
  assert.equal(rejectedUpload.status(),400);
  const unchanged=await (await bob.request.get(url+'/api/escrows/'+id)).json();assert.equal(unchanged.state,'LOCKED');assert.equal(unchanged.delivery,null);
  await shot(b,'desktop-wrong-delivery');
  checks.push('Wrong delivery is blocked before browser signing and rejected by the server without saving; correct-file retry remains available');
  await b.locator('#delivery-file').setInputFiles({name:'identity-delivery.txt',mimeType:'text/plain',buffer:deliveryBytes});
  await b.locator('#delivery-file-status').getByText('Fingerprint matches — ready to deliver',{exact:true}).waitFor();
  await shot(b,'desktop-seller-delivery');
  await b.getByRole('button',{name:'Send delivery',exact:true}).click();await consent(b);
  await b.locator('.file-text').getByText('Hash matches the signed receipt',{exact:false}).waitFor();
  await route(a,'escrows/'+id);await a.getByRole('button',{name:'Go offline',exact:true}).click();
  await a.getByRole('button',{name:'Go online',exact:true}).waitFor();
  await a.getByRole('button',{name:'Release payment',exact:true}).click();await consent(a);
  await a.locator('.instrument .badge.accepted').waitFor();await shot(a,'desktop-offline-release');
  assert.equal(await a.getByRole('button',{name:'Finish payment',exact:true}).isDisabled(),true);
  const offlinePayment=await alice.request.post(url+'/api/reconcile',{data:{},headers:{'X-Requested-With':'PQEscrow'}});assert.equal(offlinePayment.status(),409);
  await a.getByRole('button',{name:'Connect to finish',exact:true}).click();
  await a.getByRole('button',{name:'Go offline',exact:true}).waitFor();
  await a.getByRole('button',{name:'Finish payment',exact:true}).click();
  await a.locator('.instrument .badge.settled').waitFor();
  checks.push('Alice created; Bob countersigned and uploaded; Alice released offline and settled online');
  await route(b,'escrows/'+id);await b.locator('.instrument .badge.settled').waitFor();
  await route(b,'wallet');await b.getByRole('button',{name:'Claim earnings',exact:true}).click();
  await b.getByText('1 test ETH claimed.',{exact:true}).waitFor();
  const wallet=await (await bob.request.get(url+'/api/wallet')).json();
  assert.equal(wallet.funds,'11000000000000000000');assert.equal(wallet.account.claimable,'0');
  checks.push('Counterparty settlement mirrored; Bob claimed exactly 1 ETH');
  for(const mode of ['desktop','mobile','dark']){
   await a.setViewportSize(mode==='mobile'?{width:390,height:844}:{width:1440,height:1000});
   await a.evaluate(theme=>{localStorage.setItem('pqe-theme',theme);if(theme==='device')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;},mode==='dark'?'dark':'light');
   for(const key of Object.keys(headings)){
    await route(a,key);await shot(a,mode+'-'+key);
    assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,mode+' '+key+' page overflow');
   }
   await route(a,'escrows/'+id);await a.locator('.instrument .badge.settled').waitFor();await shot(a,mode+'-detail');
   assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,mode+' detail overflow');
  }
  checks.push('All ten signed-in views captured at 1440px light, 390px mobile, and 1440px dark; no document overflow');
  await route(a,'escrows');
  await a.getByRole('searchbox',{name:'Search agreements',exact:true}).fill('nothing-will-match-this');
  await a.getByRole('heading',{name:'No agreements found.',exact:true}).waitFor();
  assert.equal(await a.locator('#escrow-search').evaluate(el=>el===document.activeElement),true);
  await a.getByRole('button',{name:'Clear filters',exact:true}).click();
  assert.equal(await a.locator('.escrow-table tbody tr').count(),1);
  await a.locator('[data-filter="active"]').click();
  await a.getByRole('heading',{name:'No agreements found.',exact:true}).waitFor();
  await a.locator('[data-filter="settled"]').click();
  assert.equal(await a.locator('.escrow-table tbody tr').count(),1);
  await a.locator('#escrow-search').fill('editorial');
  assert.equal(await a.locator('.escrow-table tbody tr').count(),1);
  await a.getByRole('button',{name:'Toggle light or dark appearance',exact:true}).click();
  assert.equal(await a.evaluate(()=>document.documentElement.dataset.theme),'light');
  await a.getByRole('button',{name:'Toggle light or dark appearance',exact:true}).click();
  assert.equal(await a.evaluate(()=>document.documentElement.dataset.theme),'dark');
  await a.getByRole('button',{name:'Refresh workspace',exact:true}).click();await ready(a);
  await a.getByText('Workspace refreshed.',{exact:true}).waitFor();
  assert.equal(await a.locator('#escrow-search').inputValue(),'');
  await a.reload();await ready(a);
  assert.equal(await a.evaluate(()=>document.documentElement.dataset.theme),'dark');
  checks.push('Explicit appearance selection persists after reloading');
  checks.push('Agreement search, status filters, focus retention, theme switch, refresh, and dialog cancellation passed');
  await route(a,'verify');await a.locator('#verify-file').setInputFiles({name:'check.txt',mimeType:'text/plain',buffer:Buffer.from('independent file')});
  await a.getByRole('button',{name:'Compute SHA-256 locally',exact:true}).click();
  await a.getByText('computed in this browser',{exact:false}).waitFor();
  assert.equal((await a.locator('#file-result .hash').textContent()).length,64);
  const bundle=await (await alice.request.get(url+'/api/escrows/'+id+'/bundle')).body();
  await a.locator('#bundle-file').setInputFiles({name:'bundle.json',mimeType:'application/json',buffer:bundle});
  await a.getByRole('button',{name:'Verify bundle',exact:true}).click();await a.locator('#bundle-result').getByText('RELEASE',{exact:true}).waitFor();
  checks.push('Browser-local file hashing and signed bundle verification worked');
  await route(a,'lab');
  for(const kind of ['file','signature','price','replay','double-spend']){
   await a.locator(`[data-kind="${kind}"]`).click();await a.locator('#attack-'+kind).getByText('✓ Attack blocked',{exact:true}).waitFor();
  }
  checks.push('All five isolated attack lab experiments blocked');
  await n.goto(url);await n.locator('#auth-form').waitFor();
  await n.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await n.locator('#password').getAttribute('type'),'text');
  await n.getByRole('button',{name:'Hide password',exact:true}).click();assert.equal(await n.locator('#password').getAttribute('type'),'password');
  checks.push('Password visibility control passed');
  await n.getByRole('tab',{name:'Create account',exact:true}).click();
  const name='tester_'+Date.now().toString().slice(-10);
  await n.locator('#username').fill(name);await n.locator('#password').fill('short');
  await n.getByRole('button',{name:'Create account →',exact:true}).click();
  assert.equal(await n.locator('#password').evaluate(el=>el.validity.tooShort),true);
  await shot(n,'desktop-registration-validation');
  await n.setViewportSize({width:390,height:844});await shot(n,'mobile-registration-validation');
  await n.setViewportSize({width:1440,height:1000});await n.evaluate(()=>document.documentElement.dataset.theme='dark');await shot(n,'dark-registration-validation');
  await n.evaluate(()=>document.documentElement.dataset.theme='light');
  await n.locator('#password').fill('newpassword123');await n.getByRole('button',{name:'Create account →',exact:true}).click();
  await ready(n);await n.getByRole('heading',{name:new RegExp(name)}).waitFor();
  await n.getByRole('button',{name:'Sign out ↗',exact:true}).click();await n.locator('#auth-form').waitFor();
  checks.push('New account registered; short password blocked; sign out worked');
  for(let i=0;i<12;i++){
   await login(n,name,'newpassword123');
   await n.getByRole('button',{name:'Sign out ↗',exact:true}).click();await n.locator('#auth-form').waitFor();
  }
  checks.push('12 consecutive browser login and logout cycles passed');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:true,checks,consoleErrors:errors,externalRequests:external,screenshots:screenshotCount()},null,2));
  console.log(JSON.stringify({passed:true,checks,screenshots:screenshotCount()},null,2));
 }catch(error){for(const [i,ctx] of [alice,bob,registration].entries())for(const page of ctx.pages())await shot(page,'failure-'+i).catch(()=>{});console.error(error);process.exitCode=1;}
 finally{await browser.close();}
})();
