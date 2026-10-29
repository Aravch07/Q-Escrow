/* Optional Playwright QA on disposable seeded data; Carol should start without a deposit. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.PQE_URL||'http://127.0.0.1:8765',out=process.env.PQE_SCREENSHOTS||path.resolve(__dirname,'../docs/screenshots');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[],checks=[],creations=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/escrows')creations.push(request.postData());});
  await page.goto(url);await page.locator('#username').fill('carol');await page.locator('#password').fill('demo1234');await page.getByRole('button',{name:'Sign in \u2192',exact:true}).click();await page.getByRole('heading',{name:/Good .*carol/}).waitFor();
  assert.deepEqual(await page.locator('.primary-nav>a').allTextContents(),['Home','Agreements','Wallet','Activity']);
  await page.getByRole('button',{name:'Hide getting started guide',exact:true}).click();await page.reload();await page.getByRole('heading',{name:/Good .*carol/}).waitFor();assert.equal(await page.locator('.welcome-guide').count(),0);
  await page.getByRole('link',{name:'Help and getting started',exact:true}).click();await page.getByRole('heading',{name:'A clear path from agreement to payment.',exact:true}).waitFor();
  await page.getByRole('tab',{name:'I’m delivering',exact:true}).click();assert.ok((await page.locator('#help-role-panel').textContent()).includes('Send the correct file'));
  await page.keyboard.press('ArrowLeft');assert.equal(await page.getByRole('tab',{name:'I’m buying',exact:true}).getAttribute('aria-selected'),'true');
  await page.screenshot({path:path.join(out,'desktop-getting-started.png'),fullPage:true});
  await page.getByRole('button',{name:'Show the Home guide again',exact:true}).click();await page.locator('.welcome-guide').waitFor();
  checks.push('Four primary destinations; getting-started guide dismisses, persists and reopens; buyer/seller help supports keyboard tabs');
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'Tools',exact:true}).click();
   const box=await page.locator('#tools-menu').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,`Tools menu at ${width}px`);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#tools-toggle').evaluate(el=>el===document.activeElement),true);
   await page.getByRole('button',{name:'Tools',exact:true}).click();await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
   assert.equal(await page.locator('#theme-select').isVisible(),true);assert.equal(await page.locator('.account-details').getAttribute('open'),null);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.getByRole('link',{name:'Home',exact:true}).click();await page.locator('.welcome-guide').waitFor();
  }
  checks.push('Tools menu fits 320–1440px, closes with Escape and restores focus; Settings keeps preferences visible and technical identity collapsed');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-new-user-home.png'),fullPage:true});
  await page.getByRole('button',{name:'\uff0b Create escrow',exact:true}).click();await page.locator('#create-dialog').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Continue to file check',exact:true}).click();assert.equal(await page.locator('[data-create-step="1"]').isVisible(),true);
  await page.locator('#seller').fill('bob');await page.locator('#amount').fill('0');await page.locator('#description').fill('A clear delivery for a new buyer');await page.getByRole('button',{name:'Continue to file check',exact:true}).click();assert.equal(await page.locator('#amount').evaluate(el=>el.validity.valid),false);
  await page.locator('#amount').fill('1.25');await page.locator('#hours').fill('48');await page.getByRole('button',{name:'Continue to file check',exact:true}).click();
  const bytes=Buffer.from('The expected file for the guided escrow.'),hash=createHash('sha256').update(bytes).digest('hex');
  await page.locator('#expected-file').setInputFiles({name:'expected.txt',mimeType:'text/plain',buffer:bytes});await page.waitForFunction(hash=>document.querySelector('#expected').value===hash,hash);
  await page.screenshot({path:path.join(out,'mobile-guided-file-check.png'),fullPage:true});await page.getByRole('button',{name:'Review agreement',exact:true}).click();
  assert.ok((await page.locator('#create-review-summary').textContent()).includes('1.25 test ETH'));assert.ok((await page.locator('#create-review-summary').textContent()).includes('48 hours'));assert.equal(creations.length,0);
  await page.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await page.locator('#expected').inputValue(),hash);await page.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await page.locator('#description').inputValue(),'A clear delivery for a new buyer');
  await page.keyboard.press('Escape');await page.locator('#create-dialog').waitFor({state:'hidden'});assert.equal(creations.length,0);
  await page.getByRole('button',{name:'\uff0b Create escrow',exact:true}).click();assert.equal(await page.locator('#seller').inputValue(),'bob');await page.getByRole('button',{name:'Continue to file check',exact:true}).click();await page.getByRole('button',{name:'Review agreement',exact:true}).click();
  await page.screenshot({path:path.join(out,'mobile-guided-review.png'),fullPage:true});
  await page.getByRole('link',{name:'Add funds in Wallet',exact:true}).click();await page.getByRole('heading',{name:'Your wallet.',exact:true}).waitFor();
  await page.locator('#deposit-amount').fill('2');await page.locator('#lock-preset').selectOption('86400');assert.equal(await page.locator('#lock-seconds').inputValue(),'86400');await page.locator('#lock-preset').selectOption('custom');assert.equal(await page.locator('#lock-seconds').isVisible(),true);await page.locator('#lock-preset').selectOption('3600');
  await page.getByRole('button',{name:'Deposit test funds',exact:true}).click();await page.getByText('Test funds deposited and time-locked.',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'\uff0b Create escrow',exact:true}).click();await page.getByRole('button',{name:'Continue to file check',exact:true}).click();await page.getByRole('button',{name:'Review agreement',exact:true}).click();assert.equal(await page.locator('.funding-notice').count(),0);
  await page.getByRole('button',{name:'Review and sign terms',exact:true}).click();await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();await page.waitForURL(/#escrows\/[0-9a-f]{64}$/);await page.locator('.instrument').waitFor();
  assert.equal(creations.length,1);assert.equal(JSON.parse(creations[0]).expected_sha256,hash);assert.equal(await page.locator('.simple-rail .rail-step').count(),4);assert.equal(await page.locator('.evidence-details').getAttribute('open'),null);assert.equal(await page.locator('.instrument-more').getAttribute('open'),null);assert.equal(await page.getByRole('button',{name:'Finish payment',exact:true}).count(),0);await page.getByRole('button',{name:'Check for updates',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'mobile-guided-agreement.png'),fullPage:true});
  checks.push('Three-step creation validates, preserves the draft on Back/Cancel, computes the file fingerprint and signs only after review');
  checks.push('Funding guidance opens Wallet without losing the draft; friendly lock presets and custom durations work; creation uses the original fingerprint');
  checks.push('Four-stage agreement progress, role-specific waiting action and collapsed evidence keep the main view focused');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'usability-results.json'),JSON.stringify({passed:true,checks,consoleErrors:errors},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
