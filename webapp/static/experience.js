'use strict';
// Visual layer and statistics. Signing and payment actions remain in app.js.
shapes.chart='<path d="M3 3v18h18M7 16v-5m5 5V7m5 9v-8"/>';
shapes.spark='<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>';
let analysisRange=7,analysisMode='activity',analysisRole='all',insightData=null,chartObserver=null;
const stateNames={pending:'Awaiting progress',checking:'Delivery & review',settled:'Payment released',refunded:'Refunded',review:'Needs review',cancelled:'Cancelled'};
brand=function(){
 return '<span class="brand-monogram" aria-hidden="true">pq</span><span>PQ<span class="brand-slash">/</span>Escrow</span>';
};
document.documentElement.dataset.accent=localStorage.getItem('pqe-accent')||'mint';

function ensurePreview(){
 if(!(runtime.preview||runtime.showcase)||$('.preview-ribbon'))return;
 document.body.classList.add('design-preview');
 const bar=document.createElement('div');bar.className='preview-ribbon';bar.innerHTML=runtime.showcase?`<span>${icon('spark')}INTERACTIVE DEMO</span><span>Sample data <b>·</b> Read-only workspace</span><a href="/?signup=1">Create your account ${icon('arrow')}</a>`:`<span>${icon('spark')}LOCAL DESIGN PREVIEW</span><span>Labelled sample workspace data</span>`;document.body.prepend(bar);
}

function enhanceAuthExperience(){
 ensurePreview();
 const story=$('.login-story');
 if(!story)return;
 story.innerHTML=`<a class="logo" href="/?">${brand()}</a>
 <div class="auth-editorial"><p class="eyebrow">Your work, in writing</p>
 <h1>A clear agreement.<br>A better handover.</h1>
 <p>Find a freelancer, agree on the delivery, and keep the conversation and payment record together.</p>
 <a class="text-link" href="/?demo=1#overview">Look around the sample workspace ${icon('arrow')}</a></div>
 <footer><span>Test ETH payments</span><span>Private file delivery</span></footer>`;
 $('.auth-local').innerHTML='PQ-Escrow account';
 $('.auth-description').textContent=authMode==='register'?'Set up your account to post work or send an offer.':'Sign in to pick up where you left off.';
}
function insightSummary(){return WorkspaceAnalytics.summarize(insightData?.records||[],insightData?.entries||[],insightData?.wallet,me?.now||Math.floor(Date.now()/1000),analysisRange,analysisRole);}
function metricBlocks(summary){
 return `<div class="intelligence-metrics"><div><span>${icon('file')}Agreements</span><strong>${summary.total}</strong><small>Across this role view</small></div><div><span>${icon('check')}Released value</span><strong>${eth(summary.releasedWei)}<small> test ETH</small></strong><small>Verified, settled payments</small></div><div><span>${icon('clock')}Open buying value</span><strong>${eth(summary.openBuyingWei)}<small> test ETH</small></strong><small>Agreements still in progress</small></div><div><span>${icon('shield')}Settled agreements</span><strong>${summary.completion}<small>%</small></strong><small>Payments and refunds complete</small></div></div>`;
}
function analyticsMarkup(compact=false){
 const summary=insightSummary();
 return `<section class="analytics-widget ${compact?'compact':''}" aria-label="Workspace analytics"><div class="analytics-heading"><div><p class="eyebrow">See the bigger picture</p><h2>Activity & payments</h2><p></p></div><div class="analytics-heading-actions">${compact?'<a class="text-link" href="#analytics">Explore analytics '+icon('arrowUp')+'</a>':'<button class="secondary" data-experience="export-stats">'+icon('download')+'Export statistics</button>'}</div></div>${metricBlocks(summary)}<div class="analytics-controls"><div class="chart-mode" role="group" aria-label="Chart measure">${[['activity','Activity'],['payments','Payments'],['agreements','Agreement value']].map(([value,label])=>`<button data-experience="chart-mode" data-value="${value}" aria-pressed="${analysisMode===value}">${label}</button>`).join('')}</div><div class="chart-filters"><label class="sr-only" for="analytics-role">Analytics role</label><select id="analytics-role"><option value="all" ${analysisRole==='all'?'selected':''}>All roles</option><option value="buyer" ${analysisRole==='buyer'?'selected':''}>Buying</option><option value="seller" ${analysisRole==='seller'?'selected':''}>Selling</option></select><div class="chart-range" role="group" aria-label="Chart date range">${[7,30,90].map(days=>`<button data-experience="chart-range" data-value="${days}" aria-pressed="${analysisRange===days}">${days}D</button>`).join('')}</div></div></div><div class="analytics-body"><div class="trend-panel"><div class="plot-caption"><span id="plot-label"></span><span id="plot-total"></span></div><div class="analytics-plot"><svg class="trend-svg" role="img" aria-label="Workspace trend chart"></svg><div class="chart-tooltip" role="tooltip" hidden></div></div><p class="chart-footnote">${compact?'Recorded events and settled payments in this workspace.':'Activity counts saved audit events. Payments count released settlements. Agreement value is the value created, not money transferred.'}</p></div><aside class="distribution-panel"><div class="distribution-head"><h3>Agreement status</h3><span class="mini-label">ALL TIME</span></div><div class="status-distribution"></div></aside></div><div class="analytics-bottom"><span>${icon('refresh')}Updated ${esc(new Date((me?.now||Date.now()/1000)*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</span><span>${(runtime.preview||runtime.showcase)?'LABELLED SAMPLE WORKSPACE':'YOUR WORKSPACE DATA'}</span></div></section>`;
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
 insightData={records:overviewRecords,entries:overviewAudit,wallet:overviewWallet};
 $('.workspace-insights')?.remove();
 const before=$('.overview-grid');
 if(before)before.insertAdjacentHTML('beforebegin',analyticsMarkup(true));
}
function appearanceCard(){
 const theme=localStorage.getItem('pqe-theme')||'light',accent=document.documentElement.dataset.accent||'mint';
 return `<section class="card appearance-studio"><div class="card-title"><div><p class="eyebrow">Preferences</p><h2>Appearance</h2><p>Choose your workspace colours.</p></div>${icon('spark')}</div><div class="appearance-grid">${[['light','Light','Warm white surfaces'],['dark','Dark','Low-light workspace'],['device','System','Use device settings']].map(([value,label,description])=>`<button class="theme-card theme-${value}" data-experience="theme" data-value="${value}" aria-pressed="${theme===value}"><span class="theme-mini" aria-hidden="true"><i></i><i></i><i></i></span><strong>${label}</strong><small>${description}</small></button>`).join('')}</div><div class="accent-picker"><span>Accent colour</span>${[['mint','Forest green'],['ice','Blue'],['violet','Plum']].map(([value,label])=>`<button class="accent-swatch accent-${value}" data-experience="accent" data-value="${value}" aria-label="${label}" aria-pressed="${accent===value}"><span></span></button>`).join('')}</div></section>`;
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
 const workspace=$('.workspace-name');if(workspace)workspace.innerHTML=`<span class="breadcrumb-dot"></span>Workspace <span>/</span> ${esc(({overview:'Overview',marketplace:'Marketplace',escrows:'Agreements',analytics:'Analytics',wallet:'Wallet',activity:'Activity',settings:'Settings',inbox:'Inbox',lab:'Attack lab',verify:'Verification',ledger:'Ledger',help:'Getting started'})[page]||'Overview')}`;
 if(page==='overview')enhanceOverview();
 if(page==='analytics'||page==='overview')mountCharts();
 if(runtime.showcase){const exit=$('[data-action="logout"]');if(exit){exit.setAttribute('aria-label','Exit demo');exit.title='Exit demo';}const footer=$('.workspace-footer');if(footer)footer.innerHTML='<span>Interactive sample · No saved changes or real payments</span><a href="/?signup=1">Create your own workspace '+icon('arrow')+'</a>';}
 if(page==='settings'&&!$('.appearance-studio'))$('.two-col')?.insertAdjacentHTML('beforebegin',appearanceCard());
 if(page==='help')$('.page-head')?.insertAdjacentHTML('beforeend',`<button class="secondary" data-experience="tour">${icon('circle')}Take a guided tour</button>`);

 if(page==='escrows'&&id)$('.instrument')?.classList.add('evidence-instrument');
 document.querySelectorAll('#main>.card,#main>.two-col,#main>.stats,.balance-grid,.analytics-widget,.overview-grid').forEach(element=>element.classList.add('reveal-in'));
 if(tourHighlight?.page===page)focusTourTarget();
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const art of document.querySelectorAll('.hero-art,.poster-art')){
  art.addEventListener('pointermove',event=>{const bounds=art.getBoundingClientRect();art.style.transform=`perspective(1000px) rotateY(${(event.clientX-bounds.left)/bounds.width*2-1}deg) rotateX(${1-(event.clientY-bounds.top)/bounds.height*2}deg)`;});art.addEventListener('pointerleave',()=>art.style.transform='');
 }
}
function mountProductLanding(){
 const login=$('.login');
 if(!login)return;
 login.classList.add('landing-access');
 $('.login-story',login).remove();
 login.id='account-access';
 login.setAttribute('role','region');
 login.setAttribute('aria-label','Account access');
 const stages=[
  ['Agree','A brief worth signing.','Choose the scope, payment and deadline. Both people sign the same terms.'],
  ['Deliver','The work arrives protected.','The seller sends the file. The buyer sees a watermarked preview and a signed receipt.'],
  ['Settle','The original is ready.','The buyer approves the work and finishes payment. The original file becomes available.'],
 ];
 login.insertAdjacentHTML('beforebegin',`<main id="main" class="product-landing motion-site" tabindex="-1">
 <header class="product-nav"><a class="logo" href="/" aria-label="PQ-Escrow home">${brand()}</a><div>
 <button class="product-nav-link" data-product-story>How it works</button><a href="/?demo=1#overview">Explore workspace</a>
 <button class="secondary" data-product-access>Sign in</button><a class="button" href="/?signup=1">Get started ${icon('arrow')}</a></div></header>
 <section class="motion-hero">
 <div class="motion-hero-copy" data-enter><p class="eyebrow">PQ-Escrow / Work marketplace</p>
 <h1>From the first brief<br>to the <span>final file.</span></h1>
 <p>Find the right person, agree on the work, and make a protected handover. Every step stays with your project.</p>
 <div class="product-actions"><a class="button" href="/?signup=1">Start a project ${icon('arrow')}</a><a class="button secondary" href="/?demo=1#overview">Explore the workspace</a></div>
 <p class="motion-disclaimer">Test ETH payments · No real money moves</p></div>
 <div class="hero-workspace" data-enter aria-label="Interactive sample project">
 <div class="demo-topbar"><span class="demo-window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Project workspace</span><span class="demo-label">Example</span></div>
 <div class="demo-project"><div><p>Python / Data analysis</p><h2>Quarterly research report</h2></div><span class="demo-status" data-demo-status>Terms agreed</span></div>
 <div class="demo-progress" aria-label="Sample project stage">${stages.map(([label],i)=>`<button type="button" data-demo-step="${i}" aria-pressed="${i===0}"><span>${icon(i===0?'check':'circle')}</span>${label}</button>`).join('')}</div>
 <div class="demo-main"><div class="demo-file"><div class="demo-file-mark">${icon('file')}<span>PDF</span></div>
 <div><strong>research-report.pdf</strong><p data-demo-file>Awaiting delivery</p></div><span class="demo-file-lock" data-demo-lock>${icon('lock')}</span></div>
 <div class="demo-preview" data-demo-preview aria-hidden="true"><div class="preview-sheet"><span>QUARTERLY RESEARCH</span><strong>From data<br>to decisions.</strong><div class="preview-bars"><i></i><i></i><i></i><i></i><i></i><i></i></div><small>Watermarked sample</small></div></div>
 <div class="demo-payment"><span>Agreed payment<strong>1.00 <small>test ETH</small></strong></span><span data-demo-payment>Awaiting review</span></div></div>
 <div class="demo-footer"><span data-demo-note>Both people have signed the terms.</span><button class="ghost" data-demo-next>See delivery ${icon('arrow')}</button></div>
 </div>
 </section>
 <div class="product-capabilities" data-enter><span>${icon('peer')}Private project conversations</span><span>${icon('shield')}Signed delivery receipts</span><span>${icon('lock')}Protected originals</span></div>
 <section class="handover-section" id="product-story" aria-label="How the handover works">
 <div class="handover-sticky">
 <div class="handover-heading"><p class="eyebrow">A project, step by step</p><h2>Follow the<br><span>handover.</span></h2><p>Scroll to see how a file moves from a signed agreement to a completed project.</p>
 <div class="handover-tabs" aria-label="Handover chapters">${stages.map(([label],i)=>`<button data-story-step="${i}" aria-pressed="${i===0}">${label}</button>`).join('')}</div>
 <div class="handover-copy" aria-live="polite"><h3 data-story-title>${stages[0][1]}</h3><p data-story-copy>${stages[0][2]}</p></div></div>
 <div class="handover-stage" data-story-stage="0" aria-label="Illustrated handover">
 <div class="handover-grid" aria-hidden="true"></div>
 <div class="file-assembly">
 <div class="assembly-layer assembly-terms"><small>SIGNED AGREEMENT</small><h3>Research report</h3><dl><div><dt>Scope</dt><dd>Report & source files</dd></div><div><dt>Payment</dt><dd>1 test ETH</dd></div></dl><span>${icon('check')} Client & freelancer signed</span></div>
 <div class="assembly-layer assembly-file"><span class="assembly-file-icon">${icon('file')}</span><div><small>DELIVERY</small><h3>research-report.pdf</h3></div><div class="assembly-watermark">PREVIEW</div></div>
 <div class="assembly-layer assembly-receipt"><span>${icon('shield')} Signed delivery receipt</span><code>SHA-256 · 94b3…0f2a</code></div>
 <div class="assembly-unlocked">${icon('check')} Payment settled · Original unlocked</div>
 </div>
 <div class="handover-stage-caption"><span>Illustrated example · Test funds</span><span data-story-counter>01 / 03</span></div>
 </div>
 </div>
 </section>
 <section class="project-fields" data-enter><div><p class="eyebrow">Bring your next brief</p><h2>Find a specialist<br>for the work.</h2></div><div class="project-fields-list">
 ${[['Python & Java','Scripts, applications and development.'],['Images & design','Illustrations, assets and visual work.'],['Science & research','Analysis, reports and research support.']].map(([title,description])=>`<a href="/?signup=1"><span><strong>${title}</strong><small>${description}</small></span>${icon('arrowUp')}</a>`).join('')}</div></section>
 <section class="product-closing" data-enter><p class="eyebrow">Start with the details</p><h2>What are you<br>working on next?</h2><a class="button" href="/?signup=1">Post a request ${icon('arrow')}</a></section>
 <footer class="product-next"><div><strong>PQ / Escrow</strong><p>Agreements, deliveries and payment records.</p></div><a href="/?demo=1#overview">Explore the sample workspace ${icon('arrow')}</a></footer>
 </main>`);
 mountProductMotion(stages);

}

const productMotion={root:null,observer:null,frame:0,stages:[],step:0,heroStep:0,reduce:false};

function stopProductMotion(){
 productMotion.observer?.disconnect();
 cancelAnimationFrame(productMotion.frame);
 productMotion.frame=0;
 productMotion.root=null;
}

function mountProductMotion(stages){
 stopProductMotion();
 const root=$('.motion-site');
 if(!root)return;
 Object.assign(productMotion,{root,stages,step:-1,heroStep:0,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches});
 if(!productMotion.reduce&&'IntersectionObserver' in window){
  root.classList.add('motion-ready');
  productMotion.observer=new IntersectionObserver(entries=>{
   for(const entry of entries)if(entry.isIntersecting){
    entry.target.classList.add('entered');
    productMotion.observer.unobserve(entry.target);
   }
  },{threshold:.12});
  root.querySelectorAll('[data-enter]').forEach(element=>productMotion.observer.observe(element));
 }
 updateHandover(0);
 setSampleStage(0);
 queueHandoverMotion();
}

function updateHandover(step){
 const root=productMotion.root;
 if(!root||step===productMotion.step)return;
 productMotion.step=step;
 $('[data-story-title]',root).textContent=productMotion.stages[step][1];
 $('[data-story-copy]',root).textContent=productMotion.stages[step][2];
 $('[data-story-stage]',root).dataset.storyStage=step;
 $('[data-story-counter]',root).textContent='0'+(step+1)+' / 03';
 root.querySelectorAll('[data-story-step]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.storyStep)===step)));
}

function setSampleStage(step){
 const root=productMotion.root;
 if(!root)return;
 productMotion.heroStep=step;
 const workspace=$('.hero-workspace',root);
 workspace.dataset.stage=step;
 root.querySelectorAll('[data-demo-step]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.demoStep)===step)));
 $('[data-demo-status]',root).textContent=['Terms agreed','Ready for review','Project completed'][step];
 $('[data-demo-file]',root).textContent=['Awaiting delivery','Preview available · Original protected','Original file available'][step];
 $('[data-demo-payment]',root).textContent=['Awaiting delivery','Waiting for approval','Payment settled'][step];
 $('[data-demo-note]',root).textContent=['Both people have signed the terms.','Only a watermarked preview is visible.','The buyer can now download the original.'][step];
 $('[data-demo-next]',root).innerHTML=['See delivery','Finish example','Replay example'][step]+' '+icon(step===2?'refresh':'arrow');
 $('[data-demo-lock]',root).innerHTML=icon(step===2?'check':'lock');
}

function renderHandoverMotion(){
 productMotion.frame=0;
 const root=productMotion.root;
 if(!root?.isConnected||productMotion.reduce)return;
 const section=$('.handover-section',root),bounds=section.getBoundingClientRect();
 const progress=Math.max(0,Math.min(1,(76-bounds.top)/Math.max(1,bounds.height-innerHeight+76)));
 const stage=$('.file-assembly',root);
 stage.style.setProperty('--turn',(-18+progress*36)+'deg');
 stage.style.setProperty('--roll',(-6+progress*9)+'deg');
 stage.style.setProperty('--spread',(Math.sin(progress*Math.PI)*68)+'px');
 updateHandover(progress<.34?0:progress<.72?1:2);
}

function queueHandoverMotion(){
 if(productMotion.root&&!productMotion.frame)productMotion.frame=requestAnimationFrame(renderHandoverMotion);
}
addEventListener('scroll',queueHandoverMotion,{passive:true});
addEventListener('resize',queueHandoverMotion);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{
 productMotion.reduce=event.matches;
 productMotion.root?.classList.toggle('motion-ready',!event.matches);
 if(event.matches)productMotion.root?.querySelector('.file-assembly')?.removeAttribute('style');
 else queueHandoverMotion();
});

document.addEventListener('pointermove',event=>{
 const workspace=event.target.closest('.hero-workspace');
 if(!workspace||productMotion.reduce||event.pointerType==='touch')return;
 const bounds=workspace.getBoundingClientRect();
 workspace.style.setProperty('--tilt-x',((.5-(event.clientY-bounds.top)/bounds.height)*5)+'deg');
 workspace.style.setProperty('--tilt-y',(((event.clientX-bounds.left)/bounds.width-.5)*6)+'deg');
});
document.addEventListener('pointerout',event=>{
 const workspace=event.target.closest('.hero-workspace');
 if(workspace&&!workspace.contains(event.relatedTarget)){
  workspace.style.removeProperty('--tilt-x');
  workspace.style.removeProperty('--tilt-y');
 }
});
document.addEventListener('click',event=>{
 const demo=event.target.closest('[data-demo-step],[data-demo-next]');
 if(demo){setSampleStage(demo.dataset.demoStep===undefined?(productMotion.heroStep+1)%3:Number(demo.dataset.demoStep));return;}
 const chapter=event.target.closest('[data-story-step]');
 if(chapter){
  const step=Number(chapter.dataset.storyStep);
  updateHandover(step);
  if(!productMotion.reduce){
   const section=$('.handover-section'),distance=section.offsetHeight-innerHeight+76;
   window.scrollTo({top:scrollY+section.getBoundingClientRect().top-76+distance*[0,.5,.98][step],behavior:'smooth'});
  }
 }
});

const experienceAuth=authPage,experienceRender=render;
authPage=function(){
 const wasLanding=Boolean($('.product-landing'));
 experienceAuth();
 if(runtime.hosted&&!new URLSearchParams(location.search).has('signup')&&!location.hash.replace(/^#(overview)?$/,'')){
  mountProductLanding();
  if(!wasLanding){
   $('#username')?.blur();
   requestAnimationFrame(()=>scrollTo(0,0));
  }
 }else enhanceAuthExperience();
};
render=async function(options){chartObserver?.disconnect();const version=renderVersion+1;await experienceRender(options);if(me&&version===renderVersion){stopProductMotion();enhanceExperience();}};

document.addEventListener('click',event=>{
 const access=event.target.closest('[data-product-access]');
 const story=event.target.closest('[data-product-story]');
 const behavior=matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
 if(access){
  $('#account-access')?.scrollIntoView({behavior});
  $('#username')?.focus({preventScroll:true});
  return;
 }
 if(story){
  $('#product-story')?.scrollIntoView({behavior});
  return;
 }
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
