'use strict';
const $ = (selector, root=document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const short = (value, n=12) => String(value || '').slice(0,n) + (String(value || '').length > n ? '…' : '');
const stamp = value => new Date(value*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const ETH = 1000000000000000000n;
function eth(value) { const n=BigInt(value||0); const frac=(n%ETH).toString().padStart(18,'0').replace(/0+$/,''); return (n/ETH).toString()+(frac?'.'+frac:''); }
function wei(value) { if(!/^\d+(\.\d{1,18})?$/.test(value)) throw Error('Enter a positive ETH amount with at most 18 decimal places'); const [a,b='']=value.split('.'); const n=BigInt(a)*ETH+BigInt(b.padEnd(18,'0')); if(n<=0n) throw Error('Amount must be positive'); return n.toString(); }
const statusLabels={PROPOSED:'Awaiting signature',LOCKED:'Ready for delivery',DELIVERED:'Review delivery',ACCEPTED:'Ready to settle',SETTLED:'Settled',REJECTED:'Needs review'};
const badge = state => `<span class="badge ${esc(state.toLowerCase())}"><span class="status-dot"></span>${esc(statusLabels[state]||state.toLowerCase())}</span>`;
let me=null, currentDetail=null, detailTab='checks', authMode='login', renderVersion=0;
let runtime={hosted:location.protocol==='https:',chunk_size:1048576};
const navItems=[['overview','◈','Overview'],['escrows','▤','Escrows'],['wallet','◇','Wallet'],['ledger','≋','Ledger'],['verify','✓','Verify'],['lab','⌁','Attack lab'],['activity','◷','Activity'],['settings','⚙','Settings and keys']];

const shapes={
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
 wallet:'<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v5h5M16 14.5h.01"/>',
 ledger:'<path d="M3 9h18M5 9v10m5-10v10m4-10v10m5-10v10M3 21h18M2 7l10-5 10 5Z"/>',
 shield:'<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z"/><path d="m8.5 11 2.5 2.5 4.5-5"/>',
 lab:'<path d="M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10"/><path d="M10 18h.01M14 17h.01"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 settings:'<path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1 .5 2h4l.5-2 2-1 2 .5 2-3-1.5-2v-3L20.5 9l-2-3-2 .5-2-1-.5-2Z"/><circle cx="11" cy="12" r="3"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 arrowUp:'<path d="M6 18 18 6M6 6h12v12"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
 download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
 upload:'<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3"/>',
 moon:'<path d="M20.5 13.5A9 9 0 0 1 10.5 3a9 9 0 1 0 10 10.5Z"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 exit:'<path d="M9 4H4v16h5M13 8l4 4-4 4M8 12h13"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 peer:'<circle cx="5" cy="6" r="3"/><circle cx="19" cy="18" r="3"/><path d="M8 6h5a6 6 0 0 1 6 6v3M16 18h-5a6 6 0 0 1-6-6V9"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 circle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>'
};
function icon(name,cls=''){return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes[name]||shapes.shield}</svg>`;}
function brand(){return `<span class="brand-symbol" aria-hidden="true">${icon('shield')}</span><span>PQ<span class="brand-separator"> </span>Escrow</span>`;}
function person(name,cls=''){const color=(String(name).charCodeAt(0)||0)%5;return `<span class="person-avatar color-${color} ${cls}" aria-hidden="true">${esc(String(name).slice(0,2).toUpperCase())}</span>`;}
function amount(value){const [whole,fraction]=eth(value).split('.');return `${esc(whole)}${fraction?`<span class="fraction">.${fraction}</span>`:''}`;}
let escrowRecords=[],escrowFilter='all',escrowQuery='';
function updateEscrowResults(){const filtered=escrowRecords.filter(r=>(escrowFilter==='all'||escrowFilter==='active'&&!['SETTLED','REJECTED'].includes(r.state)||escrowFilter==='settled'&&r.state==='SETTLED'||escrowFilter==='review'&&r.state==='REJECTED')&&[r.terms.description,r.terms.buyer.name,r.terms.seller.name,r.escrow_id,eth(r.terms.amount_wei)].join(' ').toLowerCase().includes(escrowQuery.toLowerCase()));$('#escrow-results').innerHTML=escrowTable(filtered,Boolean(escrowQuery||escrowFilter!=='all'));document.querySelectorAll('[data-action="filter"]').forEach(b=>{const selected=b.dataset.filter===escrowFilter;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});}

function applyTheme(value) { if(value==='device') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme=value; localStorage.setItem('pqe-theme',value); }
if(localStorage.getItem('pqe-design')!=='finance-2'){localStorage.setItem('pqe-design','finance-2');applyTheme('light');}
else applyTheme(localStorage.getItem('pqe-theme') || 'light');
async function api(route, data, options={}) {
  const headers={}; let body;
  if(data!==undefined) { headers['X-Requested-With']='PQEscrow'; if(options.raw){body=data; Object.assign(headers,options.headers||{});}else{headers['Content-Type']='application/json';body=JSON.stringify(data);} }
  let response;
  try{response=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers,body,credentials:'same-origin'});}
  catch{const error=Error(runtime.hosted||location.protocol==='https:'?'Your connection was interrupted. Check your internet connection and try again.':`Cannot reach PQ-Escrow at ${location.origin}. Open the project folder, double-click start_web.bat and keep its window open. Then open the address printed in that window and try again.`);error.status=0;throw error;}
  const result=await response.json();
  if(!response.ok){const error=Error(result.error||'Request failed');error.status=response.status;throw error;}
  return result;
}
function toast(message, bad=false) { const div=document.createElement('div');div.className='toast'+(bad?' error-toast':'');div.textContent=message;$('#toasts').replaceChildren(div);setTimeout(()=>div.remove(),5000); }
function head(eyebrow,title,description,action='') { return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="muted">${description}</p></div>${action}</div>`; }
const newButton='<button data-action="new">＋ Create escrow</button>';
function shell() {
 const page=(location.hash.slice(1)||'overview').split('/')[0];
 const primary=[['overview','grid','Home'],['escrows','file','Agreements'],['wallet','wallet','Wallet'],['activity','clock','Activity']];
 const tools=[['ledger','ledger','Ledger','Recorded payments and balances'],['verify','shield','Verify','Check a file or signed bundle'],['lab','lab','Attack lab','Explore security with practice copies'],['settings','settings','Settings','Appearance, account and signing identity']];
 $('#app').innerHTML=`<header class="app-header"><div class="header-inner"><a class="logo" href="#overview">${brand()}</a><span class="workspace-name">Your workspace</span><div class="top-actions"><span class="test-tag">Test funds only</span><button class="network ${me.online?'':'offline'}" data-action="network" aria-label="${me.online?'Go offline':'Go online'}" title="${me.online?'Payment connection is online':'You can sign offline; connect to finish payments'}"><span class="dot"></span>${me.online?'Online':'Offline'}</button><a class="icon-button help-link ${page==='help'?'active':''}" href="#help" aria-label="Help and getting started" title="Help and getting started">${icon('circle')}<span>?</span></a><button class="icon-button theme-shortcut" data-action="theme" aria-label="Toggle light or dark appearance" title="Change appearance">${icon('sun')}</button><div class="account-menu"><a href="#settings" class="profile-link" aria-label="Settings for ${esc(me.identity.name)}">${person(me.identity.name)}<span>${esc(me.identity.name)}</span></a><button class="icon-button" data-action="logout" aria-label="Sign out ↗" title="Sign out">${icon('exit')}</button></div></div></div><div class="nav-bar simple-nav"><nav class="primary-nav" aria-label="Main navigation">${primary.map(([id,symbol,name])=>`<a href="#${id}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${icon(symbol)}<span>${name}</span></a>`).join('')}</nav><div class="nav-tools"><button id="tools-toggle" class="tools-toggle ${tools.some(([id])=>id===page)?'active':''}" data-action="toggle-tools" aria-expanded="false" aria-controls="tools-menu">Tools ${icon('chevron')}</button><div id="tools-menu" class="tools-menu" role="navigation" aria-label="Tools" hidden>${tools.map(([id,symbol,name,description])=>`<a href="#${id}" aria-label="${name}" ${page===id?'aria-current="page"':''}>${icon(symbol)}<span><strong>${name}</strong><small>${description}</small></span></a>`).join('')}<a href="#help" aria-label="Getting started">${icon('file')}<span><strong>Getting started</strong><small>A short guide for buyers and sellers</small></span></a><button data-action="refresh" class="ghost">${icon('refresh')}Refresh workspace</button></div></div><button class="icon-button nav-refresh" data-action="refresh" aria-label="Refresh workspace" title="Refresh workspace">${icon('refresh')}</button></div></header><div class="workspace">${me.online?'':`<div class="offline-banner"><span>${icon('peer')}You’re working offline. Agreements and files still work; connect to finish payments.</span><button class="ghost" data-action="network">Connect now</button></div>`}<main id="main" class="content" tabindex="-1"><p class="loading">Opening your workspace…</p></main></div>`;
}
function closeTools(focus=false){const menu=$('#tools-menu'),button=$('#tools-toggle');if(menu)menu.hidden=true;if(button){button.setAttribute('aria-expanded','false');if(focus)button.focus();}}
function gettingStarted(){
 if(localStorage.getItem('pqe-guide-hidden:'+me.identity.name))return '';
 return `<section class="welcome-guide" aria-label="Getting started"><div><p class="eyebrow">A good place to start</p><h2>One agreement. Three simple steps.</h2><p>Write down the work, review the delivery, then finish the payment.</p></div><ol><li><span>1</span>Agree on the details</li><li><span>2</span>Check the delivered file</li><li><span>3</span>Finish the payment</li></ol><div class="welcome-guide-actions"><a class="text-link" href="#help">Show me how ${icon('arrow')}</a><button class="ghost" data-action="hide-guide" aria-label="Hide getting started guide">${icon('close')}</button></div></section>`;
}
let helpRole='buyer';
function helpSteps(role){
 const buying=role==='buyer';
 const steps=buying?[
 ['Add funds','Open Wallet and deposit test funds to back your agreement. Alice’s demo account already has a deposit.','#wallet','Open Wallet'],
 ['Create the agreement','Choose the seller, amount and deadline. Add a reference file if you know the exact file you expect.','new','Create an escrow'],
 ['Review the delivery','The seller signs the terms and sends a file. Download it and check the work before approving payment.','#escrows','Open Agreements'],
 ['Finish the payment','After signing your approval, choose Finish payment while online. The seller can then collect their earnings.','#escrows','View your agreements']
 ]:[
 ['Open the buyer’s agreement','Find the agreement in Agreements. Read the description, price and deadline.','#escrows','Open Agreements'],
 ['Agree and sign','Add your signature when you agree to the terms. This lets you send your delivery.','#escrows','Find an agreement'],
 ['Send the correct file','Choose your delivery. If an exact file was agreed, a different file is blocked before it can be signed or saved.','#escrows','Go to your agreements'],
 ['Collect your earnings','The buyer reviews and approves the file. Once payment is finished, open Wallet and claim your earnings.','#wallet','Open Wallet']
 ];
 return `<ol class="help-steps">${steps.map(([title,copy,href,label],i)=>`<li><span class="help-step-number">${i+1}</span><div><h3>${title}</h3><p>${copy}</p>${href==='new'?`<button class="secondary" data-action="new">${label}</button>`:`<a class="text-link" href="${href}">${label} ${icon('arrow')}</a>`}</div></li>`).join('')}</ol>`;
}
function helpPage(){
 return head('Getting started','A clear path from agreement to payment.','Choose your role and follow the steps. You can come back here any time.')+`<div class="help-layout"><section class="card help-main"><div class="tabs" role="tablist" aria-label="Your role"><button role="tab" id="help-buyer" aria-selected="${helpRole==='buyer'}" aria-controls="help-role-panel" data-action="help-role" data-role="buyer">I’m buying</button><button role="tab" id="help-seller" aria-selected="${helpRole==='seller'}" aria-controls="help-role-panel" data-action="help-role" data-role="seller">I’m delivering</button></div><div id="help-role-panel" role="tabpanel" aria-labelledby="help-${helpRole}">${helpSteps(helpRole)}</div></section><aside><section class="card help-demo"><h2>Try it with Alice and Bob</h2><p>Alice buys the work. Bob delivers the file. Their demo password is <strong>demo1234</strong>.</p><p>Use a private window for Bob if you want both accounts signed in at once. Or sign out and switch accounts.</p><span class="badge verified">Test funds only</span></section><section class="card help-shortcuts"><h2>Find what you need</h2>${[['#escrows','Your agreements'],['#wallet','Funds and earnings'],['#activity','Your activity'],['#lab','Practice in Attack lab'],['#settings','Account and preferences']].map(([href,label])=>`<a href="${href}">${label}${icon('arrow')}</a>`).join('')}<button class="ghost" data-action="show-guide">Show the Home guide again</button></section></aside></div><section class="card help-faq"><h2>A few useful answers</h2>${[
 ['What is an escrow?','An agreement to pay for a delivery, with signed terms and evidence. In this demo, one deposited balance backs your agreements; a separate amount is not reserved for each one.'],
 ['What is a file fingerprint?','A code calculated from the file’s exact contents. If you choose a reference file when creating an escrow, the seller must deliver matching bytes. The name can differ, but the contents must match.'],
 ['Does approving a delivery send the payment?','Approval signs your decision. Finish payment then checks the evidence and records the outcome. The seller collects the resulting earnings from Wallet.'],
 ['What can I do offline?','You can agree, sign, send files and approve a delivery through this running local app. Connect the payment link to add or withdraw funds, finish payments, or collect earnings.'],
 ['What if the file is wrong?','A different file is blocked when an exact fingerprint was agreed. Without a reference fingerprint, review the file yourself before paying. Old deliveries already signed in a previous version keep their history; use a new agreement for a replacement.'],
 ['Where are the advanced tools?','Open Tools for the Ledger, Verify and Attack lab. Full signatures and verification checks are inside each agreement’s Evidence details. Your signing identity is in Settings.']
 ].map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</section>`;
}

function authPage() {
 me=null;
 $('#app').innerHTML=`<main id="main" class="login"><section class="login-story"><a class="logo" href="#">${brand()}</a><div class="login-intro"><span class="auth-product-tag">A little more certainty.</span><h1>Good work deserves<br><em>a clear agreement.</em></h1><p class="lead">Agree on the details, share the delivery, and make the payment with confidence.</p><div class="auth-preview"><div class="preview-heading"><span class="preview-icon">${icon('file')}</span><div><strong>Every detail, agreed.</strong><span>From first signature to final payment</span></div><span class="preview-verified">${icon('check')}Verified</span></div><div class="preview-path"><div>${icon('file')}<strong>Agree</strong><span>Clear, signed terms</span></div><span class="preview-line"></span><div>${icon('shield')}<strong>Verify</strong><span>Proof of delivery</span></div><span class="preview-line"></span><div>${icon('wallet')}<strong>Settle</strong><span>A recorded outcome</span></div></div><div class="preview-footer">${icon('lock')}Your agreement. Your evidence.</div></div><div class="login-benefits"><span>${icon('check')}Works offline</span><span>${icon('check')}Signed at every step</span><span>${icon('check')}Runs locally</span></div></div><footer><span>Post-quantum signatures. Practical peace of mind.</span><span>Local test environment</span></footer></section><section class="login-form-side"><div class="login-form-wrap"><span class="auth-local"><span class="dot"></span>Your personal workspace</span><div class="tabs auth-tabs" role="tablist" aria-label="Account access"><button role="tab" id="login-tab" aria-controls="auth-panel" aria-selected="${authMode==='login'}" data-action="auth-login">Sign in</button><button role="tab" id="register-tab" aria-controls="auth-panel" aria-selected="${authMode==='register'}" data-action="auth-register">Create account</button></div><div id="auth-panel" role="tabpanel" aria-labelledby="${authMode==='login'?'login':'register'}-tab"><h2>${authMode==='login'?'Welcome back':'Your workspace starts here'}</h2><p class="auth-description">${authMode==='login'?'Your agreements and payments, all in one place.':'Create an account to start your first agreement.'}</p><form id="auth-form"><label for="username">Username</label><input id="username" name="username" autocomplete="username" placeholder="Enter your username" required minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}"><label for="password">Password</label><div class="password-field"><input id="password" name="password" type="password" autocomplete="${authMode==='login'?'current-password':'new-password'}" placeholder="${authMode==='login'?'Enter your password':'At least 8 characters'}" required ${authMode==='register'?'minlength="8"':''}><button type="button" data-action="toggle-password" class="icon-button" aria-label="Show password" title="Show password">${icon('eye')}</button></div>${authMode==='register'?'<p class="field-help">Use 3–20 lowercase letters, numbers or underscores for your username, and at least 8 characters for your password.</p>':''}<p id="auth-error" class="error" role="alert"></p><button type="submit">${authMode==='login'?'Sign in →':'Create account →'}</button></form></div><div class="demo-box"><div class="demo-heading"><span>Take a look around</span><span class="demo-caption">Choose a demo account</span></div><div class="demo-chips">${['alice','bob','carol'].map(name=>`<button class="secondary" data-action="demo" data-name="${name}">${person(name)}<span>${name}</span>${icon('arrowUp')}</button>`).join('')}</div><p class="fine">Demo password: <strong>demo1234</strong> · Alice buys. Bob delivers.</p></div><div class="custody">${icon('lock')}<p>Your password protects the saved signing key. Signing happens on this local server. Test funds only.</p></div></div></section></main>`;
 if(document.activeElement===document.body || document.activeElement===$('#app')) requestAnimationFrame(()=>{if(document.activeElement===document.body) $('#username')?.focus();});
}
function nextAction(r) {
 if(r.state==='REJECTED') return 'Manual review required';
 if(r.settlement) return r.settlement.release?'Payment released':'Refund recorded';
 if(r.verification.outcome==='REFUND') return 'Finish refund';
 if(r.state==='PROPOSED') return r.role==='seller'?'Review and sign':'Waiting for seller';
 if(r.state==='LOCKED') return r.role==='seller'?'Upload the delivery':'Waiting for delivery';
 if(r.state==='DELIVERED') return r.role==='buyer'?'Review file and decide':'Waiting for buyer';
 return me.online?'Finish payment':'Queued for settlement';
}
function escrowTable(records,filtered=false) {
 if(!records.length) return `<div class="empty ${filtered?'filtered-empty':'agreement-empty'}"><span class="empty-icon">${icon(filtered?'search':'file')}<span class="empty-check">${icon('check')}</span></span><h3>${filtered?'No agreements found.':'Your next agreement starts here'}</h3><p>${filtered?'Try another search or choose a different status.':'Agree on the work. Keep the evidence. Pay when it’s delivered.'}</p>${filtered?'<button class="secondary" data-action="reset-filter">Clear filters</button>':'<button data-action="new">'+icon('plus')+'Create your first escrow</button>'}${filtered?'':`<div class="empty-steps"><span><b>1</b>Agree on terms</span><i></i><span><b>2</b>Review delivery</span><i></i><span><b>3</b>Settle payment</span></div>`}</div>`;
 return `<div class="table-wrap"><table class="escrow-table"><thead><tr><th>Agreement</th><th>Your role</th><th>Amount</th><th>Status</th><th>Next step</th></tr></thead><tbody>${records.map(r=>{const other=r.terms[r.role==='buyer'?'seller':'buyer'].name;return `<tr><td><div class="agreement-cell">${person(other)}<div><a class="row-title" href="#escrows/${r.escrow_id}">${esc(r.terms.description.slice(0,68))}</a><span class="row-sub">${esc(other)}<span class="row-separator">·</span>#${r.terms.seq}</span></div></div></td><td><span class="role-label">${esc(r.role)}</span></td><td class="money-cell"><strong>${eth(r.terms.amount_wei)}</strong><span>test ETH</span></td><td>${badge(r.state)}</td><td><a class="next-link" href="#escrows/${r.escrow_id}"><span>${esc(nextAction(r))}</span>${icon('arrow')}</a></td></tr>`;}).join('')}</tbody></table></div>`;
}
function walletStats(w) { return `<div class="stats"><div class="card stat-card"><div class="stat-top"><span class="stat-icon">${icon('wallet')}</span><span class="stat-label">Wallet funds</span></div><div class="stat-value">${amount(w.funds)} <span>ETH</span></div><div class="stat-note">Ready to deposit into escrow</div></div><div class="card stat-card"><div class="stat-top"><span class="stat-icon">${icon('lock')}</span><span class="stat-label">Escrow balance</span></div><div class="stat-value">${amount(w.account.balance)} <span>ETH</span></div><div class="stat-note">${w.account.lockedUntil>w.now?icon('clock')+'Locked until '+esc(stamp(w.account.lockedUntil)):icon('check')+'Available to withdraw'}</div></div><div class="card stat-card"><div class="stat-top"><span class="stat-icon green">${icon('download')}</span><span class="stat-label">Earnings to claim</span></div><div class="stat-value">${amount(w.account.claimable)} <span>ETH</span></div><div class="stat-note">Released payments ready to collect</div></div></div>`; }

async function overview() {
 const [w,{escrows:records},audit]=await Promise.all([api('wallet'),api('escrows'),api('audit')]);
 const attention=records.filter(r=>!r.settlement&&!r.rejection && (r.state==='ACCEPTED'||r.verification.outcome==='REFUND'||r.role==='seller'&&['PROPOSED','LOCKED'].includes(r.state)||r.role==='buyer'&&r.state==='DELIVERED'));
 const recent=records.slice().sort((a,b)=>b.terms.created_at-a.terms.created_at).slice(0,5);
 const eventNames={account_created:'Workspace created',proposed:'Agreement created',countersigned:'Terms countersigned',delivered:'Delivery signed',decision_release:'Release approved',decision_refund:'Refund requested',settled_release:'Payment released',settled_refund:'Refund recorded',bundle_imported:'Evidence received',peer_settlement_observed:'Settlement confirmed',claim:'Earnings claimed',wallet_deposit:'Funds deposited'};
 const active=records.filter(r=>!['SETTLED','REJECTED'].includes(r.state)).length;
 return head('Account overview',`Good ${new Date(me.now*1000).getHours()<12?'morning':'day'}, ${esc(me.identity.name)}.`,'Let’s keep your agreements moving.',newButton)+gettingStarted()+`
 <div class="balance-grid"><section class="balance-primary"><div class="metric-heading"><span>${icon('lock')}Escrow balance</span><span class="balance-label">${w.account.lockedUntil>w.now?'Time locked':'Available'}</span></div><div class="balance-number">${amount(w.account.balance)}<span>test ETH</span></div><div class="balance-foot"><span>Funds backing your agreements</span><a href="#wallet" aria-label="Manage escrow funds">${icon('arrowUp')}</a></div><span class="balance-art" aria-hidden="true"></span></section><section class="card balance-secondary"><div class="metric-heading"><span>Available in wallet</span><span class="metric-icon">${icon('wallet')}</span></div><div class="balance-number">${amount(w.funds)}<span>test ETH</span></div><div class="balance-foot"><span>Ready to fund an escrow</span><a href="#wallet">Manage wallet ${icon('arrow')}</a></div></section><section class="card balance-secondary"><div class="metric-heading"><span>Earnings to claim</span><span class="metric-icon green">${icon('download')}</span></div><div class="balance-number">${amount(w.account.claimable)}<span>test ETH</span></div><div class="balance-foot"><span>From completed agreements</span><a href="#wallet">View earnings ${icon('arrow')}</a></div></section></div>
 <section class="action-strip ${attention.length?'has-actions':''}" aria-label="Actions waiting"><span class="action-strip-icon">${icon(attention.length?'clock':'circle')}</span><div><strong>${attention.length?attention.length+' action'+(attention.length===1?'':'s')+' waiting for you':'You’re all caught up'}</strong><span>${attention.length?'Review the next step to keep things moving.':'No signatures or decisions need your attention.'}</span></div>${attention.length?`<a href="#escrows/${attention[0].escrow_id}" class="text-link">${esc(nextAction(attention[0]))}${icon('arrow')}</a>`:`<span class="connected-note"><span class="dot"></span>${me.online?'Payment connection ready':'Working offline'}</span>`}</section>
 <div class="overview-grid"><section class="card recent-card"><div class="card-title"><div><h2>Your agreements</h2><p>${active} in progress<span class="row-separator">·</span>${records.filter(r=>r.state==='SETTLED').length} settled</p></div><a class="text-link" href="#escrows">View all ${icon('arrow')}</a></div>${escrowTable(recent)}</section><aside class="overview-side"><section class="card overview-activity"><div class="card-title"><h2>Recent activity</h2><a href="#activity" class="icon-link" aria-label="View all activity">${icon('arrowUp')}</a></div>${audit.entries.slice(-4).reverse().map(e=>`<div class="mini-event"><span class="event-icon">${icon(e.event.includes('settled')?'check':e.event.includes('delivered')?'upload':e.event.includes('account')?'shield':'file')}</span><div><strong>${esc(eventNames[e.event]||e.event.replaceAll('_',' '))}</strong><span>${esc(stamp(e.at))}</span></div></div>`).join('')||'<p class="muted">Your activity will appear here.</p>'}<a href="#activity" class="activity-all">See your full history ${icon('arrow')}</a></section><section class="assurance-card"><span class="assurance-icon">${icon('shield')}</span><div><h3>Evidence at every step</h3><p>Signed terms, a verified file, and a recorded outcome. The details stay with your agreement.</p><a class="text-link" href="#verify">Verification tools ${icon('arrow')}</a></div></section></aside></div>
 <section class="process-strip"><div><span class="process-symbol">${icon('peer')}</span><strong>Built for the way you work</strong></div><p>Agree and exchange files offline. Reconnect to settle.</p><a href="#ledger">Explore the ledger ${icon('arrowUp')}</a></section><footer class="workspace-footer"><span>${icon('lock')}Local workspace<span class="row-separator">·</span>Post-quantum signatures</span><span>Demo environment · No real funds</span></footer>`;
}
async function escrowList() {
 const {escrows}=await api('escrows');escrowRecords=escrows.slice().sort((a,b)=>b.terms.created_at-a.terms.created_at);escrowFilter='all';escrowQuery='';
 return head('Agreement management','Your agreements','See what’s waiting, what’s finished, and what to do next.',newButton)+`<section class="card agreements-card"><div class="list-toolbar"><div class="filter-group" aria-label="Filter agreements">${[['all','All agreements'],['active','In progress'],['settled','Settled'],['review','Needs review']].map(([key,label])=>`<button data-action="filter" data-filter="${key}" aria-pressed="${key==='all'}" class="filter-button ${key==='all'?'selected':''}">${label}<span>${escrows.filter(r=>key==='all'||key==='active'&&!['SETTLED','REJECTED'].includes(r.state)||key==='settled'&&r.state==='SETTLED'||key==='review'&&r.state==='REJECTED').length}</span></button>`).join('')}</div><label class="search-field" for="escrow-search">${icon('search')}<span class="sr-only">Search agreements</span><input id="escrow-search" type="search" placeholder="Search agreements…" autocomplete="off"></label></div><div id="escrow-results">${escrowTable(escrowRecords)}</div></section><div class="info-strip">${icon('shield')}<p>Each agreement carries its own signed terms, delivery receipt, and buyer decision. Open one to inspect the evidence.</p></div>`;
}
function renderChecks(checks) { return checks.map(c=>`<div class="check ${c.ok?'':'fail'}"><span class="check-symbol" aria-hidden="true">${c.ok?'✓':'!'}</span><div><strong>${esc(c.label)}</strong><p>${esc(c.detail)}</p></div></div>`).join(''); }
function activities(entries) {
 const names={account_created:'Account created',proposed:'Agreement created',countersigned:'Terms countersigned',delivered:'Delivery hashed and signed',decision_release:'Release decision signed',decision_refund:'Refund decision signed',bundle_imported:'Signed evidence received',settled_release:'Payment released',settled_refund:'Refund recorded',peer_settlement_observed:'Counterparty settlement confirmed',rejected:'Escrow flagged for review',reconcile_hold:'Waiting for more evidence',wallet_deposit:'Test funds deposited',withdraw:'Funds withdrawn',claim:'Earnings claimed',demo_clock_advanced:'Demo clock advanced'};
 return entries.length?`<div class="audit-timeline">${entries.slice().reverse().map(e=>`<div class="activity-item"><span class="event-icon">${icon(e.event.includes('settled')?'check':e.event==='delivered'?'upload':e.event==='claim'?'wallet':'file')}</span><div class="activity-copy"><div class="activity-title"><strong>${esc(names[e.event]||e.event.replaceAll('_',' '))}</strong><span>${esc(stamp(e.at))}</span></div><p>Entry ${e.id}${e.escrow_id?`<span class="row-separator">·</span><a href="#escrows/${esc(e.escrow_id)}">Agreement ${esc(short(e.escrow_id,8))}</a>`:'<span class="row-separator">·</span>Workspace activity'}</p><details class="audit-proof"><summary>View audit proof</summary><p class="hash">Entry hash: ${esc(e.hash)}</p><p class="hash">Previous hash: ${esc(e.prev_hash||'Genesis entry')}</p>${e.escrow_id?`<p class="hash">Escrow: ${esc(e.escrow_id)}</p>`:''}</details></div><span class="audit-link-mark" title="Hash-chained entry">${icon('lock')}</span></div>`).join('')}</div>`:'<div class="empty"><span class="empty-icon">'+icon('clock')+'</span><h3>A fresh start.</h3><p>Your signed actions will appear here.</p></div>';
}
function tabContent(r) {
 if(detailTab==='terms') return `<pre>${esc(JSON.stringify(r.terms,null,2))}</pre>`;
 if(detailTab==='activity') return activities(r.activity);
 if(detailTab==='bundle') return `<p class="fine">Full signed evidence, including the payload. Its canonical SHA-256 is anchored at settlement.</p><a class="button secondary" href="/api/escrows/${r.escrow_id}/bundle" download>Download signed bundle</a><pre>${esc(JSON.stringify({...r.bundle,payload:r.bundle.payload?'[payload included in download]':null},null,2))}</pre>`;
 return renderChecks(r.checks);
}
async function detail(id) {
 const r=await api('escrows/'+id);currentDetail=r;const t=r.terms;
 const done=[Boolean(r.bundle.signatures.seller),Boolean(r.delivery),Boolean(r.acceptance),Boolean(r.settlement)];const current=r.settlement?4:!r.bundle.signatures.seller?0:!r.delivery?1:!r.acceptance?2:3;const wrongExpected=Boolean(r.delivery&&t.expected_sha256&&r.delivery.sha256!==t.expected_sha256);
 let action='',actionTitle='Your next step',actionCopy=nextAction(r)+'.';
 if(!r.settlement&&!r.rejection){
  if(r.role==='seller'&&r.state==='PROPOSED'&&r.now<t.expires_at){actionTitle='Review and sign the agreement.';actionCopy='Review the buyer’s terms, then add your signature to commit to the delivery.';action=`<button data-action="countersign" data-id="${id}">Agree and sign ${icon('arrow')}</button>`;}
  if(r.role==='seller'&&r.state==='LOCKED'){actionTitle='Your delivery starts here.';actionCopy=t.expected_sha256?'Choose the agreed file. Its fingerprint must match before you can sign or upload.':'Choose the agreed file. We’ll hash it and ask you to sign the receipt.';action=`<form id="delivery-form" data-id="${id}">${t.expected_sha256?`<div class="delivery-expected"><span>Exact file check is on</span><details><summary>View agreed fingerprint</summary><p class="hash">${esc(t.expected_sha256)}</p></details></div>`:''}<div class="dropzone" id="dropzone"><span class="upload-icon">${icon('upload')}</span><strong>Drop your delivery here</strong><p>or choose a file · Up to 25 MB</p><label class="sr-only" for="delivery-file">Delivery file</label><input type="file" id="delivery-file" name="file" required></div><div id="delivery-file-status" role="status" aria-live="polite"></div><button type="submit" disabled>Send delivery</button></form>`;}
  if(r.role==='buyer'&&r.state==='DELIVERED'){actionTitle=wrongExpected?'This file does not match.':'Review the delivery.';actionCopy=wrongExpected?'This earlier delivery differs from the agreed fingerprint. Payment is blocked. Record a refund and use a new agreement for the correct file.':'Download the file and check the work. Approve payment only when you are satisfied.';action=wrongExpected?`<button class="danger" data-action="refund" data-id="${id}">Reject and refund</button>`:`<div class="decision-actions"><button data-action="release" data-id="${id}">Release payment ${icon('arrow')}</button><details class="refund-option"><summary>Need to reject this delivery?</summary><p>Sign a refund decision if the delivery does not meet the agreement.</p><button class="danger" data-action="refund" data-id="${id}">Reject and refund</button></details></div>`;}
  if(r.state==='ACCEPTED'){actionTitle='Your payment is approved.';actionCopy='Your approval is saved. Finish the payment to record the outcome and make the seller’s earnings available.';}
  if(r.state==='ACCEPTED'||r.verification.outcome==='REFUND')action+=`<div class="settle-action">${!me.online?'<button data-action="network">Connect to finish</button>':''}<button class="${me.online?'':'secondary'}" data-action="reconcile" ${me.online?'':'disabled'}>${icon('shield')}${r.verification.outcome==='REFUND'?'Finish refund':'Finish payment'}</button><p class="fine">Checks all your pending agreements and records eligible payments or refunds. Requires an online payment connection.</p></div>`;
  else if(!action){const other=t[r.role==='buyer'?'seller':'buyer'].name;actionTitle=r.state==='PROPOSED'?`Waiting for ${other} to sign`:r.state==='LOCKED'?`Waiting for ${other}’s delivery`:`Waiting for ${other}’s review`;actionCopy=r.state==='PROPOSED'?'The other person will review the terms and add their signature. There is nothing else for you to sign yet.':r.state==='LOCKED'?'The seller will send the agreed file. You’ll review it here before approving payment.':'Your delivery has been sent. The buyer will review the file before approving payment.';action='<button class="secondary" data-action="refresh">Check for updates</button>';}
 }else if(r.settlement){actionTitle=r.settlement.release?'Payment, released.':'Refund, recorded.';actionCopy='The local ledger has recorded the outcome and its evidence.';action=`<div class="settlement-complete">${icon('circle')}<strong>Settlement complete</strong><span>${esc(r.settlement.note)} · ${eth(t.amount_wei)} test ETH</span></div><details class="evidence-fingerprint"><summary>View settlement evidence hash</summary><p class="hash">${esc(r.settlement.evidence_hash)}</p></details><a class="button secondary" href="#ledger">View payment record ${icon('arrowUp')}</a>`;
 }else{actionTitle='This needs a closer look.';actionCopy='Settlement was blocked. Review the failed check before taking any further action.';action=`<div class="notice bad">${esc(r.rejection)}</div>`;}
 const willSign=/countersign|delivery-form|data-action="release"|data-action="refund"/.test(action);
 const integrity=r.checks.find(c=>c.label==='Payload integrity');
 return `<a class="back-link" href="#escrows">← All agreements</a>`+head('Escrow agreement',esc(t.description),`${r.role==='buyer'?'Buying from '+esc(t.seller.name):'Delivering to '+esc(t.buyer.name)}`,badge(r.state))+`<div class="rail simple-rail" aria-label="Agreement progress">${['Agree','Deliver','Review','Finish'].map((label,i)=>`<div class="rail-step ${done[i]?'done':i===current?'current':r.settlement?'skipped':''}" ${i===current?'aria-current="step"':''}><span class="rail-number">${done[i]?icon('check'):r.settlement?'—':i+1}</span><strong>${label}</strong></div>`).join('')}</div><div class="detail-layout"><div class="detail-main"><section class="card instrument"><div class="instrument-top"><div><p class="eyebrow">Digitally signed instrument</p><h2>The agreement</h2></div>${badge(r.state)}</div><div class="agreement-parties"><div>${person(t.buyer.name)}<span><small>Buyer</small><strong>${esc(t.buyer.name)}</strong></span></div><span class="parties-arrow">${icon('arrow')}</span><div>${person(t.seller.name)}<span><small>Seller</small><strong>${esc(t.seller.name)}</strong></span></div><div class="agreement-price"><strong>${amount(t.amount_wei)}</strong><span>test ETH</span></div></div><p class="agreement">${esc(t.buyer.name)} agrees to pay ${eth(t.amount_wei)} test ETH to ${esc(t.seller.name)} upon verified delivery of “${esc(t.description)}”.</p><dl class="definition"><div><dt>Agreement created</dt><dd>${esc(stamp(t.created_at))}</dd></div><div><dt>Delivery and decision due</dt><dd>${esc(stamp(t.expires_at))}</dd></div></dl><p class="instrument-note">Payment requires a signed release, an intact file, and a successful ledger check. No dispute arbitration is provided.</p><details class="instrument-more"><summary>Signatures and agreement ID</summary><div class="seals" aria-label="Signature verification">${r.seals.map(s=>`<div class="seal ${s.ok?'present':''}"><span class="stamp">${icon(s.ok?'check':'clock')}</span><div><strong>${esc(s.label)}</strong><span>${esc(s.signer)}</span><small>${s.present?s.bytes+' bytes · '+(s.ok?'Verified':'Failed'):'Awaiting signature'}</small></div></div>`).join('')}</div><details class="record-fingerprint"><summary>View agreement fingerprint</summary><p class="hash">${esc(id)}</p></details></details></section><section class="card evidence-card"><div class="card-title"><div><p class="eyebrow">Trust the evidence</p><h2>Delivery and verification</h2></div><span class="badge">${esc(({HOLD:'Waiting',RELEASE:'Delivery approved',REFUND:'Refund due',REJECT:'Needs review'})[r.verification.outcome]||r.verification.outcome)}</span></div>${r.delivery?`<div class="file-block"><span class="file-icon">${icon('file')}</span><div class="file-text"><strong>${esc(r.delivery.filename)}</strong><p>${r.delivery.size.toLocaleString()} bytes · ${wrongExpected?'Does not match the agreed fingerprint':integrity?.ok?'Hash matches the signed receipt':'File integrity check failed'}</p><details class="file-fingerprint"><summary>View file fingerprint</summary><p class="hash">${esc(r.delivery.sha256)}</p></details><a class="download-link" href="/api/escrows/${id}/download" download>${icon('download')}Download file ↓</a></div></div>`:`<div class="delivery-empty">${icon('file')}<p>The seller’s delivery and signed receipt will appear here.</p></div>`}<details class="evidence-details"><summary>Evidence details and verification checks</summary><div class="tabs" role="tablist" aria-label="Escrow evidence">${[['checks','Checks'],['terms','Terms'],['activity','Activity'],['bundle','Signed bundle']].map(([key,label])=>`<button role="tab" id="tab-${key}" aria-controls="detail-panel" aria-selected="${detailTab===key}" tabindex="${detailTab===key?0:-1}" data-action="detail-tab" data-tab="${key}">${label}</button>`).join('')}</div><div role="tabpanel" id="detail-panel" aria-labelledby="tab-${detailTab}">${tabContent(r)}</div></details></section></div><aside class="detail-sidebar"><section class="card action-panel"><p class="eyebrow">${r.role==='buyer'?'You’re buying':'You’re delivering'}</p><h2>${actionTitle}</h2><p class="action-copy">${actionCopy}</p>${action}${willSign?`<div class="signing-custody">${icon('lock')}<span>Your confirmation adds a digital signature.</span></div>`:''}</section><section class="card agreement-summary"><h3>At a glance</h3><dl><div><dt>Agreement value</dt><dd>${eth(t.amount_wei)} test ETH</dd></div><div><dt>Your role</dt><dd>${esc(r.role)}</dd></div><div><dt>Sequence</dt><dd>#${t.seq}</dd></div><div><dt>Peer link</dt><dd class="verified-text">Available</dd></div><div><dt>Chain link</dt><dd>${me.online?'Online':'Offline'}</dd></div></dl><p>Offline agreements do not reserve funds. Available balance is checked at settlement.</p></section></aside></div>`;
}
function wallet() {
 return walletPage();
}
async function walletPage(){
 const w=await api('wallet'),minimum=Math.max(1,me.min_lock),durations=[3600,86400,604800].filter(value=>value>=minimum);if(!durations.includes(Math.max(3600,minimum)))durations.unshift(Math.max(3600,minimum));
 const durationLabel=value=>value%86400===0?`${value/86400} day${value===86400?'':'s'}`:value%3600===0?`${value/3600} hour${value===3600?'':'s'}`:`${value} seconds`;
 return head('Funds and earnings','Your wallet.','Add funds for agreements and collect payments you’ve earned.')+walletStats(w)+`<div class="two-col equal"><section class="card wallet-fund"><p class="eyebrow">For buying</p><h2>Add funds to escrow</h2><p class="muted">Move test funds from your wallet into your deposited balance. Choose how long they must stay deposited.</p><form id="deposit-form"><label for="deposit-amount">Amount in test ETH</label><input id="deposit-amount" name="amount" inputmode="decimal" value="1" required><label for="lock-preset">Keep deposited for</label><select id="lock-preset">${durations.map(value=>`<option value="${value}">${durationLabel(value)}</option>`).join('')}<option value="custom">Custom duration</option></select><details id="custom-lock" class="wallet-advanced"><summary>Custom duration in seconds</summary><label for="lock-seconds">Lock duration in seconds</label><input id="lock-seconds" name="lock" type="number" min="${minimum}" value="${Math.max(3600,minimum)}" required></details><button class="spacer" type="submit" ${me.online?'':'disabled'}>Deposit test funds</button></form><p class="fine">Deposits back all your agreements. Funds are checked again when a payment is finished.</p></section><section class="card wallet-collect"><p class="eyebrow">For selling</p><h2>Collect your earnings</h2><p class="muted">Completed payments wait here until you move them into your wallet.</p><div class="claim-amount">${amount(w.account.claimable)}<span>test ETH ready</span></div><button data-action="claim" ${me.online&&BigInt(w.account.claimable)>0n?'':'disabled'}>Claim earnings</button><hr><h3>Withdraw deposited funds</h3><p class="fine">${w.account.lockedUntil>w.now?`Your deposit unlocks ${esc(stamp(w.account.lockedUntil))}.`:'Your deposit is unlocked.'} Withdrawing can reduce the backing for unfinished agreements.</p><form id="withdraw-form"><label for="withdraw-amount">Amount in test ETH</label><input id="withdraw-amount" name="amount" inputmode="decimal" value="1" required><button class="secondary spacer" type="submit" ${me.online&&w.account.lockedUntil<=w.now?'':'disabled'}>Withdraw unlocked funds</button></form></section></div><details class="card account-details"><summary>View registered account details</summary><dl class="key-value"><dt>Account address</dt><dd class="hash">${me.identity.evm_address}</dd><dt>Registered signing key</dt><dd class="hash">${esc(w.account.keyHash||'Add a deposit to register your signing key.')}</dd></dl></details>`;
}

async function ledger() {
 const chain=await api('chain');const settlements=Object.values(chain.settlements);const users=(await api('users')).users;const name=addr=>users.find(p=>p.evm_address===addr)?.name||short(addr);
 return head('Public evidence explorer','The local ledger.','Final balances, single-use sequences, and the evidence behind each settlement.')+`<div class="notice">LocalLedger is a JSON-file simulation of the EVM contract. This website does not send transactions to Ethereum.</div><div class="stats"><div class="card"><div class="stat-label">Deposited in total</div><div class="stat-value">${eth(chain.deposited)} <span>ETH</span></div></div><div class="card"><div class="stat-label">Settlements</div><div class="stat-value">${settlements.length}</div></div><div class="card"><div class="stat-label">Earnings claimed</div><div class="stat-value">${eth(chain.claimed)} <span>ETH</span></div></div></div><section class="card"><h2>Settlements</h2>${settlements.length?`<div class="table-wrap"><table><thead><tr><th>Escrow / evidence hash</th><th>Parties</th><th>Amount</th><th>Outcome</th></tr></thead><tbody>${settlements.reverse().map(s=>`<tr><td><div class="hash">${esc(s.escrow_id)}</div><div class="row-sub hash">${esc(s.evidence_hash)}</div></td><td>${esc(name(s.buyer))} → ${esc(name(s.seller))}<div class="row-sub">Sequence ${s.seq}</div></td><td>${eth(s.amount_wei)} ETH</td><td><span class="badge verified">${esc(s.note)}</span></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No settlements yet. Complete an agreement, then verify and settle.</p>'}</section><section class="card"><h2>Accounts and registered keys</h2><div class="table-wrap"><table><thead><tr><th>Account</th><th>Balance</th><th>Claimable</th><th>Registered key</th></tr></thead><tbody>${Object.entries(chain.accounts).map(([addr,a])=>`<tr><td>${esc(name(addr))}<div class="row-sub hash">${esc(addr)}</div></td><td>${eth(a.balance)} ETH</td><td>${eth(chain.claimable[addr]||0)} ETH</td><td class="hash">${esc(a.keyHash)}</td></tr>`).join('')}</tbody></table></div></section><p class="footer-note">Relayers verify ML-DSA off-chain. EVM accounts are not post-quantum. Evidence hashes provide an audit commitment, not an on-chain signature proof.</p>`;
}
function verifyPage() {return head('Evidence tools','Verify the evidence.','Check signatures, inspect the bundle, or compare a file’s fingerprint.')+`<div class="two-col equal verify-tools"><section class="card tool-card"><span class="tool-icon">${icon('shield')}</span><p class="eyebrow">01 / Signature inspection</p><h2>Check a signed bundle</h2><p class="muted">Inspect every signature, key fingerprint, receipt binding, and included payload. Nothing is imported into your account.</p><form id="verify-bundle-form"><label for="bundle-file">Signed JSON bundle</label><div class="file-input-box">${icon('file')}<input id="bundle-file" name="file" type="file" accept=".json,application/json" required></div><button class="spacer" type="submit">Verify bundle ${icon('arrow')}</button></form><div id="bundle-result" aria-live="polite"></div></section><section class="card tool-card"><span class="tool-icon green">${icon('file')}</span><p class="eyebrow">02 / File integrity</p><h2>Hash any file</h2><p class="muted">Compute a SHA-256 fingerprint entirely in your browser, then compare it with the signed receipt. Your file stays with you.</p><form id="verify-file-form"><label for="verify-file">File to inspect</label><div class="file-input-box">${icon('upload')}<input id="verify-file" name="file" type="file" required></div><button class="spacer" type="submit">Compute SHA-256 locally</button></form><div id="file-result" aria-live="polite"></div></section></div><div class="info-strip">${icon('lock')}<p>A valid signature proves who signed those bytes. It does not prove that a delivery meets your expectations.</p></div>`;}

const labSpecs=[
 ['file','File tampering','Change one byte after signing. The file should no longer match its receipt.','file','Byte position','offset','0','26214399'],
 ['signature','Signature forgery','Change a signature without the signing key. Verification should reject it.','shield','Signature byte','signature_byte','3308','3308'],
 ['price','Price tampering','Increase the signed price. The original signatures and agreement ID must fail.','wallet','Price multiplier','multiplier','100','1000'],
 ['replay','Payment replay','Submit one payment repeatedly. Only the first payment should be credited.','refresh','Total submissions','attempts','2','5'],
 ['double-spend','Cloned wallet','Use the same buyer sequence on several devices. Only one payment should settle.','peer','Number of devices','copies','2','4']
];
let labResults=new Map(),labBusy=false,labRunVersion=0;
async function lab() {
 ++labRunVersion;labResults=new Map();labBusy=false;
 const {escrows}=await api('escrows'),delivered=escrows.filter(r=>r.delivery);
 return head('Interactive security lab','Try to break the agreement.','Change a practice copy, run the real checks, and see exactly what stops the attack.')+`
 <section class="card lab-controls"><div class="lab-source"><label for="lab-record">Evidence to test</label><select id="lab-record"><option value="">Signed practice example — ready to run</option>${delivered.map(r=>`<option value="${esc(r.escrow_id)}">${esc(r.terms.description.slice(0,60))} · ${r.delivery.size.toLocaleString()} bytes</option>`).join('')}</select><p id="lab-source-note">File, signature and price tests use this evidence. Payment tests use fresh practice accounts.</p></div><div class="lab-toolbar"><button data-action="lab-run-all">${icon('lab')}Run all experiments</button><button class="secondary" data-action="lab-reset">Reset results</button></div><div id="lab-summary" role="status" aria-live="polite"><span class="lab-summary-icon">${icon('shield')}</span><span>0 of 5 completed · Your saved records and balances stay untouched.</span></div></section>
 <div class="attack-grid interactive-attacks">${labSpecs.map(([kind,title,description,symbol,label,key,value,max],i)=>`<section class="card lab-card" data-lab-card="${kind}"><div class="lab-card-top"><span class="tool-icon">${icon(symbol)}</span><span id="lab-state-${kind}" class="badge">Not run</span></div><p class="eyebrow">Experiment 0${i+1}</p><h3>${title}</h3><p class="lab-description">${description}</p><div class="lab-parameter"><label for="attack-${key}">${label}</label><input id="attack-${key}" data-option="${key}" type="number" min="${['multiplier','attempts','copies'].includes(key)?2:0}" max="${max}" step="1" value="${value}" required></div><button class="secondary" data-action="attack" data-kind="${kind}">Run experiment ${icon('arrow')}</button><div id="attack-${kind}" aria-live="polite"></div></section>`).join('')}</div>
 <details class="card lab-clock"><summary>${icon('clock')}Demo clock <span>Changes the clock for every account</span></summary><div><h2>Move time forward</h2><p class="muted">Use this to try deadlines and deposit unlocks. The change is saved across restarts and can expire sign-in sessions.</p><div class="time-presets">${[[60,'1 minute'],[3600,'1 hour'],[86400,'1 day']].map(([seconds,label])=>`<button type="button" class="secondary" data-action="lab-time-preset" data-seconds="${seconds}">+ ${label}</button>`).join('')}</div><form id="time-form"><div class="inline-field"><div><label for="time-seconds">Seconds to advance</label><input id="time-seconds" name="seconds" type="number" min="1" max="604800" value="3601" required></div><button type="submit" class="secondary">Advance demo clock</button></div></form><p class="fine">Current application time: ${esc(stamp(me.now))}</p></div></details>`;
}
function updateLabSummary(message='') {
 const summary=$('#lab-summary');if(!summary)return;
 const blocked=[...labResults.values()].filter(result=>result.blocked).length;
 summary.innerHTML=`<span class="lab-summary-icon">${icon('shield')}</span><span>${esc(message||`${labResults.size} of 5 completed · ${blocked} blocked · Saved records unchanged.`)}</span>`;
}
function resetLabResults() {
 if(labBusy)return;
 labResults.clear();for(const [kind] of labSpecs){const output=$('#attack-'+kind),state=$('#lab-state-'+kind);if(output)output.replaceChildren();if(state){state.textContent='Not run';state.className='badge';}}
 updateLabSummary('0 of 5 completed · Your saved records and balances stay untouched.');
}
function showLabResult(kind,result) {
 labResults.set(kind,result);const state=$('#lab-state-'+kind);
 state.textContent=result.blocked?'Blocked':'Needs attention';state.className='badge '+(result.blocked?'verified':'rejected');
 $('#attack-'+kind).innerHTML=`<div class="result lab-result ${result.blocked?'':'lab-failed'}"><strong>${result.blocked?'✓ Attack blocked':'Attack was not blocked'}</strong><p>${esc(result.check)}</p><span class="lab-result-source">${esc(result.source)}</span><div class="lab-changes">${result.changes.map(change=>`<div><h4>${esc(change.label)}</h4><div><span>Before</span><code>${esc(change.before)}</code></div><div><span>After</span><code>${esc(change.after)}</code></div></div>`).join('')}</div><ol class="lab-steps">${result.steps.map(step=>`<li><span class="lab-step-icon ${step.ok?'':'bad'}">${icon(step.ok?'check':'close')}</span><div><strong>${esc(step.title)}</strong><p>${esc(step.detail)}</p></div></li>`).join('')}</ol><details class="lab-proof"><summary>Inspect verification checks</summary><h4>Original evidence</h4>${renderChecks(result.before_checks)}<h4>Changed copy or extra payment</h4>${renderChecks(result.after_checks)}</details><span class="fine">Disposable copy · Real records and funds unchanged</span></div>`;
 updateLabSummary();
}
async function runLabExperiments(kinds) {
 if(labBusy)return;
 const jobs=[];
 for(const kind of kinds){const input=$(`[data-lab-card="${kind}"] [data-option]`);if(!input.reportValidity())return;jobs.push({kind,options:{[input.dataset.option]:Number(input.value)}});}
 const version=labRunVersion,viewVersion=renderVersion,source=$('#lab-record').value;
 const active=()=>version===labRunVersion&&viewVersion===renderVersion&&Boolean($('#lab-summary'));
 labBusy=true;
 const controls=[...document.querySelectorAll('[data-action="attack"],[data-action="lab-run-all"],[data-action="lab-reset"],#lab-record,.lab-parameter input')];controls.forEach(control=>control.disabled=true);
 try{
  for(const [i,job] of jobs.entries()){
   if(!active())return;
   const state=$('#lab-state-'+job.kind);state.textContent='Running…';state.className='badge accepted';
   $('#attack-'+job.kind).innerHTML='<p class="lab-running" role="status">Preparing a copy and running verification…</p>';
   updateLabSummary(`Running experiment ${i+1} of ${jobs.length}…`);
   try{
    const result=await api(['replay','double-spend'].includes(job.kind)?'lab/'+job.kind:'lab/attack',{kind:job.kind,escrow_id:source||undefined,options:job.options});
    if(!active())return;showLabResult(job.kind,result);
   }catch(error){
    if(!active())return;labResults.delete(job.kind);state.textContent='Could not run';state.className='badge rejected';
    $('#attack-'+job.kind).innerHTML=`<div class="notice bad spacer" role="alert">${esc(error.message)}<p>Adjust the setting or choose the signed practice example, then try again.</p></div>`;
   }
  }
 }finally{if(active()){labBusy=false;controls.forEach(control=>control.disabled=false);updateLabSummary();}}
}

async function activityPage() {const data=await api('audit');return head('Your audit trail','Every step leaves a trace.','A readable history of the actions and evidence behind your agreements.')+`<div class="audit-status ${data.valid?'good':'bad'}"><span class="audit-status-icon">${icon(data.valid?'shield':'clock')}</span><div><strong>${data.valid?'Your audit chain checks out.':'Your audit chain needs review.'}</strong><p>${data.entries.length} linked entries checked against the saved local head.</p></div><span class="badge verified">${data.valid?'Verified':'Check failed'}</span></div><section class="card activity-card"><div class="card-title"><h2>Workspace activity</h2><span class="muted fine">Newest first</span></div>${activities(data.entries)}</section><p class="footer-note">Each entry commits to the one before it. A fully rewritten log requires an external anchor to make that rewrite detectable.</p>`;}

function settings(){
 const theme=localStorage.getItem('pqe-theme')||'light';
 return head('Your account','Settings','Make this workspace feel right for you.')+`<div class="two-col equal"><section class="card"><h2>Preferences</h2><label for="theme-select">Appearance</label><select id="theme-select">${[['light','Light'],['dark','Dark'],['device','Match device']].map(([value,label])=>`<option value="${value}" ${theme===value?'selected':''}>${label}</option>`).join('')}</select><h3 class="spacer">Payment connection</h3><p class="muted">Stay online to finish payments and move funds. You can still sign agreements and exchange files offline through this local app.</p><button class="secondary" data-action="network">${me.online?'Go offline':'Go online'}</button><hr><h3>Need a hand?</h3><a class="text-link" href="#help">Open the getting-started guide ${icon('arrow')}</a></section><section class="card"><h2>Change your password</h2><p class="muted">Your new password protects the saved signing key. Changing it signs out all sessions for this account.</p><form id="password-form"><label for="old-password">Current password</label><input type="password" id="old-password" name="old" autocomplete="current-password" required><label for="new-password">New password</label><input type="password" id="new-password" name="new" minlength="8" autocomplete="new-password" required><button class="spacer" type="submit">Change password and sign out</button></form></section></div><details class="card account-details"><summary>Signing identity and technical details</summary><dl class="key-value"><dt>Account</dt><dd>${esc(me.identity.name)}</dd><dt>Account address</dt><dd class="hash">${me.identity.evm_address}</dd><dt>Signing fingerprint</dt><dd class="hash">${esc(me.identity.key_hash)}</dd><dt>Algorithm</dt><dd>ML-DSA-65 (FIPS 204)</dd><dt>Key status</dt><dd>Unlocked on this local server</dd></dl><p class="fine">Your signing key is encrypted on disk. This server can sign while you are logged in. After a server restart, sign in again to unlock it. Python cannot guarantee secret memory erasure.</p><details><summary>View public key</summary><pre>${esc(me.identity.public_key)}</pre></details></details><p class="footer-note">Local demonstration with test funds. No real-value custody, dispute resolution or key recovery is provided.</p>`;
}

async function render() {
 const version=++renderVersion;
 try {me=await api('me');}catch(error){if(version===renderVersion){authPage();if(error.status===0)$('#auth-error').textContent=error.message;else if(error.message.includes('unlock'))toast(error.message);}return;}
 if(version!==renderVersion)return;
 shell();const activeNav=$('.primary-nav [aria-current="page"]');if(activeNav)activeNav.scrollIntoView({block:'nearest',inline:'nearest'});const path=location.hash.slice(1)||'overview';const [page,id]=path.split('/');
 try {
  let html;
  if(page==='escrows'&&id) html=await detail(id);
  else if(page==='escrows')html=await escrowList();
  else if(page==='wallet')html=await wallet();
  else if(page==='ledger')html=await ledger();
  else if(page==='verify')html=verifyPage();
  else if(page==='lab')html=await lab();
  else if(page==='activity')html=await activityPage();
  else if(page==='settings')html=settings();
  else if(page==='help')html=helpPage();
  else html=await overview();
  if(version===renderVersion){$('#main').innerHTML=html;setupDropzone();}
 }catch(error){if(version===renderVersion)$('#main').innerHTML=`<div class="notice bad" role="alert">${esc(error.message)}</div><a href="#overview">Return to overview</a>`;}
}
let createStep=1, draftOwner=null, creationWallet=null;
function syncCreateButtons(){const busy=expectedFileHashing||Boolean(expectedFileError);$('#create-review').disabled=busy;$('#create-submit').disabled=busy||createStep!==3;}
function showCreateStep(step,focus=true){
 createStep=step;document.querySelectorAll('[data-create-step]').forEach(panel=>panel.hidden=Number(panel.dataset.createStep)!==step);
 document.querySelectorAll('[data-create-marker]').forEach(marker=>{const n=Number(marker.dataset.createMarker);marker.classList.toggle('done',n<step);if(n===step)marker.setAttribute('aria-current','step');else marker.removeAttribute('aria-current');});
 $('#create-back').hidden=step===1;$('#create-next').hidden=step!==1;$('#create-review').hidden=step!==2;$('#create-submit').hidden=step!==3;$('#create-error').textContent='';
 if(step===3){const file=$('#expected-file').files[0],hash=$('#expected').value;$('#create-review-summary').innerHTML=`<dl class="review-values"><div><dt>Seller</dt><dd>${esc($('#seller').value)}</dd></div><div><dt>Payment</dt><dd>${esc($('#amount').value)} test ETH</dd></div><div><dt>Delivery and approval due</dt><dd>Within ${esc($('#hours').value)} hours</dd></div></dl><div class="review-description"><span>What will be delivered</span><p>${esc($('#description').value)}</p></div><div class="review-file">${icon(hash?'shield':'file')}<div><strong>${hash?'Exact file check is on':'You’ll review the delivered file'}</strong><p>${hash?(file?esc(file.name):'Using the fingerprint you entered'):'No reference file was added.'}</p>${hash?`<details><summary>View agreed fingerprint</summary><p class="hash">${esc(hash)}</p></details>`:''}</div></div>`;}
 if(step===3&&creationWallet&&BigInt(creationWallet.account.balance)<BigInt(wei($('#amount').value)))$('#create-review-summary').insertAdjacentHTML('beforeend','<div class="notice funding-notice">Your deposited funds do not cover this payment yet. <a href="#wallet" data-action="close-create">Add funds in Wallet</a> before finishing payment. Your draft will be kept.</div>');
 syncCreateButtons();$('#create-dialog').scrollTop=0;
 if(focus)$(`[data-create-step="${step}"] h3`)?.focus({preventScroll:true});
}
function validateCreateStep(step){
 if(step===1){$('#amount').setCustomValidity('');$('#description').setCustomValidity('');try{wei($('#amount').value);}catch(error){$('#amount').setCustomValidity(error.message);}if(!$('#description').value.trim())$('#description').setCustomValidity('Describe what the seller will deliver.');}
 if(step===2){if(expectedFileHashing||expectedFileError){showCreateStep(2);$('#create-error').textContent=expectedFileError||'Wait for the file check to finish.';return false;}if(!$('#expected').readOnly)$('#expected').value=$('#expected').value.trim().toLowerCase();}
 const fields=step===1?['seller','amount','hours','description']:['expected-file','expected'];
 for(const id of fields){const field=$('#'+id);if(!field.checkValidity()){showCreateStep(step,false);if(id==='expected')$('#manual-fingerprint').open=true;field.reportValidity();return false;}}
 return true;
}
function advanceCreate(){if(validateCreateStep(createStep))showCreateStep(Math.min(3,createStep+1));}

function confirmSign(title,message) { const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-body').textContent=message;dialog.returnValue='cancel';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true})); }
let expectedFileVersion=0,expectedFileHashing=false,expectedFileError='';
async function fileFingerprint(file) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''); }
function clearExpectedFile() {
 ++expectedFileVersion;expectedFileHashing=false;expectedFileError='';
 $('#expected-file').value='';$('#expected-file').setCustomValidity('');$('#expected').value='';$('#expected').readOnly=false;
 $('#expected-file-name').textContent='';$('#expected-file-status').textContent='';$('#expected-file-status').classList.remove('error');$('#clear-expected-file').hidden=true;
 syncCreateButtons();
}
async function hashExpectedFile() {
 const version=++expectedFileVersion,file=$('#expected-file').files[0],submit=$('#create-form button[type="submit"]');
 expectedFileHashing=Boolean(file);expectedFileError='';$('#expected-file').setCustomValidity('');
 $('#expected').value='';$('#expected').readOnly=Boolean(file);$('#clear-expected-file').hidden=!file;
 $('#expected-file-name').textContent=file?`${file.name} · ${file.size.toLocaleString()} bytes`:'';
 const status=$('#expected-file-status');status.classList.remove('error');status.textContent=file?'Calculating SHA-256 fingerprint…':'';syncCreateButtons();
 if(!file)return;
 try {
  if(file.size>25*1024*1024)throw Error('Choose a file up to 25 MB, the delivery size limit.');
  const hash=await fileFingerprint(file);if(version!==expectedFileVersion)return;
  $('#expected').value=hash;status.textContent='Fingerprint ready. Only this exact file can qualify for payment. The file has not been uploaded.';
 }catch(error){
  if(version!==expectedFileVersion)return;
  expectedFileError=error.message||'Could not read this file. Choose it again or remove it.';
  $('#expected-file').setCustomValidity(expectedFileError);status.textContent=expectedFileError;status.classList.add('error');
 }finally{if(version===expectedFileVersion){expectedFileHashing=false;syncCreateButtons();}}
}
let deliveryFileVersion=0;
async function checkDeliveryFile() {
 const form=$('#delivery-form');if(!form)return;
 const version=++deliveryFileVersion,input=$('#delivery-file'),file=input.files[0],status=$('#delivery-file-status'),submit=$('button[type="submit"]',form),expected=currentDetail?.terms.expected_sha256;
 input.setCustomValidity('');submit.disabled=true;status.className='delivery-validation';status.textContent=file?'Checking file fingerprint…':'';
 if(!file)return;
 try{
  if(file.size>25*1024*1024)throw Error('Choose a file up to 25 MB.');
  const hash=await fileFingerprint(file);if(version!==deliveryFileVersion||!form.isConnected)return;
  if(expected&&hash!==expected){input.setCustomValidity('This file does not match the agreed fingerprint. Choose the correct file.');status.classList.add('bad');status.innerHTML=`<strong>Wrong file — delivery blocked</strong><p>Choose the file agreed with the buyer. Nothing has been uploaded or signed.</p><details><summary>View selected fingerprint</summary><p class="hash">${esc(hash)}</p></details>`;return;}
  status.classList.add('good');status.innerHTML=`<strong>${expected?'Fingerprint matches — ready to deliver':'File ready to deliver'}</strong><p>${esc(file.name)} · ${file.size.toLocaleString()} bytes</p><details><summary>View file fingerprint</summary><p class="hash">${esc(hash)}</p></details>`;submit.disabled=false;
 }catch(error){if(version!==deliveryFileVersion||!form.isConnected)return;input.setCustomValidity(error.message);status.classList.add('bad');status.textContent=error.message;}
}
async function openCreate() {
 closeTools();if(draftOwner!==me.identity.name){$('#create-form').reset();draftOwner=me.identity.name;}
 const previousSeller=$('#seller').value;
 const [result,wallet]=await Promise.all([api('users'),api('wallet')]);creationWallet=wallet;
 const users=result.users.filter(p=>p.name!==me.identity.name);if(!users.length)throw Error('Create a second account before drafting an escrow');
 $('#seller').innerHTML=users.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');if(users.some(p=>p.name===previousSeller))$('#seller').value=previousSeller;
 $('#create-error').textContent='';showCreateStep(1,false);$('#create-dialog').showModal();
}

document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
 try {
  if(action==='toggle-tools'){const open=$('#tools-menu').hidden;$('#tools-menu').hidden=!open;button.setAttribute('aria-expanded',String(open));return;}
  if(action==='create-next'){advanceCreate();return;}
  if(action==='create-back'){showCreateStep(Math.max(1,createStep-1));return;}
  if(action==='hide-guide'){localStorage.setItem('pqe-guide-hidden:'+me.identity.name,'1');button.closest('.welcome-guide').remove();return;}
  if(action==='show-guide'){localStorage.removeItem('pqe-guide-hidden:'+me.identity.name);location.hash='overview';return;}
  if(action==='help-role'){helpRole=button.dataset.role;document.querySelectorAll('[data-action="help-role"]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));$('#help-role-panel').setAttribute('aria-labelledby',button.id);$('#help-role-panel').innerHTML=helpSteps(helpRole);return;}
  if(action==='refresh'){await render();toast('Workspace refreshed.');return;}
  if(action==='theme'){const dark=getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim()==='dark';applyTheme(dark?'light':'dark');if(location.hash==='#settings')await render();return;}
  if(action==='toggle-password'){const field=$('#password');const show=field.type==='password';field.type=show?'text':'password';button.setAttribute('aria-label',show?'Hide password':'Show password');return;}
  if(action==='filter'){escrowFilter=button.dataset.filter;updateEscrowResults();return;}
  if(action==='reset-filter'){escrowFilter='all';escrowQuery='';$('#escrow-search').value='';updateEscrowResults();return;}
  if(action==='auth-login'||action==='auth-register'){authMode=action==='auth-login'?'login':'register';authPage();return;}
  if(action==='demo'){$('#username').value=button.dataset.name;$('#password').value='demo1234';$('#auth-error').textContent='';return;}
  if(action==='logout'){await api('logout',{});authPage();toast('You’re signed out.');return;}
  if(action==='network'){await api('online',{online:!me.online});toast(me.online?'Working offline. You can still sign and exchange files.':'Connected. You can now finish payments.');await render();return;}
  if(action==='new'){await openCreate();return;}
  if(action==='clear-expected-file'){clearExpectedFile();return;}
  if(action==='close-create'){$('#create-dialog').close();return;}
  if(action==='detail-tab'){detailTab=button.dataset.tab;document.querySelectorAll('[data-action="detail-tab"]').forEach(tab=>{tab.setAttribute('aria-selected',String(tab===button));tab.tabIndex=tab===button?0:-1;});$('#detail-panel').setAttribute('aria-labelledby',button.id);$('#detail-panel').innerHTML=tabContent(currentDetail);return;}
  if(action==='countersign'||action==='release'||action==='refund'){
   const messages={countersign:['Countersign this agreement?',`You agree to deliver “${currentDetail.terms.description}” for ${eth(currentDetail.terms.amount_wei)} test ETH.`],release:['Release this payment?',`You authorize ${eth(currentDetail.terms.amount_wei)} test ETH to ${currentDetail.terms.seller.name}. The received file will be re-hashed before signing.`],refund:['Request a refund?',`You reject the delivery and sign a refund decision bound to this exact receipt.`]};
   if(!await confirmSign(...messages[action]))return;
   button.disabled=true;await api('escrows/'+button.dataset.id+'/'+(action==='countersign'?'countersign':'accept'),action==='countersign'?{}:{decision:action==='release'?'release':'refund'});toast(action==='countersign'?'Agreement signed. You can now send your file.':action==='release'?'Payment approved. Finish the payment when online.':'Refund approved. Finish the refund when online.');await render();return;
  }
  if(action==='reconcile'){button.disabled=true;const {results}=await api('reconcile',{});toast(results.length?results.map(r=>({RELEASE:'Payment finished',REFUND:'Refund recorded',HOLD:'Still waiting',REJECT:'Needs review'}[r.outcome]||r.outcome)+': '+r.reason).join(' · '):'All agreements are already up to date.');await render();return;}
  if(action==='claim'){button.disabled=true;const result=await api('claim',{});toast(eth(result.amount_wei)+' test ETH claimed.');await render();return;}
  if(action==='attack'){await runLabExperiments([button.dataset.kind]);return;}
  if(action==='lab-run-all'){await runLabExperiments(labSpecs.map(([kind])=>kind));return;}
  if(action==='lab-reset'){resetLabResults();return;}
  if(action==='lab-time-preset'){$('#time-seconds').value=button.dataset.seconds;return;}
 }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
document.addEventListener('submit',async event=>{
 const form=event.target;if(!form.id || form.closest('#confirm-dialog'))return;
 event.preventDefault();const data=new FormData(form);const submit=$('button[type="submit"]',form);if(submit)submit.disabled=true;
 try {
  if(form.id==='auth-form'){
   $('#auth-error').textContent='';const creds={username:data.get('username'),password:data.get('password')};
   if(authMode==='register'){if(runtime.hosted&&data.get('confirm_password')!==creds.password)throw Error('Your passwords do not match.');if(runtime.hosted)creds.display_name=data.get('display_name')||'';await api('register',creds);}
   await api('login',creds);authMode='login';location.hash='overview';await render();return;
  }
  if(form.id==='create-form'){
   if(createStep<3){advanceCreate();return;}
   if(!validateCreateStep(1)||!validateCreateStep(2))return;
   if(expectedFileHashing)throw Error('Wait for the file fingerprint to finish.');
   if(expectedFileError)throw Error(expectedFileError);
   const amount=wei(data.get('amount'));const hours=Number(data.get('hours'));
   if(!await confirmSign('Sign the buyer’s terms?',`Pay ${eth(amount)} test ETH to ${data.get('seller')} for “${data.get('description')}”, with delivery and decision due in ${hours} hours.${data.get('expected')?' Expected file SHA-256: '+data.get('expected')+'.':''}`))return;
   const r=await api('escrows',{seller:data.get('seller'),amount_wei:amount,description:data.get('description'),expires_at:me.now+hours*3600,expected_sha256:data.get('expected')||null});$('#create-dialog').close();form.reset();detailTab='checks';location.hash='escrows/'+r.escrow_id;toast('Buyer terms signed and sent to the seller.');return;
  }
  if(form.id==='delivery-form'){
   const file=data.get('file');if(!file||file.size>25*1024*1024)throw Error('Choose a file up to 25 MB');
   if(currentDetail.terms.expected_sha256&&await fileFingerprint(file)!==currentDetail.terms.expected_sha256)throw Error('This file does not match the agreed fingerprint. No delivery was saved.');
   if(!await confirmSign('Sign the delivery receipt?',`Deliver ${file.name} (${file.size} bytes). Its SHA-256, size, name, and delivery time will be signed.`))return;
   if(runtime.hosted){const upload=await uploadParts(file,'delivery',form.dataset.id,percent=>transferProgress('Uploading delivery',percent));await api('escrows/'+form.dataset.id+'/deliver-upload',{upload_id:upload});}else await api('escrows/'+form.dataset.id+'/deliver',await file.arrayBuffer(),{raw:true,headers:{'X-Filename':encodeURIComponent(file.name)}});toast('Delivery signed and sent to the buyer.');await render();return;
  }
  if(form.id==='deposit-form'||form.id==='withdraw-form'){
   await api(form.id==='deposit-form'?'wallet/deposit':'withdraw',{amount_wei:wei(data.get('amount')),lock_seconds:Number(data.get('lock'))});toast(form.id==='deposit-form'?'Test funds deposited and time-locked.':'Unlocked funds withdrawn.');await render();return;
  }
  if(form.id==='verify-bundle-form'){
   const file=data.get('file');if(file.size>36*1024*1024)throw Error('Bundle exceeds 36 MB');const result=runtime.hosted?await api('verify-upload',{upload_id:await uploadParts(file,'verify',null,percent=>transferProgress('Uploading evidence',percent))}):await api('verify-bundle',{bundle:JSON.parse(await file.text())});$('#bundle-result').innerHTML=`<div class="result"><strong>${esc(result.outcome)}</strong><p>${esc(result.reason)}</p>${renderChecks(result.checks)}</div>`;return;
  }
  if(form.id==='verify-file-form'){
   const file=data.get('file');const hash=await fileFingerprint(file);$('#file-result').innerHTML=`<div class="result"><strong>${esc(file.name)}</strong><p>${file.size} bytes · computed in this browser</p><p class="hash">${hash}</p></div>`;return;
  }
  if(form.id==='password-form'){await api('password',{old_password:data.get('old'),new_password:data.get('new')});authPage();toast('Password changed. All sessions ended. Sign in again.');return;}
  if(form.id==='time-form'){const seconds=Number(data.get('seconds'));await api('lab/time',{seconds});toast('Demo clock advanced by '+seconds+' seconds.');await render();return;}
 }catch(error){
  if(form.id==='auth-form')$('#auth-error').textContent=error.message;
  else if(form.id==='create-form')$('#create-error').textContent=error.message;
  else if(form.id==='verify-bundle-form')$('#bundle-result').innerHTML=`<div class="notice bad spacer" role="alert">${esc(error.message)}</div>`;
  else toast(error.message,true);
 }finally{if(runtime.hosted)document.querySelector('.transfer-toast')?.remove();if(form.id==='create-form')syncCreateButtons();else if(submit)submit.disabled=false;}
});
document.addEventListener('change',event=>{if(event.target.id==='theme-select')applyTheme(event.target.value);if(event.target.id==='lock-preset'){const custom=event.target.value==='custom';$('#custom-lock').open=custom;if(!custom)$('#lock-seconds').value=event.target.value;else $('#lock-seconds').focus();}if(event.target.id==='lock-seconds')$('#lock-preset').value='custom';if(event.target.id==='expected-file')hashExpectedFile();if(event.target.id==='delivery-file')checkDeliveryFile();if(event.target.id==='lab-record'||event.target.closest('.lab-parameter'))resetLabResults();});
document.addEventListener('reset',event=>{if(event.target.id==='create-form'){clearExpectedFile();$('#manual-fingerprint').open=false;showCreateStep(1,false);}});
document.addEventListener('keydown',event=>{const tab=event.target.closest('[role="tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=Array.from(tab.parentElement.querySelectorAll('[role="tab"]'));let i=tabs.indexOf(tab);i=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;event.preventDefault();tabs[i].focus();tabs[i].click();});
function setupDropzone(){++deliveryFileVersion;const zone=$('#dropzone');if(!zone)return;zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag');});zone.addEventListener('dragleave',()=>zone.classList.remove('drag'));zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag');if(e.dataTransfer.files.length){$('#delivery-file').files=e.dataTransfer.files;checkDeliveryFile();}});}
addEventListener('hashchange',async()=>{detailTab='checks';await render();scrollTo(0,0);$('#main')?.focus({preventScroll:true});});
// hosted.js loads runtime capabilities, then opens the shared interface.

document.addEventListener('input',event=>{if(event.target.id==='escrow-search'){escrowQuery=event.target.value;updateEscrowResults();}});

document.addEventListener('click',event=>{if(!event.target.closest('.nav-tools'))closeTools();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#tools-menu')&&!$('#tools-menu').hidden){closeTools(true);event.preventDefault();}if(event.key==='Enter'&&event.target.closest('#create-form')&&event.target.tagName!=='TEXTAREA'&&event.target.tagName!=='BUTTON'&&createStep<3){event.preventDefault();advanceCreate();}});
document.addEventListener('input',event=>{if(event.target.closest('#create-form')&&event.target.id!=='expected-file')event.target.setCustomValidity?.('');});
