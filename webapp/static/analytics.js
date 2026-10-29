'use strict';
// Counts and money totals come from records; charts never synthesize performance.
const WorkspaceAnalytics=(()=>{
 const toWei=value=>{try{return BigInt(value||0);}catch{return 0n;}};
 function stateOf(record){if(record.rejection)return 'review';if(record.settlement)return record.settlement.release?'settled':'refunded';if(['DELIVERED','ACCEPTED'].includes(record.state))return 'checking';return 'pending';}
 function summarize(records,entries,wallet,now,days=7,role='all'){
  if(![7,30,90].includes(days))throw Error('Unsupported analytics period');
  const unique=Array.from(new Map(records.map(record=>[record.escrow_id,record])).values()).filter(record=>role==='all'||record.role===role);
  const ids=new Set(unique.map(record=>record.escrow_id));
  const buckets=[];const today=new Date(now*1000);today.setHours(0,0,0,0);
  for(let i=days-1;i>=0;i--){const start=new Date(today);start.setDate(start.getDate()-i);const end=new Date(start);end.setDate(end.getDate()+1);buckets.push({at:Math.floor(start.getTime()/1000),end:Math.floor(end.getTime()/1000),actions:0,created:0,releasedWei:0n,agreementWei:0n});}
  const states={pending:0,checking:0,settled:0,refunded:0,review:0};let releasedWei=0n,openBuyingWei=0n,openSellingWei=0n,refundedWei=0n;
  for(const record of unique){
   const state=stateOf(record),value=toWei(record.terms.amount_wei);states[state]++;
   const created=buckets.find(bucket=>record.terms.created_at>=bucket.at&&record.terms.created_at<bucket.end);if(created){created.created++;created.agreementWei+=value;}
   if(record.settlement){
    if(record.settlement.release){releasedWei+=value;const settled=buckets.find(bucket=>record.settlement.settled_at>=bucket.at&&record.settlement.settled_at<bucket.end);if(settled)settled.releasedWei+=value;}
    else refundedWei+=value;
   }else if(!record.rejection){if(record.role==='buyer')openBuyingWei+=value;else openSellingWei+=value;}
  }
  for(const entry of entries){if(role!=='all'&&!ids.has(entry.escrow_id))continue;const bucket=buckets.find(bucket=>entry.at>=bucket.at&&entry.at<bucket.end);if(bucket)bucket.actions++;}
  const balance=toWei(wallet?.account?.balance),shortfall=openBuyingWei>balance?openBuyingWei-balance:0n;
  return {records:unique,buckets,states,total:unique.length,releasedWei,refundedWei,openBuyingWei,openSellingWei,balance,shortfall,
   coverage:openBuyingWei===0n?100:Number((balance*100n/openBuyingWei)>100n?100n:balance*100n/openBuyingWei),
   completion:unique.length?Math.round((states.settled+states.refunded)/unique.length*100):0,
   dueSoon:unique.filter(record=>!record.settlement&&!record.rejection&&record.terms.expires_at>now&&record.terms.expires_at-now<86400).length,
   periodActions:buckets.reduce((sum,bucket)=>sum+bucket.actions,0),periodReleasedWei:buckets.reduce((sum,bucket)=>sum+bucket.releasedWei,0n)};
 }
 return {summarize,stateOf};
})();
if(typeof module!=='undefined')module.exports=WorkspaceAnalytics;
