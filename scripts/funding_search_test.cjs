/* Reproduce an approved-but-unfunded payment and exercise searchable seller selection. */
const {chromium}=require(process.env.PQE_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const url=process.env.PQE_URL||'http://127.0.0.1:8794',out=process.env.PQE_SCREENSHOTS||path.resolve(__dirname,'../../funding-search-checks');
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[];fs.mkdirSync(out,{recursive:true});
 const ac=await browser.newContext({viewport:{width:1440,height:1100}}),bc=await browser.newContext({viewport:{width:1440,height:1100}}),a=await ac.newPage(),b=await bc.newPage();
 for(const p of [a,b]){p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));}
 async function post(context,route,data={},raw=false){const r=await context.request.post(url+'/api/'+route,{data,headers:{'X-Requested-With':'PQEscrow',...(raw?{'Content-Type':'application/octet-stream'}:{})}});assert.ok(r.ok(),route+': '+r.status()+' '+await r.text());return r.json();}
 async function confirm(page){await page.getByRole('button',{name:'Confirm and sign',exact:true}).click();}
 try{
  const hosted=(await (await ac.request.get(url+'/api/config')).json()).hosted,suffix=randomBytes(3).toString('hex'),password=randomBytes(18).toString('base64');
  const buyer=hosted?'fund_b_'+suffix:'bob',seller=hosted?'fund_s_'+suffix:'carol';
  for(const [context,name] of [[ac,buyer],[bc,seller]]){if(hosted)await post(context,'register',{username:name,password});await post(context,'login',{username:name,password:hosted?password:'demo1234'});}
  const initialClaimable=BigInt((await (await bc.request.get(url+'/api/wallet')).json()).account.claimable);
  await a.goto(url);await a.locator('.analytics-widget').waitFor();await a.getByRole('button',{name:'＋ Create escrow',exact:true}).click();
  await a.locator('#seller').fill(buyer);await a.getByText('No matching username.',{exact:false}).waitFor();assert.equal(await a.locator('#seller-suggestions [role="option"]').count(),0);
  await a.locator('#seller').fill('unknown_seller_12345');await a.locator('#description').fill('Funding recovery '+suffix);await a.getByRole('button',{name:'Continue to file check',exact:true}).click();assert.equal(await a.locator('#seller').evaluate(input=>input.validity.valid),false);
  await a.locator('#seller').fill('@'+seller.toUpperCase());await a.locator('#seller-suggestions [role="option"]').first().waitFor();await a.locator('#seller').press('ArrowDown');await a.locator('#seller').press('Enter');
  assert.equal(await a.locator('#seller').inputValue(),seller);assert.equal(await a.locator('#seller').getAttribute('aria-expanded'),'false');
  await a.getByRole('button',{name:'Continue to file check',exact:true}).click();await a.getByRole('button',{name:'Review agreement',exact:true}).click();assert.ok((await a.locator('#create-review-summary').textContent()).includes(seller));
  await a.getByRole('button',{name:'Review and sign terms',exact:true}).click();await confirm(a);await a.waitForURL(/#escrows\/[0-9a-f]{64}$/);const id=a.url().split('/').pop();
  await post(bc,'escrows/'+id+'/countersign');await post(bc,'escrows/'+id+'/deliver',Buffer.from('The same approved file throughout funding recovery.'),true);
  await a.getByRole('button',{name:'Release payment',exact:false}).waitFor();await a.getByRole('button',{name:'Release payment',exact:false}).click();await confirm(a);await a.getByRole('heading',{name:'Add funds to finish payment.',exact:true}).waitFor();
  const before=(await (await ac.request.get(url+'/api/escrows/'+id)).json()).bundle.signatures;
  const held=await post(ac,'reconcile',{escrow_id:id});assert.equal(held.results[0].outcome,'HOLD');
  const waiting=await (await ac.request.get(url+'/api/escrows/'+id)).json();assert.equal(waiting.state,'ACCEPTED');assert.equal(waiting.rejection,null);
  await b.goto(url+'/#escrows/'+id);await b.getByRole('heading',{name:'Waiting for buyer funding.',exact:true}).waitFor();
  await a.screenshot({path:path.join(out,'payment-needs-funding.png'),fullPage:true});
  await a.getByRole('link',{name:'Add funds in Wallet',exact:false}).click();await a.locator('#deposit-form').waitFor();assert.equal(await a.locator('#deposit-amount').inputValue(),'1');
  await a.getByRole('button',{name:'Deposit test funds',exact:true}).click();await a.waitForURL(new RegExp('#escrows/'+id+'$'));await a.getByRole('button',{name:'Finish payment',exact:true}).waitFor();
  await b.getByRole('button',{name:'Finish payment',exact:true}).waitFor();await a.getByRole('button',{name:'Finish payment',exact:true}).click();await a.locator('.instrument .badge.settled').waitFor();await b.locator('.instrument .badge.settled').waitFor();
  const after=await (await ac.request.get(url+'/api/escrows/'+id)).json();assert.deepEqual(after.bundle.signatures,before);assert.equal(BigInt((await (await bc.request.get(url+'/api/wallet')).json()).account.claimable),initialClaimable+1000000000000000000n);
  await a.goto(url+'/#overview');await a.locator('.analytics-widget').waitFor();await a.getByRole('button',{name:'＋ Create escrow',exact:true}).click();await a.locator('#seller').fill(seller.slice(-4));
  await a.getByRole('option',{name:'@'+seller,exact:false}).click();assert.equal(await a.locator('#seller').inputValue(),seller);
  for(const width of [320,390,1440]){await a.setViewportSize({width,height:1000});await a.locator('#seller').fill(seller);assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await a.locator('#seller-suggestions').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true);}
  await a.screenshot({path:path.join(out,'seller-search.png'),fullPage:true});assert.deepEqual(errors,[]);
  const result={passed:true,checks:['self and unknown usernames are refused','case-insensitive @username search and keyboard selection work','mouse selection and mobile list fit work','an unfunded approved agreement stays ACCEPTED after payment attempt','Wallet shows the exact shortfall and returns to the agreement after deposit','the seller sees the deposit and completed payment automatically','the original signatures and delivery remain unchanged','exactly 1 test ETH becomes claimable'],consoleErrors:errors};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }catch(error){await a.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
