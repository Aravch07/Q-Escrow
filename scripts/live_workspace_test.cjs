/* Two independent browsers: incoming evidence, cancellation and settlement without reloads. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const {randomBytes}=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const url=process.env.PQE_URL||'http://127.0.0.1:8793',out=process.env.PQE_SCREENSHOTS||path.resolve(__dirname,'../../live-workspace-checks');
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[],times={};fs.mkdirSync(out,{recursive:true});
 const ac=await browser.newContext({viewport:{width:1440,height:1100}}),bc=await browser.newContext({viewport:{width:1440,height:1100}});
 const a=await ac.newPage(),b=await bc.newPage();for(const p of [a,b]){p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));}
 const headers={'X-Requested-With':'PQEscrow'};
 async function post(context,route,data={},raw=false){const r=await context.request.post(url+'/api/'+route,{data,headers:raw?{...headers,'Content-Type':'application/octet-stream'}:headers});assert.ok(r.ok(),route+': '+r.status()+' '+await r.text());return r.json();}
 async function open(page,id){await page.goto(url+'/#escrows/'+id);await page.locator('.instrument').waitFor();await page.locator('.live-dot').waitFor();}
 async function confirmed(page){await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();}
 try{
  const hosted=(await (await ac.request.get(url+'/api/config')).json()).hosted;
  const suffix=randomBytes(3).toString('hex'),password=randomBytes(18).toString('base64');
  const buyer=hosted?'live_b_'+suffix:'alice',seller=hosted?'live_s_'+suffix:'bob';
  for(const [context,name] of [[ac,buyer],[bc,seller]]){if(hosted)await post(context,'register',{username:name,password});await post(context,'login',{username:name,password:hosted?password:'demo1234'});}
  if(hosted)await post(ac,'wallet/deposit',{amount_wei:'2000000000000000000',lock_seconds:60});
  for(const page of [a,b]){await page.goto(url);await page.locator('.analytics-widget').waitFor();await page.locator('.live-dot').waitFor();}
  const propose=description=>post(ac,'escrows',{seller,amount_wei:'1000000000000000000',description:description+' '+suffix,expires_at:Math.floor(Date.now()/1000)+3600});
  let started=Date.now();const first=await propose('Live delivery and seller cancellation');
  await b.getByRole('link',{name:'Live delivery and seller cancellation '+suffix,exact:true}).waitFor();times.newAgreementMs=Date.now()-started;
  await open(a,first.escrow_id);await open(b,first.escrow_id);await a.evaluate(()=>window.noReloadSentinel='keep-this-document');
  await post(bc,'escrows/'+first.escrow_id+'/countersign');await b.locator('#delivery-file').waitFor();await a.locator('.instrument .badge.locked').waitFor();
  await a.evaluate(()=>openCreate());await a.locator('#description').fill('Keep this unsent draft');
  await b.locator('#delivery-file').setInputFiles({name:'delivery.txt',mimeType:'text/plain',buffer:Buffer.from('Live delivery content')});
  await b.getByRole('button',{name:'Send delivery',exact:true}).click();started=Date.now();await confirmed(b);
  await a.locator('#workspace-update').waitFor();assert.equal(await a.locator('#description').inputValue(),'Keep this unsent draft');assert.equal(await a.locator('#create-dialog').evaluate(d=>d.open),true);
  await a.locator('[data-action="close-create"]').click();await a.getByRole('link',{name:'Download file ↓',exact:true}).waitFor();times.deliveryMs=Date.now()-started;
  assert.equal(await a.evaluate(()=>window.noReloadSentinel),'keep-this-document');
  await a.evaluate(()=>openCreate());assert.equal(await a.locator('#description').inputValue(),'Keep this unsent draft');await a.locator('[data-action="close-create"]').click();
  if(hosted)await a.locator('#private-note').fill('Keep this private note while the seller cancels');
  await b.getByRole('button',{name:'Cancel agreement',exact:true}).click();started=Date.now();await confirmed(b);
  if(hosted){await a.locator('#workspace-update').waitFor();assert.equal(await a.locator('#private-note').inputValue(),'Keep this private note while the seller cancels');await a.getByRole('button',{name:'Save note',exact:true}).click();started=Date.now();}
  await a.locator('.instrument .badge.cancelled').waitFor();times.cancellationMs=Date.now()-started;
  await b.locator('.instrument .badge.cancelled').waitFor();assert.equal(await a.getByRole('button',{name:'Release payment',exact:false}).count(),0);
  assert.equal(await a.evaluate(()=>window.noReloadSentinel),'keep-this-document');
  const second=await propose('Live buyer cancellation');await open(a,second.escrow_id);await open(b,second.escrow_id);
  await a.getByRole('button',{name:'Cancel agreement',exact:true}).click();await confirmed(a);await b.locator('.instrument .badge.cancelled').waitFor();
  const third=await propose('Live recorded payment');await open(a,third.escrow_id);await open(b,third.escrow_id);
  await post(bc,'escrows/'+third.escrow_id+'/countersign');await post(bc,'escrows/'+third.escrow_id+'/deliver',Buffer.from('Payment test delivery'),true);
  await a.getByRole('button',{name:'Release payment',exact:false}).waitFor();await a.getByRole('button',{name:'Release payment',exact:false}).click();await confirmed(a);
  await b.locator('.instrument .badge.accepted').waitFor();await a.getByRole('button',{name:'Finish payment',exact:true}).click();started=Date.now();await b.locator('.instrument .badge.settled').waitFor();times.paymentMs=Date.now()-started;
  assert.equal(await b.getByRole('button',{name:'Cancel agreement',exact:true}).count(),0);
  await a.goto(url+'/#escrows');await a.locator('#escrow-search').waitFor();await a.locator('[data-filter="cancelled"]').click();await a.locator('#escrow-search').fill(suffix);await a.getByRole('heading',{name:'Your agreements',exact:true}).click();
  const fourth=await propose('Live filter preservation');await a.waitForTimeout(5000);
  assert.equal(await a.locator('#escrow-search').inputValue(),suffix);assert.equal(await a.locator('[data-filter="cancelled"]').getAttribute('aria-pressed'),'true');
  assert.equal(await a.locator('#escrow-results tbody tr').count(),2);await post(ac,'escrows/'+fourth.escrow_id+'/cancel');
  let idleMeRequests=0;const count=request=>{if(new URL(request.url()).pathname==='/api/me')idleMeRequests++;};await a.waitForTimeout(4000);a.on('request',count);await a.waitForTimeout(5000);a.off('request',count);assert.equal(idleMeRequests,0,'unchanged revisions must not reload workspace data');
  await a.route('**/api/updates?*',route=>route.abort());await a.locator('.nav-refresh.live-reconnecting').waitFor();await a.unroute('**/api/updates?*');await a.evaluate(()=>window.dispatchEvent(new Event('online')));await a.locator('.nav-refresh.live-reconnecting').waitFor({state:'hidden'});
  for(const width of [320,390,1440]){await a.setViewportSize({width,height:1000});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await a.screenshot({path:path.join(out,'cancelled-agreements.png'),fullPage:true});assert.deepEqual(errors,[]);
  const result={passed:true,times,checks:['incoming agreements and deliveries appear without reload','open draft survives incoming delivery and applies after closing','seller and buyer can cancel immediately','counterparty sees cancellation and payment automatically','settled payments cannot be cancelled','search and filters survive background updates','idle checks do not reload full workspace','connection failures reconnect','320/390/1440 layouts fit'],consoleErrors:errors};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }catch(error){await a.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
