/* Optional Playwright QA. Run after browser_test.cjs on its disposable seeded data. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const url=process.env.PQE_URL || 'http://127.0.0.1:8765';
const out=process.env.PQE_SCREENSHOTS || path.resolve(__dirname,'../docs/screenshots');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[],checks=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  async function login(name){await page.goto(url);await page.locator('#username').fill(name);await page.locator('#password').fill('demo1234');await page.getByRole('button',{name:'Sign in \u2192',exact:true}).click();await page.getByRole('heading',{name:new RegExp('Good .*'+name)}).waitFor();}
  async function lab(){await page.goto(url+'/#lab');await page.getByRole('heading',{name:'Try to break the agreement.',exact:true}).waitFor();}
  await login('carol');await lab();
  assert.equal(await page.locator('#lab-record option').count(),1,'A fresh account must be able to run the practice example');
  const chainBefore=await (await context.request.get(url+'/api/chain')).json();
  const auditBefore=await (await context.request.get(url+'/api/audit')).json();
  await page.locator('#attack-offset').fill('99999');await page.locator('[data-kind=file]').click();
  await page.locator('#attack-file [role=alert]').getByText(/Byte position must be between/).waitFor();
  assert.equal(await page.locator('[data-kind=file]').isEnabled(),true);
  await page.locator('#attack-offset').fill('2');await page.locator('#attack-signature_byte').fill('0');
  await page.locator('#attack-multiplier').fill('7');await page.locator('#attack-attempts').fill('3');await page.locator('#attack-copies').fill('3');
  await page.getByRole('button',{name:'Run all experiments',exact:true}).click();
  await page.locator('#lab-summary').getByText(/5 of 5 completed.*5 blocked/).waitFor({timeout:120000});
  assert.equal(await page.locator('.lab-result').count(),5);
  for(const kind of ['file','signature','price','replay','double-spend'])await page.locator('#attack-'+kind).getByText('✓ Attack blocked',{exact:true}).waitFor();
  assert.ok((await page.locator('#attack-price .lab-changes').textContent()).includes('7000000000000000000'));
  assert.equal(await page.locator('#attack-replay .lab-steps li').count(),3);assert.equal(await page.locator('#attack-double-spend .lab-steps li').count(),3);
  await page.locator('#attack-file .lab-proof summary').click();
  assert.ok((await page.locator('#attack-file .check.fail').textContent()).includes('Payload integrity'));
  assert.deepEqual(await (await context.request.get(url+'/api/chain')).json(),chainBefore);
  assert.deepEqual(await (await context.request.get(url+'/api/audit')).json(),auditBefore);
  checks.push('Fresh account runs all five real experiments; numeric controls affect changes and attempt traces; invalid settings recover');
  checks.push('Before/after values and failed verification checks are inspectable; real ledger and audit are unchanged');
  await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});
  await page.screenshot({path:path.join(out,'desktop-lab-results.png'),fullPage:true,animations:'disabled'});
  async function componentShot(name){await page.evaluate(()=>scrollTo(0,0));const clip=await page.locator('[data-lab-card=file]').boundingBox();await page.screenshot({path:path.join(out,name),clip,captureBeyondViewport:true,animations:'disabled'});}
  await componentShot('desktop-lab-file.png');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await componentShot('mobile-lab-file.png');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await componentShot('dark-lab-file.png');
  await page.getByRole('button',{name:'Reset results',exact:true}).click();assert.equal(await page.locator('.lab-result').count(),0);
  assert.ok((await page.locator('#lab-summary').textContent()).includes('0 of 5 completed'));
  await page.locator('.lab-clock summary').click();await page.getByRole('button',{name:'+ 1 hour',exact:true}).click();assert.equal(await page.locator('#time-seconds').inputValue(),'3600');
  checks.push('Mobile and dark results fit; Reset results clears results; time presets change the input without advancing the clock');
  // Hold one response while navigating away to check stale results cannot affect another page.
  let releaseAttack,signalRequest;const requestHeld=new Promise(resolve=>signalRequest=resolve);
  await page.route('**/api/lab/attack',async route=>{await new Promise(resolve=>{releaseAttack=resolve;signalRequest();});await route.continue();});
  await page.locator('[data-kind=file]').click();await requestHeld;
  await page.getByRole('link',{name:'Wallet',exact:true}).click();await page.getByRole('heading',{name:'Your wallet.',exact:true}).waitFor();
  const returned=page.waitForResponse(response=>response.url().endsWith('/api/lab/attack'));releaseAttack();await returned;
  await page.unroute('**/api/lab/attack');await lab();
  await page.locator('[data-kind=file]').click();await page.locator('#attack-file').getByText('✓ Attack blocked',{exact:true}).waitFor();
  assert.equal(await page.locator('.error-toast').count(),0);
  checks.push('Leaving during an experiment safely ignores its late response; returning to the lab can run again');
  await page.getByRole('button',{name:'Sign out ↗',exact:true}).click();await page.locator('#auth-form').waitFor();
  await login('alice');await lab();const selected=await page.locator('#lab-record option').nth(1).getAttribute('value');assert.ok(selected);
  const recordBefore=await (await context.request.get(url+'/api/escrows/'+selected+'/bundle')).json();await page.locator('#lab-record').selectOption(selected);
  for(const kind of ['file','signature','price']){await page.locator('[data-kind="'+kind+'"]').click();await page.locator('#attack-'+kind).getByText('✓ Attack blocked',{exact:true}).waitFor();}
  assert.deepEqual(await (await context.request.get(url+'/api/escrows/'+selected+'/bundle')).json(),recordBefore);
  checks.push('A selected real delivery supports file/signature/price experiments without altering its signed bundle');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'interactive-lab-results.json'),JSON.stringify({passed:true,checks,consoleErrors:errors},null,2));
  console.log(JSON.stringify({passed:true,checks},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
