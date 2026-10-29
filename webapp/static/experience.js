'use strict';
// Visual layer and statistics. Signing and payment actions remain in app.js.
shapes.chart='<path d="M3 3v18h18M7 16v-5m5 5V7m5 9v-8"/>';
shapes.spark='<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>';
const VAULT='/assets/agreement-link.png',KNOT='/assets/evidence-layers.png';
let analysisRange=7,analysisMode='activity',analysisRole='all',insightData=null,chartObserver=null;
const stateNames={pending:'Awaiting progress',checking:'Delivery & review',settled:'Payment released',refunded:'Refunded',review:'Needs review',cancelled:'Cancelled'};
brand=function(){return `<span class="brand-symbol quantum-symbol" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="m20 3 15 8.5v17L20 37 5 28.5v-17L20 3Z"/><path d="m5 11.5 15 9 15-9M20 20.5V37M12.5 7.2 28 16v9l-8 4.5-8-4.5v-9l8-4.5 8 4.5"/></svg></span><span>PQ<span class="brand-slash">/</span>Escrow</span>`;};
document.documentElement.dataset.accent=localStorage.getItem('pqe-accent')||'mint';

function ensurePreview(){
 if(!(runtime.preview||runtime.showcase)||$('.preview-ribbon'))return;
 document.body.classList.add('design-preview');
 const bar=document.createElement('div');bar.className='preview-ribbon';bar.innerHTML=runtime.showcase?`<span>${icon('spark')}INTERACTIVE DEMO</span><span>Sample data <b>·</b> Read-only workspace</span><a href="/?signup=1">Create your account ${icon('arrow')}</a>`:`<span>${icon('spark')}LOCAL DESIGN PREVIEW</span><span>Labelled sample workspace data</span>`;document.body.prepend(bar);
}
function sculpturalPanel(src=KNOT,label='Cryptographic confidence'){
 return `<div class="sculptural-panel"><img src="${src}" alt="" loading="lazy" decoding="async"><span>${icon('shield')}${label}</span><div class="sculpture-orbit" aria-hidden="true"></div></div>`;
}
function enhanceAuthExperience(){
 ensurePreview();const story=$('.login-story');if(!story)return;
 story.innerHTML=`<a class="logo" href="#">${brand()}</a><div class="auth-coordinate"><span class="signal-dot"></span>THE NEXT LAYER OF TRUST<span>01 / PQ</span></div><div class="poster-copy"><p class="eyebrow">A better way to agree</p><h1>Your work.<br>Your terms.<br><em>Your proof.</em></h1><p>Make the agreement. Verify the delivery.<br>Move forward with confidence.</p></div><img class="poster-art" src="${VAULT}" alt="Smooth interlocking ceramic and frosted-glass forms" fetchpriority="high" decoding="async"><div class="poster-stamp">${icon('shield')}<span>BUILT ON EVIDENCE<small>Signed at every step.</small></span></div><div class="poster-proof"><div><b>01</b><span>Agree clearly</span></div><div><b>02</b><span>Verify the file</span></div><div><b>03</b><span>Settle with proof</span></div></div><footer><span>ML-DSA-65 · SHA-256</span><span>Test funds only ${icon('arrowUp')}</span></footer>`;
 $('.auth-local').innerHTML=`<span class="signal-dot"></span>${runtime.hosted?'YOUR ONLINE WORKSPACE':'YOUR LOCAL WORKSPACE'}`;
 $('.login-form-side').classList.add('auth-glass');
 $('.auth-description').textContent=authMode==='register'?'One account. Clear agreements. Evidence you can trust.':'Your agreements, deliveries and decisions. All connected.';
 $('.demo-box').insertAdjacentHTML('afterbegin',`<div class="prototype-entry"><a class="button secondary" href="/?demo=1#overview">${icon('grid')}Explore interactive demo ${icon('arrow')}</a><p>Look around first. No sign-up. Clearly labelled sample data.</p></div>`);
 if(runtime.preview&&!$('#sample-workspace'))$('.demo-box').insertAdjacentHTML('beforebegin',`<a id="sample-workspace" class="sample-link" href="/?sample=1#overview">Explore the sample workspace ${icon('arrow')}</a>`);
}

function insightSummary(){return WorkspaceAnalytics.summarize(insightData?.records||[],insightData?.entries||[],insightData?.wallet,me?.now||Math.floor(Date.now()/1000),analysisRange,analysisRole);}
function metricBlocks(summary){
 return `<div class="intelligence-metrics"><div><span>${icon('file')}Agreements</span><strong>${summary.total}</strong><small>Across this role view</small></div><div><span>${icon('check')}Released value</span><strong>${eth(summary.releasedWei)}<small> test ETH</small></strong><small>Verified, settled payments</small></div><div><span>${icon('clock')}Open buying value</span><strong>${eth(summary.openBuyingWei)}<small> test ETH</small></strong><small>Agreements still in progress</small></div><div><span>${icon('shield')}Settled agreements</span><strong>${summary.completion}<small>%</small></strong><small>Payments and refunds complete</small></div></div>`;
}
function analyticsMarkup(compact=false){
 const summary=insightSummary();
 return `<section class="analytics-widget ${compact?'compact':''}" aria-label="Workspace analytics"><div class="analytics-heading"><div><p class="eyebrow">See the bigger picture</p><h2>Workspace intelligence<span class="section-spark">✳</span></h2><p>Real activity. Clearer next moves.</p></div><div class="analytics-heading-actions">${compact?'<a class="text-link" href="#analytics">Explore analytics '+icon('arrowUp')+'</a>':'<button class="secondary" data-experience="export-stats">'+icon('download')+'Export statistics</button>'}</div></div>${metricBlocks(summary)}<div class="analytics-controls"><div class="chart-mode" role="group" aria-label="Chart measure">${[['activity','Activity'],['payments','Payments'],['agreements','Agreement value']].map(([value,label])=>`<button data-experience="chart-mode" data-value="${value}" aria-pressed="${analysisMode===value}">${label}</button>`).join('')}</div><div class="chart-filters"><label class="sr-only" for="analytics-role">Analytics role</label><select id="analytics-role"><option value="all" ${analysisRole==='all'?'selected':''}>All roles</option><option value="buyer" ${analysisRole==='buyer'?'selected':''}>Buying</option><option value="seller" ${analysisRole==='seller'?'selected':''}>Selling</option></select><div class="chart-range" role="group" aria-label="Chart date range">${[7,30,90].map(days=>`<button data-experience="chart-range" data-value="${days}" aria-pressed="${analysisRange===days}">${days}D</button>`).join('')}</div></div></div><div class="analytics-body"><div class="trend-panel"><div class="plot-caption"><span id="plot-label"></span><span id="plot-total"></span></div><div class="analytics-plot"><svg class="trend-svg" role="img" aria-label="Workspace trend chart"></svg><div class="chart-tooltip" role="tooltip" hidden></div></div><p class="chart-footnote">${compact?'Recorded events and settled payments in this workspace.':'Activity counts saved audit events. Payments count released settlements. Agreement value is the value created, not money transferred.'}</p></div><aside class="distribution-panel"><div class="distribution-head"><h3>Agreement status</h3><span class="mini-label">ALL TIME</span></div><div class="status-distribution"></div></aside></div><div class="analytics-bottom"><span>${icon('refresh')}Updated ${esc(new Date((me?.now||Date.now()/1000)*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</span><span>${(runtime.preview||runtime.showcase)?'LABELLED SAMPLE WORKSPACE':'YOUR WORKSPACE DATA'}</span></div></section>`;
}
function drawTrend(){
 const widget=$('.analytics-widget');if(!widget)return;
 const summary=insightSummary(),plot=$('.analytics-plot'),svg=$('.trend-svg'),width=Math.max(270,Math.round(plot.clientWidth)),height=235,left=42,right=14,top=25,bottom=34;
 const amounts=analysisMode!=='activity',values=summary.buckets.map(bucket=>analysisMode==='activity'?bucket.actions:Number(eth(analysisMode==='payments'?bucket.releasedWei:bucket.agreementWei)));
 const rawMax=Math.max(...values,1),max=amounts?rawMax:Math.max(2,Math.ceil(rawMax/2)*2),chartW=width-left-right,chartH=height-top-bottom;
 const coordinates=values.map((value,index)=>[left+index/Math.max(1,values.length-1)*chartW,top+chartH-value/max*chartH]);
 const line=coordinates.map(([x,y],index)=>`${index?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' '),area=`${line} L${left+chartW},${top+chartH} L${left},${top+chartH} Z`;
 const label=analysisMode==='activity'?'Recorded actions':analysisMode==='payments'?'Released payments · test ETH':'Created agreement value · test ETH';$('#plot-label').textContent=label;
 const total=analysisMode==='activity'?String(summary.periodActions):eth(analysisMode==='payments'?summary.periodReleasedWei:summary.buckets.reduce((sum,bucket)=>sum+bucket.agreementWei,0n))+' test ETH';$('#plot-total').textContent=total;
 svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('aria-label',`${label} over ${analysisRange} days. Total ${total}.`);
 const grid=[0,.5,1].map(ratio=>{const y=top+chartH*(1-ratio),value=max*ratio;return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width-right}" y2="${y}"/><text class="chart-axis" x="${left-9}" y="${y+4}" text-anchor="end">${amounts?(value>=1000?Intl.NumberFormat(undefined,{notation:value>=1e12?'scientific':'compact',maximumSignificantDigits:3}).format(value):Number(value.toFixed(2))):Math.round(value)}</text>`;}).join('');
 const labels=summary.buckets.map((bucket,index)=>{if(index!==0&&index!==values.length-1&&index%Math.max(1,Math.ceil(values.length/(width<440?3:6)))!==0)return '';const x=coordinates[index][0];return `<text class="chart-axis" x="${x}" y="${height-9}" text-anchor="${index===0?'start':index===values.length-1?'end':'middle'}">${esc(new Date(bucket.at*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</text>`;}).join('');
 const points=coordinates.map(([x,y],index)=>{const bucket=summary.buckets[index],value=analysisMode==='activity'?String(bucket.actions):eth(analysisMode==='payments'?bucket.releasedWei:bucket.agreementWei)+' test ETH';return `<g class="chart-point" tabindex="${index===values.length-1?0:-1}" role="img" data-index="${index}" data-value="${esc(value)}" data-date="${esc(new Date(bucket.at*1000).toLocaleDateString(undefined,{month:'long',day:'numeric'}))}" aria-label="${esc(new Date(bucket.at*1000).toLocaleDateString())}: ${esc(value)}"><circle class="chart-hit" cx="${x}" cy="${y}" r="12"/><circle class="chart-dot" cx="${x}" cy="${y}" r="${values.length>30?2:3}"/></g>`;}).join('');
 svg.innerHTML=`<title>${esc(label)}</title><defs><linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%"/><stop offset="100%"/></linearGradient></defs>${grid}<path class="trend-area" d="${area}"/><path class="trend-line" d="${line}"/>${points}${labels}`;
 const host=$('.status-distribution'),totalCount=Math.max(1,summary.total),radius=44,circumference=2*Math.PI*radius;let offset=0;
 const circles=Object.entries(summary.states).map(([state,count])=>{const length=count/totalCount*circumference,html=count?`<circle class="donut-segment state-${state}" cx="64" cy="64" r="${radius}" stroke-dasharray="${Math.max(0,length-3)} ${circumference}" stroke-dashoffset="${-offset}"><title>${stateNames[state]}: ${count}</title></circle>`:'';offset+=length;return html;}).join('');
 host.innerHTML=`<svg class="status-donut" viewBox="0 0 128 128" role="img" aria-label="${summary.total} agreements by status"><circle class="donut-track" cx="64" cy="64" r="44"/>${circles}<text class="donut-number" x="64" y="64" text-anchor="middle">${summary.total}</text><text class="donut-caption" x="64" y="80" text-anchor="middle">AGREEMENTS</text></svg><ul class="status-legend">${Object.entries(summary.states).map(([state,count])=>`<li><span class="legend-dot state-${state}"></span><span>${stateNames[state]}</span><strong>${count}</strong></li>`).join('')}</ul>`;
 if(!summary.total&&!plot.querySelector('.plot-empty'))plot.insertAdjacentHTML('beforeend','<div class="plot-empty"><strong>Your story starts here.</strong><span>Create an agreement to build your activity history.</span></div>');
 if(summary.total)plot.querySelector('.plot-empty')?.remove();
}
function mountCharts(){
 chartObserver?.disconnect();const plot=$('.analytics-plot');if(!plot)return;drawTrend();let previous=plot.clientWidth;
 chartObserver=new ResizeObserver(()=>{if(plot.isConnected&&Math.abs(plot.clientWidth-previous)>1){previous=plot.clientWidth;drawTrend();}});chartObserver.observe(plot);
}
function fundingCard(summary){
 return `<section class="funding-insight ${summary.shortfall?'attention':''}"><span class="funding-glyph">${icon(summary.shortfall?'clock':'shield')}</span><div><h3>${summary.shortfall?'A little more backing keeps things moving.':'Your funding picture, at a glance.'}</h3><p>${summary.shortfall?`${eth(summary.shortfall)} test ETH more would cover all your open buying agreements.`:'Your current escrow balance covers your open buying value.'} Funds are pooled and are checked again at settlement.</p></div><a class="button secondary" href="#wallet">Open wallet ${icon('arrow')}</a></section>`;
}
async function analyticsPage(){
 const [wallet,{escrows},audit]=await Promise.all([api('wallet'),api('escrows'),api('audit')]);insightData={records:escrows,entries:audit.entries,wallet};
 return head('Your workspace, in focus','A clearer view of every move.','Explore your agreement mix, activity and verified payment history.','<button class="secondary" data-action="refresh">'+icon('refresh')+'Refresh data</button>')+analyticsMarkup()+fundingCard(insightSummary())+`<div class="analytics-explainer"><div>${icon('shield')}<strong>Evidence, not estimates.</strong><p>Statistics are calculated from saved agreements, audit entries and settlement records.</p></div><div>${icon('wallet')}<strong>Keep the units clear.</strong><p>All values are test ETH. Open agreement value is not a reserved balance or a completed payment.</p></div><div>${icon('clock')}<strong>Compare the right period.</strong><p>Use 7, 30 or 90 days and filter by your buying or selling role.</p></div></div>`;
}

function enhanceOverview(){
 const heading=$('.page-head');heading.classList.add('overview-hero');const copy=heading.firstElementChild;
 copy.querySelector('.eyebrow').textContent='YOUR TRUST WORKSPACE';copy.querySelector('h1').classList.add('hero-greeting');
 copy.querySelector('h1').insertAdjacentHTML('afterend','<h2 class="hero-title">Your agreements.<br><em>Beyond doubt.</em></h2>');
 const button=heading.querySelector('button[data-action="new"]');const actions=document.createElement('div');actions.className='hero-actions';if(button)actions.append(button);actions.insertAdjacentHTML('beforeend',`<a class="hero-secondary" href="#analytics">Explore your statistics ${icon('arrowUp')}</a><button class="hero-secondary tour-button" data-experience="tour">${icon('circle')}Take a tour</button>`);copy.append(actions);
 heading.insertAdjacentHTML('beforeend',`<figure class="hero-art"><img src="${VAULT}" alt="" decoding="async"><figcaption>${icon('shield')}Every step has proof<span class="signal-dot"></span></figcaption></figure>`);
 insightData={records:overviewRecords,entries:overviewAudit,wallet:overviewWallet};
 $('.workspace-insights')?.remove();const before=$('.overview-grid');if(before)before.insertAdjacentHTML('beforebegin',analyticsMarkup(true));
 const side=$('.overview-side');if(side){side.insertAdjacentHTML('afterbegin',`<section class="card security-signal"><div class="security-heading"><span class="eyebrow">WORKSPACE SIGNAL</span>${icon('spark')}</div><h3>Clarity is your<br>strongest asset.</h3><div class="signal-row"><span class="signal-dot"></span>${runtime.showcase?'Sample identity · read-only':'Signing key '+(me.unlocked?'unlocked':'locked')}</div><div class="signal-row"><span class="signal-dot ${me.online?'':'paused'}"></span>Payments ${me.online?'connected':'paused'}</div><div class="key-signal"><span>${runtime.showcase?'SAMPLE SIGNING FINGERPRINT':'YOUR SIGNING FINGERPRINT'}</span><code>${esc(short(me.identity.key_hash,22))}</code></div></section>`);side.querySelector('.assurance-card')?.remove();}
}
function appearanceCard(){
 const theme=localStorage.getItem('pqe-theme')||'dark',accent=document.documentElement.dataset.accent||'mint';
 return `<section class="card appearance-studio"><div class="card-title"><div><p class="eyebrow">Make space for your style</p><h2>Appearance studio</h2><p>Your workspace, your atmosphere.</p></div>${icon('spark')}</div><div class="appearance-grid">${[['dark','Obsidian','Deep focus. Electric detail.'],['light','Frost','A lighter kind of clarity.'],['device','System','Follow your device.']].map(([value,label,description])=>`<button class="theme-card theme-${value}" data-experience="theme" data-value="${value}" aria-pressed="${theme===value}"><span class="theme-mini" aria-hidden="true"><i></i><i></i><i></i></span><strong>${label}</strong><small>${description}</small></button>`).join('')}</div><div class="accent-picker"><span>Signature colour</span>${[['mint','Electric mint'],['ice','Arctic blue'],['violet','Ultraviolet']].map(([value,label])=>`<button class="accent-swatch accent-${value}" data-experience="accent" data-value="${value}" aria-label="${label}" aria-pressed="${accent===value}"><span></span></button>`).join('')}</div></section>`;
}
let tourIndex=0,tourHighlight=null;
function focusTourTarget(){const target=tourHighlight&&$(tourHighlight.target);if(!target)return;target.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});target.classList.add('tour-focus');setTimeout(()=>target.classList.remove('tour-focus'),3000);tourHighlight=null;}
const themeBeforeExperience=applyTheme;
applyTheme=function(value){themeBeforeExperience(value);document.querySelectorAll('[data-experience="theme"]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.value===value)));};
const productTour=[
 {title:'Start with a clear balance.',text:'Your wallet starts with 10 test ETH. Move funds into the escrow balance when you are ready to back a buying agreement.',icon:'wallet',page:'wallet',target:'#deposit-amount',action:'Open wallet'},
 {title:'Put the agreement in writing.',text:'Choose your partner, amount and deadline. Add a reference file to bind its exact fingerprint to the signed terms.',icon:'file',page:'escrows',target:'.page-head',action:'Open agreements'},
 {title:'Check what was delivered.',text:'The seller signs and sends the file. A mismatched reference fingerprint is blocked. Review the actual work before approving payment.',icon:'shield',page:'verify',target:'.verify-tools',action:'Explore verification'},
 {title:'Finish with a recorded decision.',text:'A signature approves the decision; finishing settlement records the outcome. The seller can then claim the released test funds.',icon:'check',page:'ledger',target:'.page-head',action:'Explore the ledger'},
 {title:'Keep the bigger picture in view.',text:'Switch date ranges, compare roles and inspect payment trends. Statistics distinguish open agreement value from money actually released.',icon:'chart',page:'analytics',target:'.analytics-widget',action:'Explore analytics'}
];
function showProductTour(){
 let dialog=$('#product-tour');if(!dialog){dialog=document.createElement('dialog');dialog.id='product-tour';dialog.setAttribute('aria-labelledby','product-tour-title');document.body.append(dialog);}
 const step=productTour[tourIndex];dialog.innerHTML=`<div class="tour-top"><span class="eyebrow">A QUICK PRODUCT WALKTHROUGH</span><button class="icon-button" data-experience="tour-close" aria-label="Close product tour">${icon('close')}</button></div><div class="tour-illustration" aria-hidden="true">${icon(step.icon)}<span></span><span></span></div><p class="tour-count">${String(tourIndex+1).padStart(2,'0')} <span>/ 05</span></p><h2 id="product-tour-title">${step.title}</h2><p class="muted">${step.text}</p><button class="text-link tour-open" data-experience="tour-open">${step.action}${icon('arrowUp')}</button><div class="tour-dots" aria-label="Step ${tourIndex+1} of 5">${productTour.map((_,index)=>`<i class="${index===tourIndex?'current':''}"></i>`).join('')}</div><div class="actions"><button class="secondary" data-experience="tour-back" ${tourIndex===0?'disabled':''}>Back</button><button data-experience="tour-next">${tourIndex===4?'Finish tour':'Next step'}${icon('arrow')}</button></div>`;
 if(!dialog.open)dialog.showModal();
}
function enhanceExperience(){
 ensurePreview();if(!me||!$('.workspace'))return;
 const [page,id]=(location.hash.slice(1)||'overview').split('/');
 document.body.dataset.page=page;
 const workspace=$('.workspace-name');if(workspace)workspace.innerHTML=`<span class="breadcrumb-dot"></span>Workspace <span>/</span> ${esc(({overview:'Overview',escrows:'Agreements',analytics:'Analytics',wallet:'Wallet',activity:'Activity',settings:'Settings',inbox:'Inbox',lab:'Attack lab',verify:'Verification',ledger:'Ledger',help:'Getting started'})[page]||'Overview')}`;
 if(page==='overview')enhanceOverview();
 if(page==='analytics'||page==='overview')mountCharts();
 if(runtime.showcase){const exit=$('[data-action="logout"]');if(exit){exit.setAttribute('aria-label','Exit demo');exit.title='Exit demo';}const footer=$('.workspace-footer');if(footer)footer.innerHTML='<span>Interactive sample · No saved changes or real payments</span><a href="/?signup=1">Create your own workspace '+icon('arrow')+'</a>';}
 if(page==='settings'&&!$('.appearance-studio'))$('.two-col')?.insertAdjacentHTML('beforebegin',appearanceCard());
 if(page==='help')$('.page-head')?.insertAdjacentHTML('beforeend',`<button class="secondary" data-experience="tour">${icon('circle')}Take a guided tour</button>`);
 if(page==='wallet')$('.stats')?.insertAdjacentHTML('afterend',`<section class="wallet-visual">${sculpturalPanel(KNOT,'Backed by clear commitments')}<div><p class="eyebrow">Room for your next move</p><h2>Keep your work.<br><em>And your funds.</em><br>In good order.</h2><p>Your escrow balance backs agreements. Your earnings become available after verified settlement.</p><a class="text-link" href="#analytics">See the full picture ${icon('arrowUp')}</a></div></section>`);
 if(page==='verify')$('.verify-tools')?.insertAdjacentHTML('beforebegin',`<div class="verification-banner">${sculpturalPanel(KNOT,'A stronger chain of evidence')}<div><p class="eyebrow">Proof is a powerful thing</p><h2>Know what you’re<br><em>putting your name to.</em></h2><p>Inspect signatures. Compare fingerprints. Keep the decisions yours.</p></div></div>`);
 if(page==='lab'){
  const head=$('.page-head');head.classList.add('lab-hero');head.insertAdjacentHTML('beforeend',`<div class="lab-orbit" aria-hidden="true"><img src="${KNOT}" alt=""><span>TEST. BREAK. VERIFY.</span></div>`);
  document.querySelectorAll('.lab-card').forEach((card,index)=>card.insertAdjacentHTML('afterbegin',`<span class="experiment-number" aria-hidden="true">0${index+1}</span>`));
 }
 if(page==='escrows'&&id)$('.instrument')?.classList.add('evidence-instrument');
 document.querySelectorAll('#main>.card,#main>.two-col,#main>.stats,.balance-grid,.analytics-widget,.overview-grid').forEach(element=>element.classList.add('reveal-in'));
 if(tourHighlight?.page===page)focusTourTarget();
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const art of document.querySelectorAll('.hero-art,.poster-art')){
  art.addEventListener('pointermove',event=>{const bounds=art.getBoundingClientRect();art.style.transform=`perspective(1000px) rotateY(${(event.clientX-bounds.left)/bounds.width*2-1}deg) rotateX(${1-(event.clientY-bounds.top)/bounds.height*2}deg)`;});art.addEventListener('pointerleave',()=>art.style.transform='');
 }
}
const experienceAuth=authPage,experienceRender=render;
authPage=function(){experienceAuth();enhanceAuthExperience();};
render=async function(options){chartObserver?.disconnect();const version=renderVersion+1;await experienceRender(options);if(me&&version===renderVersion)enhanceExperience();};

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-experience]');if(!button)return;const action=button.dataset.experience;
 if(action==='tour'){tourIndex=0;showProductTour();return;}
 if(action==='tour-close'){$('#product-tour').close();return;}
 if(action==='tour-back'){tourIndex=Math.max(0,tourIndex-1);showProductTour();return;}
 if(action==='tour-next'){if(tourIndex===4){$('#product-tour').close();return;}tourIndex++;showProductTour();return;}
 if(action==='tour-open'){const step=productTour[tourIndex];$('#product-tour').close();tourHighlight={page:step.page,target:step.target};if((location.hash.slice(1)||'overview')===step.page)focusTourTarget();else location.hash=step.page;return;}
 if(action==='chart-range'||action==='chart-mode'){
  if(action==='chart-range')analysisRange=Number(button.dataset.value);else analysisMode=button.dataset.value;
  const widget=$('.analytics-widget');widget.outerHTML=analyticsMarkup(widget.classList.contains('compact'));mountCharts();return;
 }
 if(action==='theme'){
  applyTheme(button.dataset.value);if($('#theme-select'))$('#theme-select').value=button.dataset.value;
  document.querySelectorAll('[data-experience="theme"]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));return;
 }
 if(action==='accent'){
  document.documentElement.dataset.accent=button.dataset.value;localStorage.setItem('pqe-accent',button.dataset.value);
  document.querySelectorAll('[data-experience="accent"]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));return;
 }
 if(action==='export-stats'){
  const summary=insightSummary(),rows=[['Date','Recorded actions','Created agreements','Released value (wei)','Created agreement value (wei)'],...summary.buckets.map(bucket=>[new Date(bucket.at*1000).toLocaleDateString(),bucket.actions,bucket.created,String(bucket.releasedWei),String(bucket.agreementWei)])];
  const csv=rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n');saveBlob(new Blob([csv],{type:'text/csv'}),'pq-escrow-statistics.csv');
 }
});
document.addEventListener('change',event=>{if(event.target.id==='theme-select')document.querySelectorAll('[data-experience="theme"]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.value===event.target.value)));if(event.target.id==='analytics-role'){analysisRole=event.target.value;const widget=$('.analytics-widget');widget.outerHTML=analyticsMarkup(widget.classList.contains('compact'));mountCharts();}});
function showChartTooltip(target){
 const point=target.closest('.chart-point');if(!point)return;const plot=point.closest('.analytics-plot'),tip=plot.querySelector('.chart-tooltip'),dot=point.querySelector('.chart-dot'),rect=dot.getBoundingClientRect(),bounds=plot.getBoundingClientRect();
 tip.textContent=point.dataset.date+' · '+point.dataset.value;tip.hidden=false;tip.style.left=Math.min(Math.max(12,rect.x-bounds.x-55),Math.max(12,bounds.width-180))+'px';tip.style.top=Math.max(0,rect.y-bounds.y-38)+'px';
}
document.addEventListener('pointerover',event=>showChartTooltip(event.target));document.addEventListener('focusin',event=>showChartTooltip(event.target));
document.addEventListener('pointerout',event=>{if(event.target.closest('.chart-point'))$('.chart-tooltip')?.setAttribute('hidden','');});
document.addEventListener('focusout',event=>{if(event.target.closest('.chart-point'))$('.chart-tooltip')?.setAttribute('hidden','');});
document.addEventListener('keydown',event=>{const point=event.target.closest('.chart-point');if(!point||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const points=[...point.closest('svg').querySelectorAll('.chart-point')];let index=points.indexOf(point);index=event.key==='Home'?0:event.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,index+(event.key==='ArrowRight'?1:-1)));for(const item of points)item.setAttribute('tabindex','-1');points[index].setAttribute('tabindex','0');points[index].focus();});
startWorkspace();
