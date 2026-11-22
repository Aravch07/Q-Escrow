'use strict';

const marketFilters={q:'',category:'',view:'open',sort:'newest',offset:0};
const marketViews={open:'Explore',mine:'My requests',offers:'My offers',saved:'Saved'};
const marketSorts={newest:'Newest first',budget:'Highest budget',active:'Most offers'};

function marketCategories(categories, selected='', all=false){
 return `<option value="">${all?'All categories':'Choose a category'}</option>`+
  Object.entries(categories).map(([value,label])=>`<option value="${esc(value)}" ${selected===value?'selected':''}>${esc(label)}</option>`).join('');
}

async function marketplacePage(id,seller){
 if(id){
  const data=await api('marketplace/'+encodeURIComponent(id));
  if(!seller)return marketplaceRequest(data);
  const thread=await api(marketThread(id,seller));
  return marketplaceConversation(data,seller,thread.messages);
 }
 const filters=new URLSearchParams(marketFilters);
 const {categories,category_counts:counts={},requests,next_offset}=await api('marketplace?'+filters);
 const openCount=Object.values(counts).reduce((total,count)=>total+count,0);
 return `<section class="market-hero card">
  <div><p class="eyebrow">Find a project</p><h1>Work board</h1>
  <p>Browse requests or post a brief for someone to work on.</p>
  <button data-market-compose>＋ Post a request</button></div>
  <dl class="market-metrics"><div><dt>Open requests</dt><dd>${openCount}</dd></div></dl>
  </section>
  <section class="card market-post" hidden><details id="market-post-details"><summary>Post a work request</summary>
  <form id="market-post" class="market-form"><p class="fine">Any signed-in member can see your open request. Keep files and private details inside the agreement.</p>
  <label for="market-title">Title</label><input id="market-title" name="title" maxlength="120" placeholder="e.g. Build a Python script to clean a CSV" required>
  <div class="form-grid"><div><label for="market-post-category">Category</label><select id="market-post-category" name="category" required>${marketCategories(categories)}</select></div>
  <div><label for="market-budget">Budget in test ETH</label><input id="market-budget" name="budget" inputmode="decimal" placeholder="1" required></div></div>
  <label for="market-description">What do you need?</label><textarea id="market-description" name="description" rows="4" maxlength="1200" required></textarea>
  <button type="submit">Publish request</button></form></details></section>
  <nav class="market-tabs" aria-label="Marketplace views">${Object.entries(marketViews).map(([key,label])=>`<button class="secondary" data-market-view="${key}" aria-pressed="${marketFilters.view===key}">${label}</button>`).join('')}</nav>
  ${marketFilters.view==='open'?`<section class="market-categories" aria-label="Browse work categories">${Object.entries(categories).map(([key,label])=>`<button class="secondary" data-market-category="${key}" aria-pressed="${marketFilters.category===key}"><strong>${esc(label)}</strong><small>${counts[key]||0} open</small></button>`).join('')}</section>`:''}
  <form class="card market-filters" id="market-search">
  <label for="market-query">Search requests<input id="market-query" name="q" type="search" maxlength="120" value="${esc(marketFilters.q)}" placeholder="Search by skill, work or username"></label>
  <label for="market-category">Category<select id="market-category" name="category">${marketCategories(categories,marketFilters.category,true)}</select></label>
  <div><label for="market-sort">Sort by</label><select id="market-sort" name="sort">${Object.entries(marketSorts).map(([key,label])=>`<option value="${key}" ${marketFilters.sort===key?'selected':''}>${label}</option>`).join('')}</select></div>
  <button class="secondary" type="submit">Apply filters</button></form>
  <section aria-label="Work requests" class="market-grid">${requests.map(item=>`<article class="card market-listing">
  <div class="market-meta"><span class="badge">${esc(categories[item.category])}</span><button class="ghost market-save" data-market-save="${item.id}" aria-pressed="${Boolean(item.saved)}" aria-label="${item.saved?'Remove saved request':'Save request'}">${item.saved?'★':'☆'}</button></div>
  <h2><a href="#marketplace/${item.id}">${esc(item.title)}</a></h2>
  <p class="market-snippet">${esc(item.description)}</p>
  <div class="market-meta"><span>@${esc(item.requester)} · ${esc(item.status)}</span><strong>Up to ${eth(item.budget_wei)} test ETH</strong></div>
  <p class="fine">${item.offer_count||0} ${item.offer_count===1?'offer':'offers'}${item.offered?' · You sent an offer':''}</p>
  <a class="text-link" href="#marketplace/${item.id}">View request ${icon('arrow')}</a></article>`).join('')||
  '<div class="card market-listing"><h2>No requests here yet</h2><p>Try another filter or post the first brief.</p></div>'}</section>
  <div class="actions market-pages">${marketFilters.offset?'<button class="secondary" data-market-page="'+Math.max(0,marketFilters.offset-24)+'">Previous</button>':''}
  ${next_offset!==null?'<button class="secondary" data-market-page="'+next_offset+'">Next</button>':''}</div>`;
}

function marketplaceRequest({request:item,offers,categories}){
 const owner=item.requester===me.identity.name,open=item.status==='open';
 const lowest=offers.reduce((best,offer)=>best===null||BigInt(offer.amount_wei)<BigInt(best)?offer.amount_wei:best,null);
 const fastest=offers.reduce((best,offer)=>Math.min(best,offer.hours),Infinity);
 const offerForm=!owner&&open&&!offers.length?`<form class="market-form" id="market-offer" data-id="${item.id}">
  <p class="fine">Only you and the requester can see your offer. Agree on what the preview should show before you deliver.</p>
  <div class="form-grid"><div><label for="offer-price">Price in test ETH</label><input id="offer-price" name="price" inputmode="decimal" required></div>
  <div><label for="offer-hours">Hours for delivery and review</label><input id="offer-hours" name="hours" type="number" min="1" max="168" value="48" required></div></div>
  <label for="offer-note">What will you deliver?</label><textarea id="offer-note" name="note" rows="3" maxlength="500" required></textarea>
  <button type="submit">Send offer</button></form>`:'';
 return `<a class="back-link" href="#marketplace">← Marketplace</a>`+
  head(esc(categories[item.category]),esc(item.title),`Requested by @${esc(item.requester)} · ${esc(stamp(item.created_at))}`,`<span class="badge">${esc(item.status)}</span>`)+
  `<div class="market-detail"><section class="card market-listing"><p class="eyebrow">The brief</p><h2>Work requested</h2>
  <p class="market-brief">${esc(item.description)}</p><p><strong>Up to ${eth(item.budget_wei)} test ETH</strong></p>
  ${item.escrow_id?`<a class="button" href="#escrows/${item.escrow_id}">Open signed agreement ${icon('arrow')}</a>`:''}
  ${owner&&open?`<button class="secondary" data-market-close="${item.id}">Close request</button>`:''}</section>
  <section class="card market-listing"><p class="eyebrow">Next step</p><h2>${owner?'Offers received':offerForm?'Make an offer':'Your offer'}</h2>
  ${offerForm||offers.map(offer=>`<article class="market-offer">
   <div class="market-meta"><strong>@${esc(offer.seller)}</strong><span>${eth(offer.amount_wei)} test ETH · ${offer.hours} hours</span></div>
   ${owner&&offers.length>1?`<p class="market-offer-tags">${offer.amount_wei===lowest?'<span class="badge">Lowest price</span>':''}${offer.hours===fastest?'<span class="badge">Fastest deadline</span>':''}</p>`:''}
   <p class="market-brief">${esc(offer.note)}</p>
   <a class="button secondary" href="#marketplace/${item.id}/${esc(offer.seller)}">Messages</a>
   ${owner&&open?`<button data-market-accept="${item.id}" data-seller="${esc(offer.seller)}" data-amount="${offer.amount_wei}" data-hours="${offer.hours}">Accept offer and sign</button>`:''}
   </article>`).join('')||'<p class="fine">No offers to show yet.</p>'}</section></div>`;
}

function marketThread(id,seller){
 return 'marketplace/'+encodeURIComponent(id)+'/messages?'+new URLSearchParams({seller});
}

function marketplaceConversation({request:item,offers},seller,messages){
 const offer=offers.find(offer=>offer.seller===seller);
 const viewer=me.identity.name;
 if(!offer)throw Error('Conversation not found');
 const peer=viewer===seller?item.requester:seller;
 const writable=item.status==='open'||(item.status==='matched'&&item.seller===seller);
 return `<a class="back-link" href="#marketplace/${item.id}">← Back to request</a>`+
  head('Private conversation',esc(item.title),'With @'+esc(peer))+
  `<section class="card market-chat" aria-label="Messages">
  <ol class="market-messages">${messages.map(message=>`<li class="${message.sender===viewer?'own':''}">
  <header><strong>@${esc(message.sender)}</strong><time>${esc(stamp(message.created_at))}</time></header>
  <p>${esc(message.message)}</p></li>`).join('')||'<li>Ask a question or confirm what will be delivered.</li>'}</ol>
  ${writable?`<form class="market-form" id="market-message" data-id="${item.id}" data-seller="${esc(seller)}">
  <label for="market-message-text">Message</label><textarea id="market-message-text" name="message" maxlength="1600" rows="3" required></textarea>
  <button type="submit">Send message</button></form>`:'<p class="fine">This conversation is read-only.</p>'}</section>`;
}

document.addEventListener('submit',async event=>{
 const form=event.target;
 if(!['market-search','market-post','market-offer','market-message'].includes(form.id))return;
 event.preventDefault();
 const data=new FormData(form),button=form.querySelector('button[type="submit"]'),path=location.hash;
 button.disabled=true;
 try{
  if(form.id==='market-search'){
   Object.assign(marketFilters,{q:data.get('q').trim(),category:data.get('category'),sort:data.get('sort'),offset:0});
   await render({background:true});
  }else if(form.id==='market-post'){
   const result=await api('marketplace',{title:data.get('title'),category:data.get('category'),description:data.get('description'),budget_wei:wei(data.get('budget').trim())});
   if(location.hash===path)location.hash='marketplace/'+result.id;
   toast('Work request published.');
  }else if(form.id==='market-message'){
   await api(marketThread(form.dataset.id,form.dataset.seller),{message:data.get('message')});
   if(location.hash===path)await render();
  }else{
   await api(`marketplace/${form.dataset.id}/offer`,{amount_wei:wei(data.get('price').trim()),hours:Number(data.get('hours')),note:data.get('note')});
   if(location.hash===path)await render();
   toast('Offer sent privately to the requester.');
  }
 }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});

document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-market-page],[data-market-close],[data-market-accept],[data-preview],[data-market-view],[data-market-category],[data-market-save],[data-market-compose]');
 if(!button)return;
 const {marketPage,marketClose,marketAccept,marketView,marketCategory,marketSave,marketCompose,seller,amount,hours,preview}=button.dataset;
 const path=location.hash;
 button.disabled=true;
 try{
  if(marketCompose!==undefined){
   $('.market-post').hidden=false;
   $('#market-post-details').open=true;
   $('#market-title').focus();
  }else if(marketView||marketCategory){
   if(marketView)Object.assign(marketFilters,{view:marketView,category:'',q:''});
   else marketFilters.category=marketFilters.category===marketCategory?'':marketCategory;
   marketFilters.offset=0;
   await render({background:true});
  }else if(marketSave){
   const saved=button.getAttribute('aria-pressed')!=='true';
   await api(`marketplace/${marketSave}/save`,{saved});
   if(location.hash===path)await render({background:true});
   toast(saved?'Request saved.':'Request removed from Saved.');
  }else if(preview){
   const panel=$('#delivery-preview');
   if(!panel.hidden){panel.hidden=true;button.setAttribute('aria-expanded','false');button.textContent='Show watermarked preview';return;}
   if(!panel.childElementCount){
    const {pages}=await api(`escrows/${preview}/preview`);
    if(!panel.isConnected)return;
    panel.innerHTML=`<p class="fine">Watermarked sample · The original remains locked.</p>
     <div class="preview-pages">${pages.map(page=>`<figure><img alt="${esc(page.label)} watermarked preview" src="${esc(page.src)}"><figcaption>${esc(page.label)}</figcaption></figure>`).join('')}</div>`;
   }
   panel.hidden=false;button.setAttribute('aria-expanded','true');button.textContent='Hide watermarked preview';
  }else if(marketPage!==undefined){
   marketFilters.offset=Number(marketPage);
   await render({background:true});
  }else if(marketClose){
   if(!await confirmSign('Close this request?','Members will no longer be able to send offers.','Close request'))return;
   await api(`marketplace/${marketClose}/close`,{});
   if(location.hash===path)await render();
   toast('Work request closed.');
  }else{
   if(!await confirmSign('Accept and sign the buyer’s terms?',`Pay @${seller} ${eth(amount)} test ETH for this request and their offer, with ${hours} hours for delivery and review. Funds are checked at settlement.`))return;
   const result=await api(`marketplace/${marketAccept}/accept`,{seller});
   if(location.hash===path)location.hash='escrows/'+result.escrow_id;
   toast('Signed agreement sent to the seller.');
  }
 }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
