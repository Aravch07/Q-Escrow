/* Real hosted UI checks. Use a disposable DB schema for local runs. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const {randomBytes,createHash}=require('node:crypto');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.PQE_URL||'http://127.0.0.1:8790';
const out=process.env.PQE_SCREENSHOTS||path.resolve(__dirname,'../docs/hosted-checks');
const suffix=randomBytes(3).toString('hex'),buyer='buyer_'+suffix,seller='seller_'+suffix,password=randomBytes(18).toString('base64');
const bytes=randomBytes(Number(process.env.PQE_FILE_MIB||'5')*1024*1024),hash=createHash('sha256').update(bytes).digest('hex');
const checks=[],errors=[],uploads=[];
async function ready(page){await page.locator('.workspace').waitFor();await page.locator('.loading').waitFor({state:'detached'});}
async function route(page,key){const target=url+'/#'+key;if(page.url()===target)await page.reload();else await page.goto(target);await ready(page);const titles={overview:/Good /,escrows:'Your agreements',wallet:'Your wallet.',activity:'Every step leaves a trace.',verify:'Verify the evidence.',ledger:'The local ledger.',lab:'Try to break the agreement.',settings:'Settings',help:'A clear path from agreement to payment.',inbox:'Your inbox'};if(titles[key])await page.getByRole('heading',{name:titles[key],exact:typeof titles[key]==='string'}).waitFor();if(key==='overview')await page.locator('.analytics-widget').waitFor();if(key==='settings')await page.locator('.sessions-card').waitFor();if(key.startsWith('escrows/'))await page.locator('#private-note').waitFor();}
async function signup(page,name){
 await page.goto(url);await page.getByRole('tab',{name:'Create account',exact:true}).click();
 await page.locator('#display-name').fill(name);await page.locator('#username').fill(name);await page.locator('#password').fill(password);await page.locator('#confirm-password').fill(password);
 await page.getByRole('button',{name:'Create account →',exact:true}).click();await ready(page);await page.locator('#inbox-link').waitFor();
}
async function consent(page){await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true});
 const aContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),bContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const a=await aContext.newPage(),b=await bContext.newPage();a.setDefaultTimeout(90000);b.setDefaultTimeout(90000);
 for(const page of [a,b]){page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\/api\/uploads\/[^/]+\/\d+$/.test(new URL(request.url()).pathname))uploads.push(request.postDataBuffer()?.length||0);});}
 try{
  await signup(a,buyer);assert.equal(await a.locator('.demo-chips').count(),0);await a.getByRole('button',{name:'Copy invite link',exact:true}).waitFor();
  await a.screenshot({path:path.join(out,'hosted-new-account.png'),fullPage:true});await signup(b,seller);
  checks.push('New users register with confirmed passwords; shared demo logins are absent; personal workspaces load');
  await route(a,'wallet');await a.locator('#deposit-amount').fill('2');await a.getByRole('button',{name:'Deposit test funds',exact:true}).click();await a.getByText('Test funds deposited and time-locked.',{exact:true}).waitFor();
  await route(a,'overview');await a.getByRole('button',{name:'＋ Create escrow',exact:true}).click();await a.locator('#seller').selectOption(seller);
  await a.locator('#amount').fill('1');await a.locator('#description').fill('Hosted identity package — verified delivery');await a.getByRole('button',{name:'Continue to file check',exact:true}).click();
  await a.locator('#expected-file').setInputFiles({name:'agreed-file.bin',mimeType:'application/octet-stream',buffer:bytes});await a.waitForFunction(hash=>document.querySelector('#expected').value===hash,hash);
  await a.getByRole('button',{name:'Review agreement',exact:true}).click();await a.getByRole('button',{name:'Review and sign terms',exact:true}).click();await consent(a);await a.waitForURL(/#escrows\/[0-9a-f]{64}$/);await ready(a);
  const id=a.url().split('/').pop();await a.locator('#private-note').fill('Private review checklist');await a.getByRole('button',{name:'Save note',exact:true}).click();await a.getByText('Saved just for you.',{exact:true}).waitFor();
  await route(b,'escrows/'+id);await b.getByRole('button',{name:'Agree and sign',exact:true}).click();await consent(b);await b.locator('#delivery-file').waitFor();
  assert.equal(await b.locator('#private-note').inputValue(),'');
  await b.locator('#delivery-file').setInputFiles({name:'wrong.bin',mimeType:'application/octet-stream',buffer:Buffer.from('incorrect file')});await b.getByText('Wrong file — delivery blocked',{exact:true}).waitFor();
  assert.equal(await b.getByRole('button',{name:'Send delivery',exact:true}).isDisabled(),true);
  await b.locator('#delivery-file').setInputFiles({name:'final-delivery.bin',mimeType:'application/octet-stream',buffer:bytes});await b.getByText('Fingerprint matches — ready to deliver',{exact:true}).waitFor();
  await b.getByRole('button',{name:'Send delivery',exact:true}).click();await consent(b);await b.locator('.file-block').waitFor({timeout:180000});
  assert.ok(uploads.length>=Math.ceil(bytes.length/1048576));assert.ok(uploads.every(size=>size<=1048576));
  checks.push(`${bytes.length/1048576} MiB file hashes automatically; wrong file is blocked; delivery uploads in parts of at most 1 MiB`);
  await route(a,'escrows/'+id);assert.equal(await a.locator('#private-note').inputValue(),'Private review checklist');
  const [file]=await Promise.all([a.waitForEvent('download',{timeout:180000}),a.getByRole('link',{name:/Download file/}).click()]);assert.equal(createHash('sha256').update(fs.readFileSync(await file.path())).digest('hex'),hash);
  await a.getByRole('button',{name:'Go offline',exact:true}).click();await a.getByRole('button',{name:'Release payment',exact:true}).click();await consent(a);await a.locator('.instrument .badge.accepted').waitFor();
  assert.equal(await a.getByRole('button',{name:'Finish payment',exact:true}).isDisabled(),true);await a.getByRole('button',{name:'Connect to finish',exact:true}).click();await a.getByRole('button',{name:'Finish payment',exact:true}).click();await a.locator('.instrument .badge.settled').waitFor();
  await route(b,'wallet');await b.getByRole('button',{name:'Claim earnings',exact:true}).click();await b.getByText('1 test ETH claimed.',{exact:true}).waitFor();
  checks.push('Private notes stay private; chunked download matches the SHA-256; offline approval, online settlement and exact seller claim work');
  await route(a,'escrows/'+id);await a.locator('.evidence-details>summary').click();await a.getByRole('tab',{name:'Signed bundle',exact:true}).click();
  const [evidence]=await Promise.all([a.waitForEvent('download',{timeout:180000}),a.getByRole('link',{name:'Download signed bundle',exact:true}).click()]);const bundlePath=await evidence.path();
  assert.equal(JSON.parse(fs.readFileSync(bundlePath)).delivery.sha256,hash);
  await route(a,'verify');await a.locator('#bundle-file').setInputFiles({name:'signed-evidence.json',mimeType:'application/json',buffer:fs.readFileSync(bundlePath)});await a.getByRole('button',{name:/Verify bundle/}).click();await a.locator('#bundle-result strong').getByText('RELEASE',{exact:true}).waitFor({timeout:180000});
  checks.push('Large signed bundle exports with its payload and verifies through chunked upload');
  await route(a,'escrows');await a.locator('#agreement-role').selectOption('seller');assert.equal(await a.locator('#escrow-results tbody tr').count(),0);await a.locator('#agreement-role').selectOption('buyer');assert.equal(await a.locator('#escrow-results tbody tr').count(),1);await a.locator('#agreement-sort').selectOption('value');
  const [csv]=await Promise.all([a.waitForEvent('download'),a.getByRole('link',{name:'Export CSV',exact:true}).click()]);assert.ok(fs.readFileSync(await csv.path(),'utf8').includes(id));
  await a.getByRole('link',{name:'Open inbox',exact:true}).click();await a.getByRole('heading',{name:'Your inbox',exact:true}).waitFor();assert.ok(await a.locator('.inbox-item').count()>0);await a.getByRole('button',{name:'Mark all as read',exact:true}).click();await a.waitForFunction(()=>!document.querySelector('.inbox-item.unread'));
  checks.push('Role and amount filters, CSV export, activity inbox and read state work');
  await route(a,'settings');await a.locator('#profile-name').fill('A secure online workspace');await a.getByRole('button',{name:'Save profile',exact:true}).click();await a.getByText('Profile saved.',{exact:true}).waitFor();
  const second=await browser.newContext(),other=await second.newPage();await other.goto(url);await other.locator('#username').fill(buyer);await other.locator('#password').fill(password);await other.getByRole('button',{name:'Sign in →',exact:true}).click();await ready(other);
  await route(a,'settings');await a.getByRole('button',{name:'Sign out other devices',exact:true}).click();await a.getByText('Selected sessions signed out.',{exact:true}).waitFor();await other.reload();await other.locator('#auth-form').waitFor();await second.close();
  checks.push('Profile persists and an active user can revoke another browser session');
  for(const key of ['overview','escrows','wallet','activity','verify','ledger','lab','settings','help','inbox']){
   await route(a,key);if(key==='inbox')await a.getByRole('heading',{name:'Your inbox',exact:true}).waitFor();if(key==='settings')await a.locator('.sessions-card').waitFor();
   if(key==='lab')assert.equal(await a.locator('.lab-clock').count(),0);
   for(const width of [390,1440]){await a.setViewportSize({width,height:1000});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${key} fits ${width}`);}
   if(['overview','inbox','settings','lab'].includes(key))await a.screenshot({path:path.join(out,'hosted-'+key+'.png'),fullPage:true});
  }
  await route(a,'overview');await a.evaluate(()=>document.documentElement.dataset.theme='dark');await a.screenshot({path:path.join(out,'hosted-dark.png'),fullPage:true});
  checks.push('All ten hosted pages fit mobile and desktop; shared-clock controls are unavailable; dark appearance renders');
  assert.deepEqual(errors,[]);const result={passed:true,checks,consoleErrors:errors,fileSizeBytes:bytes.length};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
  await a.getByRole('button',{name:'Sign out ↗',exact:true}).click();await b.getByRole('button',{name:'Sign out ↗',exact:true}).click();
 }catch(error){await a.screenshot({path:path.join(out,'failure-hosted.png'),fullPage:true});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
