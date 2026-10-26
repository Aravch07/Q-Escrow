const {chromium}=require(process.env.PQE_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const out=process.env.PQE_SCREENSHOTS || path.resolve(__dirname,'../docs/screenshots');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
  await ctx.addInitScript(()=>{try{if(!localStorage.getItem('pqe-design'))localStorage.setItem('pqe-theme','dark');}catch{}});
  const page=await ctx.newPage();await page.goto(process.env.PQE_URL || 'http://127.0.0.1:8765');
  await page.locator('#auth-form').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  await page.locator('#username').fill('carol');await page.locator('#password').fill('demo1234');
  await page.getByRole('button',{name:'Sign in \u2192',exact:true}).click();
  await page.getByRole('heading',{name:'Your next agreement starts here',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'desktop-empty-overview.png'),fullPage:true});
  for(const width of [320,390,768,1024]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Empty overview ${width}px`);
   await page.getByRole('button',{name:'Tools',exact:true}).click();await page.getByRole('link',{name:'Settings',exact:true}).click();
   await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
   assert.equal(await page.locator('#tools-toggle').evaluate(el=>el.classList.contains('active')),true);
   await page.getByRole('link',{name:'Home',exact:true}).click();
   await page.getByRole('heading',{name:'Your next agreement starts here',exact:true}).waitFor();
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(out,'mobile-empty-overview.png'),fullPage:true});
  const create=page.getByRole('button',{name:'\uff0b Create escrow',exact:true});await create.click();
  await page.locator('#create-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#create-dialog').evaluate(el=>el.getBoundingClientRect().width<=innerWidth),true);
  await page.screenshot({path:path.join(out,'mobile-create-escrow.png'),fullPage:true});
  await page.keyboard.press('Escape');await page.locator('#create-dialog').waitFor({state:'hidden'});
  await page.getByRole('link',{name:'Agreements',exact:true}).click();
  await page.getByRole('heading',{name:'Your agreements',exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'Search agreements',exact:true}).fill('missing');
  await page.getByRole('heading',{name:'No agreements found.',exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByRole('heading',{name:'Your next agreement starts here',exact:true}).waitFor();
  fs.writeFileSync(path.join(out,'finance-layout-results.json'),JSON.stringify({passed:true,checks:[
   'Legacy dark preference and dark device migrate once to light',
   'Empty overview fits 320, 390, 768 and 1024px viewports',
   'Tools marks advanced pages active; primary destinations stay visible at all four widths',
   'Mobile creation dialog fits the viewport and closes with Escape',
   'Mobile search and clear filters work on an empty account'
  ]},null,2));
  console.log('Finance layout checks passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
