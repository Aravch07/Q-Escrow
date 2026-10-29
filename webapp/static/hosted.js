'use strict';
// Online capabilities extend the shared Desktop interface.
shapes.bell='<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>';
let hostedRole='all',hostedSort='newest',lastUnread=-1;
const originalAuthPage=authPage,originalRender=render,originalResults=updateEscrowResults;

authPage=function(){
 originalAuthPage();if(!runtime.hosted)return;
 document.body.classList.add('hosted');
 $('.auth-local').innerHTML='<span class="dot"></span>Your secure online workspace';
 $('.auth-product-tag').textContent='Confidence, on both sides.';
 $('.login-story .lead').textContent='Create a clear agreement, verify the exact delivery, and keep the evidence together. Your workspace is ready wherever you sign in.';
 $('.login-benefits').innerHTML=`<span>${icon('check')}Verified files</span><span>${icon('check')}Signed at every step</span><span>${icon('check')}Saved online</span>`;
 $('.login-story footer').innerHTML='<span>ML-DSA-65 post-quantum signatures</span><span>Test funds · No real payments</span>';
 $('.demo-box').innerHTML=`<div class="online-assurance">${icon('shield')}<div><strong>Your account. Your agreements.</strong><p>Accounts and evidence are saved securely. Only the buyer and seller can open an agreement.</p></div></div><p class="fine">New here? Choose <strong>Create account</strong>. You’ll receive 10 test ETH to explore the workflow.</p>`;
 $('.custody p').textContent='Your password protects your signing key. Active sessions stay encrypted, and you can sign out other devices in Settings. Test funds only.';
 if(authMode==='register'){
  $('#username').insertAdjacentHTML('beforebegin','<label for="display-name">Your name <span class="muted">(optional)</span></label><input id="display-name" name="display_name" autocomplete="name" maxlength="80" placeholder="What should we call you?">');
  // Keep each label directly before its own input.
  $('label[for="username"]').remove();$('#username').insertAdjacentHTML('beforebegin','<label for="username">Choose a username</label>');
  $('.password-field').insertAdjacentHTML('afterend','<label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirm_password" type="password" autocomplete="new-password" minlength="8" required placeholder="Enter your password again">');
 }
};

function transferProgress(label,percent){
 let box=$('.transfer-toast');if(!box){box=document.createElement('div');box.className='toast transfer-toast';$('#toasts').replaceChildren(box);}
 box.innerHTML=`<strong>${esc(label)}</strong><span>${Math.round(percent)}%</span><progress max="100" value="${percent}">${Math.round(percent)}%</progress>`;
}
async function uploadParts(file,purpose,escrowId,onProgress=()=>{}){
 const started=await api('uploads/start',{size:file.size,filename:file.name,purpose,escrow_id:escrowId});
 const count=Math.max(1,Math.ceil(file.size/started.chunk_size));
 for(let part=0;part<count;part++){
  const bytes=await file.slice(part*started.chunk_size,(part+1)*started.chunk_size).arrayBuffer();
  for(let attempt=0;;attempt++){
   try{await api(`uploads/${started.upload_id}/${part}`,bytes,{raw:true});break;}
   catch(error){if(attempt>=2||error.status&&error.status<500)throw error;await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
  }
  onProgress((part+1)/count*100);
 }
 return started.upload_id;
}
function saveBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function downloadArtifact(id,kind){
 try{
  const meta=await api(`escrows/${id}/artifact`),parts=[];
  if(kind==='download'&&!meta.file)throw Error('No delivered file is available yet.');
  if(meta.file){
   for(let offset=0;offset<meta.file.size;offset+=runtime.chunk_size){
    const response=await fetch(`/api/escrows/${id}/payload?offset=${offset}`,{credentials:'same-origin'});
    if(!response.ok)throw Error((await response.json()).error||'The download was interrupted. Try again.');
    parts.push(new Uint8Array(await response.arrayBuffer()));transferProgress('Downloading verified evidence',Math.min(100,(offset+runtime.chunk_size)/Math.max(1,meta.file.size)*100));
   }
   const bytes=new Uint8Array(meta.file.size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   const actual=await fileFingerprint(new Blob([bytes]));if(actual!==meta.file.sha256)throw Error('The downloaded file failed its fingerprint check.');
   if(kind==='download'){saveBlob(new Blob([bytes]),meta.file.filename);return;}
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   meta.bundle.payload=btoa(binary);
  }else meta.bundle.payload=null;
  saveBlob(new Blob([JSON.stringify(meta.bundle,null,2)],{type:'application/json'}),id+'.json');
 }finally{$('.transfer-toast')?.remove();}
}

updateEscrowResults=function(){
 if(!runtime.hosted){originalResults();return;}
 const all=escrowRecords;
 escrowRecords=all.filter(r=>hostedRole==='all'||r.role===hostedRole).slice().sort((a,b)=>hostedSort==='deadline'?a.terms.expires_at-b.terms.expires_at:hostedSort==='value'?(BigInt(a.terms.amount_wei)>BigInt(b.terms.amount_wei)?-1:BigInt(a.terms.amount_wei)<BigInt(b.terms.amount_wei)?1:0):b.terms.created_at-a.terms.created_at);
 originalResults();escrowRecords=all;
 $('#escrow-results .agreement-empty h3')?.replaceChildren(document.createTextNode('No agreements match this view.'));
 decorateDeadlines();
};
function decorateDeadlines(){
 if(!runtime.hosted)return;
 for(const link of document.querySelectorAll('#escrow-results .row-title')){
  const r=escrowRecords.find(record=>link.hash.endsWith(record.escrow_id));if(!r||['SETTLED','REJECTED','CANCELLED'].includes(r.state))continue;
  const hours=(r.terms.expires_at-me.now)/3600,span=document.createElement('span');span.className='deadline-note'+(hours<24?' soon':'');
  span.textContent=hours<=0?'Deadline passed':hours<24?`Due in ${Math.max(1,Math.ceil(hours))}h`:'Due '+new Date(r.terms.expires_at*1000).toLocaleDateString();link.parentElement.append(span);
 }
}
async function updateInboxBadge(){
 if(!runtime.hosted||!me||document.hidden)return;
 const name=me.identity.name,{unread}=await api('notifications');if(me?.identity.name!==name)return;
 const badge=$('#inbox-count');if(badge){badge.textContent=unread>99?'99+':String(unread);badge.hidden=unread===0;}
 lastUnread=unread;
}
async function inboxPage(){
 const {events}=await api('notifications');
 const names={account_created:'Your workspace is ready',proposed:'An agreement was created',countersigned:'The terms were signed',delivered:'A delivery is ready',decision_release:'Payment was approved',decision_refund:'A refund was requested',settled_release:'Payment completed',settled_refund:'Refund completed',agreement_cancelled:'Agreement cancelled',settled_cancelled:'Cancellation recorded',bundle_imported:'New agreement evidence',peer_settlement_observed:'Settlement confirmed',claim:'Earnings claimed',wallet_deposit:'Funds deposited'};
 return head('Keep things moving','Your inbox','Updates from your agreements, deliveries, and payments.','<button class="secondary" data-hosted="read-inbox">Mark all as read</button>')+`<section class="card inbox-list">${events.map(e=>`<article class="inbox-item ${e.unread?'unread':''}"><span class="event-icon">${icon(e.event.includes('settled')?'check':'bell')}</span><div><strong>${esc(names[e.event]||e.event.replaceAll('_',' '))}</strong><p>${esc(stamp(e.at))}</p>${e.escrow_id?`<a class="text-link" href="#escrows/${e.escrow_id}">Open agreement ${icon('arrow')}</a>`:''}</div>${e.unread?'<span class="unread-dot" aria-label="Unread"></span>':''}</article>`).join('')||'<div class="empty"><h3>You’re all caught up.</h3><p>Your agreement updates will appear here.</p></div>'}</section>`;
}
async function hostedSettings(){
 const [profile,{sessions}]=await Promise.all([api('profile'),api('sessions')]);
 return `<section class="card hosted-profile"><div class="card-title"><div><p class="eyebrow">Make it yours</p><h2>Your profile</h2></div></div><form id="profile-form"><label for="profile-name">Display name</label><div class="inline-field"><input id="profile-name" name="display_name" value="${esc(profile.display_name)}" maxlength="80" autocomplete="name"><button type="submit">Save profile</button></div><p class="fine">Your signing username remains <strong>${esc(me.identity.name)}</strong>.</p></form></section><section class="card sessions-card"><div class="card-title"><div><p class="eyebrow">Account security</p><h2>Active sessions</h2><p>Sign out a device you no longer use.</p></div><button class="secondary" data-hosted="revoke-others" ${sessions.length<2?'disabled':''}>Sign out other devices</button></div>${sessions.map(s=>`<div class="session-row">${icon('shield')}<div><strong>${s.current?'This browser':'Web session'}</strong><p class="session-device">${esc(s.device)}</p><small>Signed in ${esc(stamp(s.created_at))} · Expires ${esc(stamp(s.expires))}</small></div>${s.current?'<span class="badge verified">Current</span>':`<button class="ghost" data-hosted="revoke-session" data-session="${s.id}">Sign out</button>`}</div>`).join('')}</section>`;
}
async function enhanceHosted(){
 if(!runtime.hosted||!me)return;
 document.body.classList.add('hosted');
 const version=renderVersion,path=location.hash.slice(1)||'overview',[page,id]=path.split('/');
 if(!$('#inbox-link'))$('.top-actions').insertAdjacentHTML('afterbegin',`<a id="inbox-link" href="#inbox" class="icon-button inbox-link" aria-label="Open inbox" title="Your inbox">${icon('bell')}<span id="inbox-count" class="inbox-count" hidden></span></a>`);
 $('.network')?.setAttribute('title',me.online?'Payments are connected':'Payments are paused; this online workspace still needs internet');
 const banner=$('.offline-banner>span');if(banner)banner.textContent='Payments are paused. You can still sign and exchange files here. Connect to finish the payment.';
 const active=()=>version===renderVersion&&me&&(location.hash.slice(1)||'overview')===path;
 if(page==='inbox'){
  const html=await inboxPage();if(active())$('#main').innerHTML=html;
 }else if(page==='settings'){
  const html=await hostedSettings();if(!active())return;
  $('.account-details').insertAdjacentHTML('beforebegin',html);
  $('.account-details>p').textContent='Your saved signing key is encrypted with your password. Each active session is separately encrypted and can be revoked above. Signing runs on the hosted server after your confirmation.';
  const paymentCopy=$('.two-col .card:first-child p');if(paymentCopy)paymentCopy.textContent='Connect to finish payments and move test funds. Pausing payments still lets you sign and exchange files. This hosted workspace needs an internet connection.';
 }else if(page==='escrows'&&id){
  const note=await api(`escrows/${id}/notes`);if(!active())return;
  $('.detail-sidebar').insertAdjacentHTML('beforeend',`<section class="card private-note"><h3>Your private note</h3><p class="fine">Only you can see this. Notes do not change the signed terms.</p><form id="private-note-form" data-id="${id}"><label class="sr-only" for="private-note">Private agreement note</label><textarea id="private-note" name="note" maxlength="4000" rows="4" placeholder="Keep a reminder or delivery checklist…">${esc(note.note)}</textarea><button class="secondary spacer" type="submit">Save note</button><p id="note-status" class="fine" role="status"></p></form></section>`);
 }else if(page==='escrows'){
  hostedRole='all';hostedSort='newest';
  $('.list-toolbar').insertAdjacentHTML('afterend','<div class="advanced-filters"><label for="agreement-role">Your role<select id="agreement-role"><option value="all">All roles</option><option value="buyer">I’m buying</option><option value="seller">I’m delivering</option></select></label><label for="agreement-sort">Sort by<select id="agreement-sort"><option value="newest">Newest first</option><option value="deadline">Deadline first</option><option value="value">Highest amount</option></select></label><a class="button secondary" href="/api/export" download>Export CSV</a></div>');decorateDeadlines();
 }else if(page==='overview'){
  const {escrows}=await api('escrows');if(!active())return;
  const settled=escrows.filter(r=>r.state==='SETTLED'),volume=settled.reduce((sum,r)=>sum+BigInt(r.terms.amount_wei),0n),due=escrows.filter(r=>!['SETTLED','REJECTED','CANCELLED'].includes(r.state)&&r.terms.expires_at>me.now&&r.terms.expires_at-me.now<86400).length;
  $('.balance-grid').insertAdjacentHTML('afterend',`<div class="workspace-insights"><div><span>${icon('check')}Completion rate</span><strong>${escrows.length?Math.round(settled.length/escrows.length*100):0}%</strong><small>${settled.length} of ${escrows.length} agreements</small></div><div><span>${icon('wallet')}Settled volume</span><strong>${eth(volume)} <small>test ETH</small></strong><small>Payments and refunds recorded</small></div><div><span>${icon('clock')}Due in 24 hours</span><strong>${due}</strong><small>Keep an eye on upcoming deadlines</small></div></div>`);
  if(!escrows.length)$('.welcome-guide')?.insertAdjacentHTML('afterend',`<div class="invite-strip">${icon('peer')}<div><strong>Bring your agreement partner.</strong><p>Ask them to create an account here, then choose their username when you create an escrow.</p></div><button class="secondary" data-hosted="copy-invite">Copy invite link</button></div>`);
  const footer=$('.workspace-footer');if(footer)footer.innerHTML=`<span>${icon('lock')}Online workspace · Post-quantum signatures</span><span>Test environment · No real funds</span>`;
  const process=$('.process-strip>p');if(process)process.textContent='Agree and verify first. Settle when you’re ready.';
 }else if(page==='lab')$('.lab-clock')?.remove();
 if(page==='help'){
  for(const p of document.querySelectorAll('#main p'))if(p.textContent.includes('demo1234'))p.textContent='For an end-to-end trial, ask a partner to create a separate account, or use a private browser window for your second account. Each account starts with 10 test ETH.';
  for(const detail of document.querySelectorAll('#main details'))if(/offline|internet/.test(detail.querySelector('summary')?.textContent.toLowerCase()||'')){const p=detail.querySelector('p');if(p)p.textContent='The hosted workspace needs internet to save and sign your agreements. You can pause the payment connection, approve a delivery, then reconnect to finish settlement. The Desktop edition supports working locally without internet.';}
 }
 await updateInboxBadge();
}
render=async function(options){const expected=renderVersion+1;await originalRender(options);if(runtime.hosted&&me&&renderVersion===expected&&$('.workspace')&&!$('.loading'))try{await enhanceHosted();}catch(error){toast(error.message,true);}};

document.addEventListener('change',event=>{if(event.target.id==='agreement-role'){hostedRole=event.target.value;updateEscrowResults();}if(event.target.id==='agreement-sort'){hostedSort=event.target.value;updateEscrowResults();}});
document.addEventListener('click',async event=>{
 if(!runtime.hosted)return;
 if(event.target.closest('[data-action="reset-filter"]')){hostedRole='all';hostedSort='newest';if($('#agreement-role'))$('#agreement-role').value='all';if($('#agreement-sort'))$('#agreement-sort').value='newest';updateEscrowResults();return;}
 const link=event.target.closest('a[href]'),artifact=link?.getAttribute('href')?.match(/^\/api\/escrows\/([0-9a-f]{64})\/(download|bundle)$/);
 if(artifact){event.preventDefault();try{await downloadArtifact(artifact[1],artifact[2]);}catch(error){toast(error.message,true);}return;}
 const button=event.target.closest('[data-hosted]');if(!button)return;
 try{
  button.disabled=true;
  if(button.dataset.hosted==='read-inbox'){await api('notifications',{});lastUnread=0;await render();}
  if(button.dataset.hosted==='copy-invite'){await navigator.clipboard.writeText(location.origin);toast('Invite link copied. Share it with your partner.');}
  if(button.dataset.hosted==='revoke-others'||button.dataset.hosted==='revoke-session'){await api('sessions/revoke',{session_id:button.dataset.session||'others'});toast('Selected sessions signed out.');await render();}
 }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
document.addEventListener('submit',async event=>{
 const form=event.target;if(!['profile-form','private-note-form'].includes(form.id))return;
 event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;
 try{
  if(form.id==='profile-form'){await api('profile',{display_name:$('#profile-name').value});toast('Profile saved.');}
  else{await api(`escrows/${form.dataset.id}/notes`,{note:$('#private-note').value});if(form.isConnected)$('#note-status').textContent='Saved just for you.';}
 }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
async function startWorkspace(){try{runtime=await api('config');}catch{}const query=new URL(location.href).searchParams;if(query.get('signup')==='1')authMode='register';if(query.get('demo')==='1'){try{await enableShowcase();}catch(error){toast(error.message,true);}}else if(runtime.preview&&query.get('sample')==='1'){try{await api('login',{username:'alice',password:'demo1234'});}catch{}}await render();}
