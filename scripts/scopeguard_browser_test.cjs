/* Run against a disposable local workspace started with --seed-demo. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
const base=process.env.PQE_URL||'http://127.0.0.1:8765';
(async()=>{
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const response=await context.request.post(base+'/api/login',{data:{username:'alice',password:'demo1234'},headers:{'X-Requested-With':'PQEscrow'}});
  assert.equal(response.status(),200,'Use an isolated local seeded workspace');
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const route of ['scopeguard','scope-create','scope-proof','scope-milestones','scope-resolve','scope-passport','scope-security','scope-profile']){
   console.log('Checking '+route);
   await page.goto(base+'/#'+route);
   await page.locator(route==='scopeguard'?'.vault-balance-hero':'.sg-notice').waitFor();
   for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' overflow at '+width);
   }
  }
  await page.goto(base+'/#scope-create');
  await page.locator('#sg-brief').fill('Five-page responsive website with login, registration and contact form');
  await page.getByRole('button',{name:'Generate proposed scope',exact:true}).click();
  await page.locator('#sg-agreement-form').waitFor();
  assert.equal(await page.locator('[data-sg-req]').count(),5);
  await page.goto(base+'/#scope-demo');
  await page.getByRole('button',{name:'Run complete demonstration'}).click();
  await page.locator('.sg-demo-layout').waitFor({timeout:60000});
  await page.locator('[data-sg="demo-step"][data-step="10"]').click();
  await page.getByRole('heading',{name:'Agree to revision',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('ScopeGuard generation, responsive pages and signed eleven-step demo passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
