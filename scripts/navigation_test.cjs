/* Read-only browser/navigation and advanced-disclosure QA after browser_test.cjs. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.PQE_URL||'http://127.0.0.1:8765',out=process.env.PQE_SCREENSHOTS||path.resolve(__dirname,'../docs/screenshots');
fs.mkdirSync(out,{recursive:true});
const titles={overview:/Good .*alice/,escrows:'Your agreements',wallet:'Your wallet.',activity:'Every step leaves a trace.',ledger:'The local ledger.',verify:'Verify the evidence.',lab:'Try to break the agreement.',settings:'Settings',help:'A clear path from agreement to payment.'};
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[],checks=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.locator('#username').fill('alice');await page.locator('#password').fill('demo1234');await page.getByRole('button',{name:'Sign in \u2192',exact:true}).click();await page.getByRole('heading',{name:/Good .*alice/}).waitFor();
  const records=(await (await context.request.get(url+'/api/escrows')).json()).escrows,id=records.find(r=>r.delivery).escrow_id;
  for(const mode of ['desktop','mobile','dark']){
   await page.setViewportSize(mode==='mobile'?{width:390,height:844}:{width:1440,height:1000});
   await page.evaluate(theme=>{localStorage.setItem('pqe-theme',theme);document.documentElement.dataset.theme=theme;},mode==='dark'?'dark':'light');
   for(const [key,title] of Object.entries(titles)){
    await page.goto(url+'/#'+key);await page.getByRole('heading',{name:title,exact:typeof title==='string'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,mode+' '+key);
    await page.screenshot({path:path.join(out,mode+'-'+key+'.png'),fullPage:true,animations:'disabled'});
   }
   await page.goto(url+'/#escrows/'+id);await page.locator('.instrument').waitFor();
   assert.equal(await page.locator('.evidence-details').getAttribute('open'),null);assert.equal(await page.locator('.instrument-more').getAttribute('open'),null);
   await page.screenshot({path:path.join(out,mode+'-detail.png'),fullPage:true,animations:'disabled'});
  }
  await page.locator('.evidence-details>summary').click();await page.getByRole('tab',{name:'Terms',exact:true}).click();assert.ok((await page.locator('#detail-panel').textContent()).includes('expected_sha256'));
  await page.getByRole('tab',{name:'Signed bundle',exact:true}).click();await page.getByRole('link',{name:'Download signed bundle',exact:true}).waitFor();
  await page.locator('.instrument-more>summary').click();assert.equal(await page.locator('.seals .seal').count(),4);
  assert.deepEqual(errors,[]);checks.push('All ten signed-in views fit light desktop, 390px mobile and dark appearances');checks.push('Advanced signatures, signed terms and bundle download remain reachable through expandable evidence');
  fs.writeFileSync(path.join(out,'navigation-results.json'),JSON.stringify({passed:true,checks,consoleErrors:errors},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
