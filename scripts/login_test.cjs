/* Login and server-unavailable recovery; does not create or alter agreements. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.PQE_URL||'http://127.0.0.1:8766';
const out=process.env.PQE_SCREENSHOTS||path.resolve(__dirname,'../docs/screenshots');
(async()=>{
 const browser=await chromium.launch({headless:true}),checks=[],errors=[];
 try{
  for(const name of ['alice','bob','carol']){
   const context=await browser.newContext(),page=await context.newPage();
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(url);await page.locator('#username').fill(name);await page.locator('#password').fill('demo1234');
   await page.getByRole('button',{name:'Sign in →',exact:true}).click();
   await page.getByRole('heading',{name:new RegExp('Good .*'+name)}).waitFor();
   assert.equal((await (await context.request.get(url+'/api/me')).json()).identity.name,name);
   await page.getByRole('button',{name:'Sign out ↗',exact:true}).click();await page.locator('#auth-form').waitFor();
   await context.close();checks.push(name+' signs in, loads the matching workspace and signs out');
  }
  const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
  await page.locator('#username').fill('bob');await page.locator('#password').fill('demo1234');
  await page.route('**/api/login',route=>route.abort('connectionrefused'));
  await page.getByRole('button',{name:'Sign in →',exact:true}).click();
  await page.locator('#auth-error').getByText(/Cannot reach PQ-Escrow/).waitFor();
  assert.ok((await page.locator('#auth-error').textContent()).includes(new URL(url).origin));
  assert.ok((await page.locator('#auth-error').textContent()).includes('start_web.bat'));
  assert.equal(await page.locator('#username').inputValue(),'bob');
  assert.equal(await page.getByRole('button',{name:'Sign in →',exact:true}).isEnabled(),true);
  await page.unroute('**/api/login');await page.getByRole('button',{name:'Sign in →',exact:true}).click();
  await page.getByRole('heading',{name:/Good .*bob/}).waitFor();
  await page.getByRole('button',{name:'Sign out ↗',exact:true}).click();
  checks.push('Connection loss during sign-in explains how to restart; keeps the form usable and recovers without reload');
  await page.route('**/api/me',route=>route.abort('connectionrefused'));await page.reload();
  await page.locator('#auth-error').getByText(/Cannot reach PQ-Escrow/).waitFor();
  await page.unroute('**/api/me');await page.locator('#username').fill('alice');await page.locator('#password').fill('incorrect-password');
  await page.getByRole('button',{name:'Sign in →',exact:true}).click();
  await page.locator('#auth-error').getByText('Username or password is incorrect',{exact:true}).waitFor();
  await page.locator('#password').fill('demo1234');await page.getByRole('button',{name:'Sign in →',exact:true}).click();
  await page.getByRole('heading',{name:/Good .*alice/}).waitFor();
  checks.push('Unavailable initial session shows recovery instructions; incorrect password remains a distinct error and correct retry works');
  await page.getByRole('button',{name:'Sign out ↗',exact:true}).click();await context.close();
  assert.deepEqual(errors,[]);fs.mkdirSync(out,{recursive:true});
  const result={passed:true,checks,consoleErrors:errors};fs.writeFileSync(path.join(out,'login-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
