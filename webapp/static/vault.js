'use strict';
// Presentation only: balances and settlement decisions still come from protected APIs.
document.documentElement.dataset.vault='1';
shapes.unlock='<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>';
shapes.vault='<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="12" r="4"/><path d="m9 9 6 6m-6 0 6-6M3 8h2M3 16h2"/>';
shapes.handshake='<path d="m3 8 4-3 5 2 5-2 4 3-2 8-4 3-9-3Z"/><path d="m12 7-4 4 2 2 4-3 5 5M6 16l3-3m1 5 3-4m1 5 2-3"/>';
const vaultGroups=[
 ['Agreements',[['scopeguard','vault','Vault overview'],['scope-create','plus','Create agreement'],['escrows','file','Legacy agreements'],['marketplace','peer','Marketplace'],['scope-changes','refresh','Scope changes'],['scope-milestones','clock','Milestones']]],
 ['Trust',[['scope-proof','shield','Proof of delivery'],['scope-resolve','handshake','FairResolve AI'],['scope-passport','circle','Trust Passport'],['scope-security','lock','Security'],['verify','check','Verify evidence'],['lab','lab','Attack lab']]],
 ['Money',[['wallet','wallet','Wallet'],['scope-history','ledger','Transactions'],['analytics','chart','Analytics'],['ledger','ledger','Legacy ledger']]],
 ['Account',[['inbox','bell','Inbox'],['activity','clock','Activity'],['scope-profile','settings','Profile'],['settings','settings','Settings'],['scope-demo','lab','Guided demo']]]
];
function vaultNav(page){return vaultGroups.map(([group,items])=>`<section class="vault-nav-group"><h2>${group}</h2><nav aria-label="${group}">${items.filter(([id])=>runtime.hosted||!['marketplace','inbox'].includes(id)).map(([id,symbol,label])=>`<a href="#${id}" ${page===id?'aria-current="page"':''}>${icon(symbol)}<span>${label}</span>${page===id?'<i class="vault-current-dot" aria-hidden="true"></i>':''}</a>`).join('')}</nav></section>`).join('');}
const vaultBaseShell=shell;
shell=function(){
 vaultBaseShell();
 const page=(location.hash.slice(1)||(runtime.showcase?'overview':'scopeguard')).split('/')[0];
 const sidebar=$('.sg-sidebar');sidebar.innerHTML=`<div class="vault-sidebar-intro"><span class="vault-mini-lock">${icon('lock')}</span><p>YOUR PRIVATE WORKSPACE<small>Clarity at every handover.</small></p></div>${vaultNav(page)}<footer class="vault-nav-footer">${icon('shield')} ML-DSA-65 signatures<a href="#overview">Original workspace ${icon('arrow')}</a></footer>`;
 const bar=$('.header-inner');bar.insertAdjacentHTML('afterbegin',`<button class="icon-button vault-menu-toggle" data-vault="open-nav" aria-label="Open navigation" aria-controls="vault-navigation">${icon('grid')}</button>`);
 const account=$('.account-menu');account.outerHTML=`<details class="vault-account"><summary aria-label="Account menu for ${esc(me.identity.name)}">${person(me.identity.name)}<span>${esc(me.identity.name)}</span>${icon('chevron')}</summary><nav aria-label="Your account"><p>Signed in as <strong>@${esc(me.identity.name)}</strong></p><a href="#scope-profile">${icon('peer')}My profile</a><a href="#wallet">${icon('wallet')}Wallet</a><a href="#settings">${icon('settings')}Settings</a><button data-action="logout">${icon('exit')}Sign out</button></nav></details>`;
 if(!runtime.hosted)$('.top-actions').insertAdjacentHTML('afterbegin',`<a class="icon-button vault-local-activity" href="#activity" aria-label="View activity">${icon('bell')}</a>`);
 const loader=$('#main .loading');if(loader)loader.outerHTML=`<section class="vault-skeleton" role="status" aria-label="Loading workspace"><span class="sr-only">Opening your workspace…</span><div class="vault-skeleton-title"></div><div class="vault-skeleton-row"><div></div><div></div><div></div></div><div class="vault-skeleton-body"></div></section>`;
 $('#vault-navigation')?.remove();
 const drawer=document.createElement('dialog');drawer.id='vault-navigation';drawer.className='vault-drawer';drawer.setAttribute('aria-labelledby','vault-navigation-title');drawer.innerHTML=`<header><h2 id="vault-navigation-title">Your workspace</h2><button class="icon-button" data-vault="close-nav" aria-label="Close navigation">${icon('close')}</button></header>${vaultNav(page)}`;document.body.append(drawer);
};
function vaultMoney(key,value){return `<span class="vault-amount" data-vault-count="${esc(value)}" data-vault-key="${key}" aria-label="${esc(eth(value))} test ETH">${esc(eth(value))}</span><span class="vault-currency">test ETH</span>`;}
function vaultSparkline(events){
 const now=me?.now||Math.floor(Date.now()/1000),day=86400,counts=Array.from({length:7},(_,i)=>events.filter(e=>e.at>now-(7-i)*day&&e.at<=now-(6-i)*day).length),max=Math.max(1,...counts);
 const points=counts.map((v,i)=>[6+i*25,56-v/max*42]);const line=points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ');
 return `<svg viewBox="0 0 164 66" class="vault-sparkline" role="img" aria-label="Recent recorded activity, daily counts ${counts.join(', ')}. Based on up to eight recent events, not a balance history."><defs><linearGradient id="vault-spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".24"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="${line} L156,64 L6,64 Z" fill="url(#vault-spark-fill)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="156" cy="${points.at(-1)[1]}" r="3" fill="var(--accent)"/></svg>`;
}
function vaultStepper(project=null,deliveries=[]){
 const funded=Boolean(project?.active)&&!project?.pending,delivered=deliveries.length>0,released=project?.state==='completed';
 return `<section class="vault-stepper" aria-label="${project?'Agreement progress':'How your escrow works'}" data-complete="${released}"><div class="vault-stepper-heading"><span>${icon(released?'unlock':'lock')} ${project?released?'Settlement recorded':'A protected handover':'A clear path to release'}</span>${project?.state==='disputed'?sgStatus('disputed'):'<small>Human decisions. Signed evidence.</small>'}</div><ol>${[['Agree','Both parties sign',funded||released],['Deliver','Review the evidence',delivered||released],['Release','Approve test payment',released]].map(([title,copy,done],i)=>`<li ${done?'class="is-complete"':''}><span class="vault-step-node">${done?icon('check'):i+1}</span><div><strong>${title}</strong><small>${copy}</small></div>${i<2?'<span class="vault-step-line" aria-hidden="true"></span>':''}</li>`).join('')}</ol></section>`;
}
const vaultStatusNames={active:'Funded',completed:'Released',disputed:'Disputed',proposed:'Awaiting signatures',cancelled:'Cancelled',PASSED:'Passed',FAILED:'Failed',NEEDS_HUMAN_REVIEW:'In review',signature_verified:'Signature verified'};
sgStatus=function(state){return `<span class="sg-status ${esc(state)}"><i class="vault-status-dot" aria-hidden="true"></i>${esc(vaultStatusNames[state]||String(state).replaceAll('_',' '))}</span>`;};
const vaultAgreement=sgAgreement;
sgAgreement=function(d){let html=vaultAgreement(d);if(d.project.state==='active'&&d.deliveries.some(del=>!d.payments.some(p=>p.milestone===del.milestone&&['release','refund','split'].includes(p.kind))))html=html.replace(sgStatus('active'),vaultReviewPill());return vaultStepper(d.project,d.deliveries)+html;};
function vaultReviewPill(){return '<span class="sg-status in-review"><i class="vault-status-dot" aria-hidden="true"></i>In review</span>';}
const vaultProjectRow=sgProjectLink;
sgProjectLink=function(p,page='scope-project'){const html=vaultProjectRow(p,page);return p.in_review?html.replace(sgStatus('active'),vaultReviewPill()):html;};
sgDashboard=function(d){
 const s=d.stats,w=d.wallet||{},funds=d.wallet_funds,earnings=w.account?.claimable||'0',name=me.identity.name;
 return `<div class="page-head vault-greeting"><div><p class="eyebrow">YOUR PRIVATE WORKSPACE</p><h1>Welcome back, <span>${esc(name)}.</span></h1><p class="muted">Your agreements, protected. Your next move, clear.</p></div><a class="button vault-primary" href="#scope-create">${icon('plus')}Create agreement</a></div><div class="vault-balance-grid"><section class="card vault-balance-hero"><div class="vault-card-top"><span>${icon('vault')} Escrow balance</span><span class="vault-reserved">${icon('lock')}Reserved · test funds</span></div><div class="vault-balance-body"><div>${vaultMoney('reserved',s.reserved_wei)}<p>Across your ScopeGuard agreements.</p></div><div class="vault-spark-wrap">${vaultSparkline(d.recent)}<span>Recent recorded activity</span></div></div><div class="vault-card-bottom"><span><i class="vault-status-dot"></i>Conditional database reservation</span><a href="#scope-milestones">Manage milestones ${icon('arrow')}</a></div></section><section class="card vault-secondary"><div class="vault-card-top"><span>${icon('wallet')} Wallet</span></div><div class="vault-secondary-number">${vaultMoney('available',funds)}</div><p>Available for your next agreement.</p><a href="#wallet">Manage funds ${icon('arrow')}</a></section><section class="card vault-secondary"><div class="vault-card-top"><span>${icon('arrowUp')} Earnings</span></div><div class="vault-secondary-number">${vaultMoney('earnings',earnings)}</div><p>Ready to claim. Other released payments appear in Wallet.</p><a href="#wallet">View earnings ${icon('arrow')}</a></section></div><p class="vault-money-note">${icon('shield')}Simulated test ETH only. No real money or on-chain fund locking. ${s.pending?`${s.pending} proposal${s.pending===1?'':'s'} awaiting mutual approval.`:'Signed scope. Clear evidence. Explicit approval.'}</p>${vaultStepper()}<div class="vault-overview-grid"><section class="card vault-agreements"><div class="section-title"><div><p class="eyebrow">YOUR AGREEMENTS</p><h2>A clear view of the work.</h2></div><span class="vault-total">${s.total} total</span></div><div class="vault-project-filters" aria-label="Agreement status totals">${[['active','Funded',s.active],['completed','Released',s.completed],['disputed','Disputed',s.disputed]].map(([state,label,count])=>`<span>${sgStatus(state)}<strong>${count}</strong></span>`).join('')}</div>${d.projects.length?d.projects.map(p=>sgProjectLink(p)).join(''):`<div class="vault-empty">${icon('handshake')}<h3>Good work starts with a clear agreement.</h3><p>Set the scope together, review the evidence, and release payment when you’re ready.</p><a class="button secondary" href="#scope-create">Create your first agreement ${icon('arrow')}</a><a class="vault-empty-demo" href="#scope-demo">Or explore the guided demo</a></div>`}</section><aside class="card vault-security"><div class="vault-security-icon">${icon('shield')}</div><p class="eyebrow">TRUST, WITH EVIDENCE</p><h2>Every handover<br>has a record.</h2><ul><li>${icon('check')}ML-DSA-65 signing</li><li>${icon('check')}SHA-256 file fingerprints</li><li>${icon('check')}Private delivery evidence</li></ul><p>Open an agreement to verify its signatures, integrity and payment state.</p><a href="#scope-security">Inside your vault ${icon('arrow')}</a><small>Analysis uses labelled deterministic demo rules. Verification supports your judgment; it does not replace it.</small></aside></div><div class="sg-grid vault-lower-grid"><section class="card"><div class="section-title"><h2>Activity at a glance</h2><a href="#analytics">Analytics ${icon('arrow')}</a></div>${['active','completed','disputed','proposed','cancelled'].map(state=>{const count=d.projects.filter(p=>p.state===state).length;return `<div class="sg-chart-row vault-bar-${state}"><span>${esc(vaultStatusNames[state])}</span><progress max="${Math.max(1,s.total)}" value="${count}" aria-label="${esc(vaultStatusNames[state])}: ${count}"></progress><strong>${count}</strong></div>`;}).join('')}<div class="vault-check-summary"><span>${d.delivery_count} deliveries inspected</span><span>${d.delivery_checks.NEEDS_HUMAN_REVIEW} checks in human review</span></div></section><section class="card"><p class="eyebrow">THE LATEST</p><h2>Recent activity</h2>${d.recent.length?d.recent.slice(0,4).map(e=>`<div class="vault-event"><span>${icon(e.event.includes('signed')?'shield':e.event.includes('release')?'unlock':'clock')}</span><div><strong>${esc(e.event.replaceAll('_',' '))}</strong><small>${esc(e.actor)} · ${stamp(e.at)}</small></div></div>`).join(''):`<div class="vault-quiet-empty">${icon('shield')}<p>Your signed activity will appear here.<small>Everything starts with your first agreement.</small></p></div>`}</section></div>`;
};
function vaultAnimateBalances(){
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 document.querySelectorAll('[data-vault-count]').forEach(element=>{
  const key=me.identity.name+'/'+element.dataset.vaultKey,target=BigInt(element.dataset.vaultCount),previous=vaultBalanceCache.get(key);
  vaultBalanceCache.set(key,target);
  if(reduce.matches||previous===target)return;
  const start=previous??0n,began=performance.now();
  function tick(now){
   if(!element.isConnected)return;
   const t=reduce.matches?1:Math.min(1,(now-began)/180),scale=BigInt(Math.round((1-(1-t)**3)*1000)),value=start+(target-start)*scale/1000n;
   element.textContent=t===1?eth(target):eth(value/1000000000000000n*1000000000000000n);
   if(t<1)requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
 });
}
const vaultBalanceCache=new Map();
const vaultEnhance=enhanceExperience;
enhanceExperience=function(){
 vaultEnhance();
 $('.accent-picker')?.remove();
 const page=(location.hash.slice(1)||(runtime.showcase?'overview':'scopeguard')).split('/')[0];
 const crumb=$('.workspace-name');if(crumb){crumb.classList.add('vault-breadcrumb');crumb.textContent='Workspace / '+(page==='scopeguard'?'Vault overview':sgLabels[page]||({overview:'Original workspace',escrows:'Legacy agreements',wallet:'Wallet',analytics:'Analytics',inbox:'Inbox',activity:'Activity',settings:'Settings',ledger:'Ledger',lab:'Attack lab',verify:'Verify evidence',marketplace:'Marketplace'})[page]||'Workspace');}
 vaultAnimateBalances();
};
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-vault]');
 if(button?.dataset.vault==='open-nav')$('#vault-navigation')?.showModal();
 if(button?.dataset.vault==='close-nav')$('#vault-navigation')?.close();
 if(event.target.closest('#vault-navigation a'))$('#vault-navigation').close();
 const account=$('.vault-account[open]');if(account&&!account.contains(event.target))account.open=false;
 if(event.target.closest('.vault-account nav a'))event.target.closest('.vault-account').open=false;
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=$('.vault-account[open]');if(menu){menu.open=false;$('summary',menu).focus();}}});

startWorkspace();
