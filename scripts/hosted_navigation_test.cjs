/* Hosted pages and lab UI, with an explicit readiness check for every route. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const {randomBytes}=require('node:crypto');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.PQE_URL||'https://pq-escrow.vercel.app',out=process.env.PQE_SCREENSHOTS||path.resolve(__dirname,'../docs/hosted-live');
const name='view_'+randomBytes(3).toString('hex'),password=randomBytes(18).toString('base64');
const titles={overview:/Good /,escrows:'Your agreements',wallet:'Your wallet.',activity:'Every step leaves a trace.',verify:'Verify the evidence.',ledger:'The local ledger.',lab:'Try to break the agreement.',settings:'Settings',help:'A clear path from agreement to payment.',inbox:'Your inbox'};
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[],checks=[];fs.mkdirSync(out,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.getByRole('tab',{name:'Create account',exact:true}).click();await page.locator('#display-name').fill('Workspace review');await page.locator('#username').fill(name);await page.locator('#password').fill(password);await page.locator('#confirm-password').fill(password);await page.getByRole('button',{name:'Create account →',exact:true}).click();await page.locator('.workspace-insights').waitFor();
  for(const [key,title] of Object.entries(titles)){
   const target=url+'/#'+key;if(page.url()===target)await page.reload();else await page.goto(target);
   await page.getByRole('heading',{name:title,exact:typeof title==='string'}).waitFor();
   if(key==='overview')await page.locator('.workspace-insights').waitFor();if(key==='settings')await page.locator('.sessions-card').waitFor();if(key==='escrows')await page.locator('#agreement-role').waitFor();
   for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${key} fits ${width}px`);}
   await page.screenshot({path:path.join(out,'desktop-'+key+'.png'),fullPage:true,animations:'disabled'});
   if(['overview','inbox','settings','lab'].includes(key)){await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-'+key+'.png'),fullPage:true,animations:'disabled'});}
   checks.push(key+' loaded its own heading and fit 320, 390, 768 and 1440 pixels');
  }
  await page.goto(url+'/#lab');await page.getByRole('heading',{name:titles.lab,exact:true}).waitFor();assert.equal(await page.locator('.lab-clock').count(),0);
  const before=await (await context.request.get(url+'/api/chain')).json(),audit=await (await context.request.get(url+'/api/audit')).json();
  await page.locator('#attack-offset').fill('2');await page.locator('#attack-multiplier').fill('7');await page.locator('#attack-attempts').fill('3');await page.locator('#attack-copies').fill('3');await page.getByRole('button',{name:'Run all experiments',exact:true}).click();await page.locator('#lab-summary').getByText(/5 of 5 completed.*5 blocked/).waitFor({timeout:120000});
  assert.equal(await page.locator('.lab-result').count(),5);assert.equal(await page.locator('#attack-replay .lab-steps li').count(),3);assert.ok((await page.locator('#attack-price .lab-changes').textContent()).includes('7000000000000000000'));
  assert.deepEqual(await (await context.request.get(url+'/api/chain')).json(),before);assert.deepEqual(await (await context.request.get(url+'/api/audit')).json(),audit);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'desktop-lab-results.png'),fullPage:true});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,'mobile-dark-lab-results.png'),fullPage:true});
  await page.getByRole('button',{name:'Reset results',exact:true}).click();assert.equal(await page.locator('.lab-result').count(),0);
  checks.push('Live lab controls change traces; all five experiments block attacks; real ledger/audit stay unchanged; Reset and mobile dark work');
  assert.deepEqual(errors,[]);const result={passed:true,checks,consoleErrors:errors};fs.writeFileSync(path.join(out,'navigation-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));await page.getByRole('button',{name:'Sign out ↗',exact:true}).click();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
