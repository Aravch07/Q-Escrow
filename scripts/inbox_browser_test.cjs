/* Status-organised inbox, source names, filters and live movement between groups. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const url=process.env.PQE_URL||'http://127.0.0.1:8795',out=process.env.PQE_SCREENSHOTS||path.resolve(__dirname,'../../inbox-checks');
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[];fs.mkdirSync(out,{recursive:true});
 const ac=await browser.newContext({viewport:{width:1440,height:1100}}),bc=await browser.newContext({viewport:{width:1440,height:1100}}),a=await ac.newPage(),b=await bc.newPage();
 for(const p of [a,b]){p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));}
 async function post(context,route,data={},raw=false){const r=await context.request.post(url+'/api/'+route,{data,headers:{'X-Requested-With':'PQEscrow',...(raw?{'Content-Type':'application/octet-stream'}:{})}});assert.ok(r.ok(),route+': '+r.status()+' '+await r.text());return r.json();}
 const suffix=randomBytes(3).toString('hex'),buyer='inbox_b_'+suffix,seller='inbox_s_'+suffix,password=randomBytes(18).toString('base64'),ids={};
 try{
  for(const [c,name] of [[ac,buyer],[bc,seller]]){await post(c,'register',{username:name,password});await post(c,'login',{username:name,password});}
  await post(ac,'wallet/deposit',{amount_wei:'2000000000000000000',lock_seconds:60});
  for(const stage of ['PROPOSED','LOCKED','DELIVERED','ACCEPTED','SETTLED','CANCELLED']){
   const title=stage==='DELIVERED'?'Brand <img src=x onerror="alert(1)"> package '+suffix:stage+' design agreement '+suffix;
   const r=await post(ac,'escrows',{seller,amount_wei:'1000000000000000000',description:title,expires_at:Math.floor(Date.now()/1000)+3600});ids[stage]=r.escrow_id;
   if(stage==='CANCELLED'){await post(bc,'escrows/'+r.escrow_id+'/cancel');continue;}
   if(stage==='PROPOSED')continue;await post(bc,'escrows/'+r.escrow_id+'/countersign');
   if(stage==='LOCKED')continue;await post(bc,'escrows/'+r.escrow_id+'/deliver',Buffer.from('Original design delivery'),true);
   if(stage==='DELIVERED')continue;await post(ac,'escrows/'+r.escrow_id+'/accept',{decision:'release'});
   if(stage==='SETTLED')await post(ac,'reconcile',{escrow_id:r.escrow_id});
  }
  await a.goto(url+'/#inbox');await a.getByRole('heading',{name:'Your inbox',exact:true}).waitFor();await a.locator('.agreement-inbox-card').first().waitFor();await a.locator('.live-dot').waitFor();
  assert.equal(await a.locator('.agreement-inbox-card').count(),6);assert.equal(await a.locator('.inbox-group').count(),6);
  const delivered=a.locator('[data-agreement="'+ids.DELIVERED+'"]');assert.ok((await delivered.locator('h3').textContent()).includes('<img'));assert.equal(await delivered.locator('img').count(),0);assert.ok((await delivered.locator('.inbox-event-source').first().textContent()).includes(seller));assert.ok((await delivered.locator('.inbox-created-by').textContent()).includes(buyer));
  assert.equal(await delivered.locator('..').locator('..').getAttribute('data-status'),'DELIVERED');
  await a.locator('#inbox-status').selectOption('DELIVERED');assert.equal(await a.locator('.agreement-inbox-card').count(),1);
  await a.locator('#inbox-search').fill('@'+seller);assert.equal(await a.locator('.agreement-inbox-card').count(),1);
  await a.getByRole('heading',{name:'Your inbox',exact:true}).click();await a.evaluate(()=>window.inboxNoReload='keep');
  await post(ac,'escrows/'+ids.DELIVERED+'/accept',{decision:'release'});await a.getByRole('heading',{name:'No updates match this view.',exact:true}).waitFor();
  assert.equal(await a.locator('#inbox-status').inputValue(),'DELIVERED');assert.equal(await a.locator('#inbox-search').inputValue(),'@'+seller);assert.equal(await a.evaluate(()=>window.inboxNoReload),'keep');
  await a.locator('#inbox-status').selectOption('ACCEPTED');assert.equal(await a.locator('.agreement-inbox-card').count(),2);
  await a.locator('#inbox-status').selectOption('all');await a.locator('#inbox-search').fill('');await a.getByRole('heading',{name:'Your inbox',exact:true}).click();
  const history=a.locator('[data-agreement="'+ids.ACCEPTED+'"] .inbox-history');await history.locator('summary').click();assert.ok(await history.locator('li').count()>0);assert.ok((await history.textContent()).includes(seller));
  for(const width of [320,390,768,1440]){await a.setViewportSize({width,height:1100});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await a.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await a.screenshot({path:path.join(out,'organised-inbox.png'),fullPage:true,animations:'disabled'});await a.setViewportSize({width:390,height:844});await a.evaluate(()=>scrollTo(0,0));await a.screenshot({path:path.join(out,'mobile-inbox.png'),fullPage:true,animations:'disabled'});
  await b.goto(url+'/#inbox');await b.locator('.agreement-inbox-card').first().waitFor();await b.getByRole('button',{name:'Mark all as read',exact:true}).click();await b.waitForFunction(()=>!document.querySelector('.inbox-item.unread'));
  await a.getByRole('button',{name:'Mark all as read',exact:true}).click();await a.waitForFunction(()=>!document.querySelector('.inbox-item.unread'));assert.equal((await (await ac.request.get(url+'/api/notifications?summary=1')).json()).unread,0);
  await a.locator('#inbox-unread-only').check();await a.getByRole('heading',{name:'Your inbox',exact:true}).click();await a.getByRole('heading',{name:'No updates match this view.',exact:true}).waitFor();
  const incoming=await post(bc,'escrows',{seller:buyer,amount_wei:'1',description:'New incoming launch '+suffix,expires_at:Math.floor(Date.now()/1000)+3600});
  const arrival=a.locator('[data-agreement="'+incoming.escrow_id+'"]');await arrival.waitFor();assert.ok((await arrival.textContent()).includes(seller));assert.equal(await a.locator('#inbox-unread-only').isChecked(),true);
  await a.getByRole('button',{name:'Mark all as read',exact:true}).click();await a.getByRole('heading',{name:'No updates match this view.',exact:true}).waitFor();
  await a.locator('#inbox-unread-only').uncheck();await a.locator('#inbox-status').selectOption('account');assert.equal(await a.locator('.agreement-inbox-card').count(),0);assert.ok(await a.locator('#inbox-account .inbox-item').count()>0);
  assert.deepEqual(errors,[]);const result={passed:true,checks:['one named card per agreement grouped by current status','counterparty, creator and actual update sender shown','status, @username search and unread filters work','historical updates stay inside their agreement','unsafe title text is escaped','live status moves retain filters without reloading','new arrivals appear under unread-only after marking read','account notifications are separate','320/390/768/1440 layouts fit'],consoleErrors:errors};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }catch(error){await a.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
