'use strict';
// Revision checks run only while visible; one small request is in flight at a time.
const liveState={owner:null,revision:null,count:0,pending:null,failures:0,mutations:0,polling:false,timer:null,dirty:new WeakSet()};
const liveAPI=api;
api=async function(route,data,options){
 if(data===undefined)return liveAPI(route,data,options);
 liveState.mutations++;
 try{const result=await liveAPI(route,data,options);const form=route==='profile'?$('#profile-form'):route.endsWith('/notes')?$('#private-note-form'):null;if(form)liveState.dirty.delete(form);return result;}
 finally{liveState.mutations--;}
};
function liveBusy(){
 const focus=document.activeElement;
 return liveState.mutations>0||Boolean(document.querySelector('dialog[open],.loading'))||
  Boolean(focus?.matches('input,textarea,select,[contenteditable="true"]'))||
  [...document.querySelectorAll('input[type="file"]')].some(input=>input.files.length&&(!input.closest('dialog')||input.closest('dialog').open))||
  [...document.querySelectorAll('form')].some(form=>liveState.dirty.has(form)&&(!form.closest('dialog')||form.closest('dialog').open));
}
function liveIndicator(healthy){
 const button=$('.nav-refresh');if(!button)return;
 if(!button.querySelector('.live-dot'))button.insertAdjacentHTML('beforeend','<span class="live-dot" aria-hidden="true"></span>');
 button.classList.toggle('live-reconnecting',!healthy);button.title=healthy?'Live updates connected · checks about every 2 seconds':'Live updates reconnecting · you can still refresh manually';
}
function waitingForUpdate(show){
 let banner=$('#workspace-update');
 if(!show){banner?.remove();return;}
 if(!banner){banner=document.createElement('div');banner.id='workspace-update';banner.setAttribute('role','status');banner.textContent='New workspace updates are waiting. Finish your current form to show them; your edits are being kept.';document.body.append(banner);}
}
function snapshotView(){return {x:scrollX,y:scrollY,filter:document.querySelector('[data-filter][aria-pressed="true"]')?.dataset.filter||escrowFilter,query:$('#escrow-search')?.value??escrowQuery,role:$('#agreement-role')?.value||hostedRole,sort:$('#agreement-sort')?.value||hostedSort,
 details:[...document.querySelectorAll('#main details[open]')].map(detail=>detail.querySelector('summary')?.textContent),focus:document.activeElement?.id};}
function restoreView(view){
 if(!view)return;
 if($('#escrow-search')){escrowFilter=view.filter;escrowQuery=view.query;hostedRole=view.role;hostedSort=view.sort;$('#escrow-search').value=view.query;if($('#agreement-role'))$('#agreement-role').value=view.role;if($('#agreement-sort'))$('#agreement-sort').value=view.sort;updateEscrowResults();}
 for(const detail of document.querySelectorAll('#main details'))if(view.details.includes(detail.querySelector('summary')?.textContent))detail.open=true;
 if(view.focus)document.getElementById(view.focus)?.focus({preventScroll:true});
 scrollTo({left:view.x,top:view.y,behavior:'instant'});
}
async function applyLiveUpdate(){
 if(!liveState.pending)return;
 const page=(location.hash.slice(1)||'overview').split('/')[0];
 // These tools hold local experiments, files or account edits; notify without resetting them.
 if(['lab','verify','settings','help'].includes(page)){liveState.pending=null;waitingForUpdate(false);if(runtime.hosted)await updateInboxBadge().catch(()=>{});return;}
 if(liveBusy()){waitingForUpdate(true);return;}
 const path=location.hash,owner=me?.identity.name,expected=renderVersion+1;let view;
 await render({background:true,canApply:()=>!liveBusy()&&location.hash===path&&me?.identity.name===owner,beforeCommit:()=>{view=snapshotView();}});
 if(renderVersion===expected&&location.hash===path){restoreView(view);liveState.pending=null;waitingForUpdate(false);}
 else if($('.analytics-widget'))mountCharts();
}
function notifyLiveUpdate(events){
 const incoming=events.find(event=>['bundle_imported','peer_settlement_observed','buyer_funding_updated','funding_failure_recovered'].includes(event.event));if(!incoming)return;
 if(incoming.event==='buyer_funding_updated'){toast('Buyer funding updated. Payment can be checked again.');return;}if(incoming.event==='funding_failure_recovered'){toast('The payment can be retried. Buyer funding is needed.');return;}
 const labels={PROPOSED:'New agreement received.',LOCKED:'Your agreement was signed.',DELIVERED:'New delivery received. Your workspace is updating.',ACCEPTED:'A delivery decision was received.',SETTLED:'Payment outcome recorded.',CANCELLED:'The agreement was cancelled.'};
 toast(labels[incoming.data?.state]||'New agreement activity received.');
}
function scheduleLive(delay=1500){clearTimeout(liveState.timer);liveState.timer=setTimeout(pollLiveUpdates,delay);}
async function pollLiveUpdates(){
 if(liveState.polling)return;
 if(document.hidden||!me||runtime.showcase){scheduleLive();return;}
 const owner=me.identity.name;
 if(owner!==liveState.owner){liveState.owner=owner;liveState.revision=me.updates?.revision||null;liveState.count=me.updates?.count||0;liveState.pending=null;waitingForUpdate(false);}
 liveState.polling=true;
 try{
  const response=await fetch('/api/updates?after='+liveState.count,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(response.status===401){me=null;liveState.owner=null;liveState.pending=null;waitingForUpdate(false);authPage();return;}
  if(!response.ok)throw Error('Update connection unavailable');
  const data=await response.json();if(me?.identity.name!==owner||runtime.showcase)return;
  liveState.failures=0;liveIndicator(true);
  if(data.revision!==liveState.revision){if(liveState.revision!==null)notifyLiveUpdate(data.events);liveState.revision=data.revision;liveState.count=data.count;liveState.pending=data;}
  await applyLiveUpdate();
 }catch{liveState.failures++;liveIndicator(false);}
 finally{liveState.polling=false;scheduleLive(Math.min(30000,1500*2**Math.min(liveState.failures,5)));}
}
document.addEventListener('input',event=>{if(event.target.form)liveState.dirty.add(event.target.form);});
document.addEventListener('change',event=>{if(event.target.form)liveState.dirty.add(event.target.form);});
// Skip inactive-tab traffic and check immediately on return/reconnection.
document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleLive(0);});
window.addEventListener('online',()=>scheduleLive(0));
window.addEventListener('focus',()=>scheduleLive(0));
window.addEventListener('pagehide',()=>clearTimeout(liveState.timer));
scheduleLive(0);
