const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PQE_PLAYWRIGHT || 'playwright');

(async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8796/__resume_check__');
  const source = fs.readFileSync(require('node:path').join(__dirname,'../webapp/static/hosted.js'),'utf8');
  const upload = source.slice(source.indexOf('async function uploadParts('),source.indexOf('function saveBlob('));
  await page.addScriptTag({content: upload});
  const result = await page.evaluate(async () => {
   window.me = {identity:{name:'resume_check'}};
   window.runtime = {chunk_size:1024};
   window.fileFingerprint = async file => {
    const digest = await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
   };
   const complete = new Set();
   const calls = [];
   let starts = 0, interrupted = true;
   window.api = async (route,data) => {
    calls.push(route);
    if(route === 'uploads/start'){ starts++; return {upload_id:'test',chunk_size:1024}; }
    if(route === 'uploads/test/status')return {size:2500,filename:'work.bin',parts:[...complete]};
    const part=Number(route.split('/').pop());
    if(part === 1 && interrupted)throw Object.assign(Error('Connection interrupted'),{status:503});
    complete.add(part);
    return {ok:true};
   };
   const file = new File([new Uint8Array(2500)],'work.bin');
   let failed = false;
   try { await uploadParts(file,'delivery','agreement'); } catch { failed = true; }
   interrupted = false;
   const id = await uploadParts(file,'delivery','agreement');
   return {failed,id,starts,firstChunkCalls:calls.filter(route=>route==='uploads/test/0').length,parts:[...complete]};
  });
  assert.deepEqual(result,{failed:true,id:'test',starts:1,firstChunkCalls:1,parts:[0,1,2]});
  console.log('Interrupted upload resumed without resending completed chunks.');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
