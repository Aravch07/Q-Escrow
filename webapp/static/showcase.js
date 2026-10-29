'use strict';
// Clearly labelled, read-only sample evidence; it never creates a server session.
let showcaseData=null;
const connectedAPI=api;
async function enableShowcase(){
 const response=await fetch('/assets/sample-workspace.json');if(!response.ok)throw Error('The sample workspace could not load. Please try again.');
 showcaseData=await response.json();if(showcaseData.format!=='PQE-showcase-v1')throw Error('Unsupported sample workspace');
 runtime={...runtime,hosted:false,preview:false,showcase:true,demo:true};
}
api=async function(route,data,options={}){
 if(!runtime.showcase)return connectedAPI(route,data,options);
 const clone=value=>structuredClone(value);
 if(route==='online'&&data){showcaseData.me.online=Boolean(data.online);return {online:showcaseData.me.online};}
 if(data!==undefined){const error=Error('This is a read-only sample. Create your own account to sign, deliver files and use test funds.');error.status=403;throw error;}
 if(route==='me')return clone(showcaseData.me);
 if(route==='wallet')return clone(showcaseData.wallet);
 if(route==='escrows')return {escrows:clone(showcaseData.escrows)};
 if(route==='audit')return clone(showcaseData.audit);
 if(route==='chain')return clone(showcaseData.chain);
 if(route==='users')return {users:clone(showcaseData.users)};
 const match=route.match(/^escrows\/([0-9a-f]{64})$/);if(match){const record=showcaseData.escrows.find(record=>record.escrow_id===match[1]);if(record)return clone(record);}
 if(route==='notifications')return {events:[],unread:0};
 throw Error('Create an account to use this feature with your own agreements.');
};
function createAccountPrompt(){
 let dialog=document.querySelector('#demo-account-dialog');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='demo-account-dialog';dialog.setAttribute('aria-labelledby','demo-account-title');dialog.innerHTML='<form method="dialog"><p class="eyebrow">Ready to make it yours?</p><h2 id="demo-account-title">Your next agreement starts here.</h2><p class="muted">You’re exploring sample data. Create a free account to sign agreements, upload deliveries and try the full workflow with 10 test ETH.</p><div class="actions"><button value="cancel" class="secondary">Keep exploring</button><a class="button" href="/?signup=1">Create account</a></div></form>';document.body.append(dialog);}
 dialog.showModal();
}
document.addEventListener('click',event=>{
 if(!runtime.showcase)return;
 const exit=event.target.closest('[data-action="logout"]');if(exit){event.preventDefault();event.stopImmediatePropagation();location.href='/';return;}
 const button=event.target.closest('[data-action]');
 if(button&&['cancel-agreement','claim','reconcile','release','refund','countersign','attack','lab-run-all','lab-time-preset'].includes(button.dataset.action)){
  event.preventDefault();event.stopImmediatePropagation();createAccountPrompt();return;
 }
 const link=event.target.closest('a[href]'),match=link?.getAttribute('href')?.match(/^\/api\/escrows\/([0-9a-f]{64})\/(bundle|download)$/);
 if(match){event.preventDefault();event.stopImmediatePropagation();const record=showcaseData.escrows.find(record=>record.escrow_id===match[1]);if(!record)return;
  if(match[2]==='bundle')saveBlob(new Blob([JSON.stringify(record.bundle,null,2)],{type:'application/json'}),record.escrow_id+'.json');
  else if(record.bundle.payload!==null){const binary=atob(record.bundle.payload),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));saveBlob(new Blob([bytes]),record.delivery.filename);}
 }
},true);
document.addEventListener('submit',event=>{
 if(!runtime.showcase)return;const id=event.target.id;
 if(id==='verify-file-form'||id==='create-form'&&createStep<3||id==='confirm-dialog')return;
 if(['create-form','delivery-form','deposit-form','withdraw-form','password-form','time-form','verify-bundle-form'].includes(id)){
  event.preventDefault();event.stopImmediatePropagation();createAccountPrompt();
 }
},true);
