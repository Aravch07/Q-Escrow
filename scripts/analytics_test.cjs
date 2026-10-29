const assert=require('node:assert/strict');
const {summarize}=require('../webapp/static/analytics.js');
const now=1800000000,E=10n**18n;
function record(id,role,value,state,settlement=null){return {escrow_id:id,role,state,settlement,terms:{amount_wei:String(value),created_at:now-86400,expires_at:now+3600}};}
const paid=record('paid','buyer',125n*E/100n,'SETTLED',{release:true,settled_at:now-100});
const refund=record('refund','buyer',E,'SETTLED',{release:false,settled_at:now-100});
const pending=record('pending','buyer',3n*E,'LOCKED');
const selling=record('selling','seller',E/2n,'DELIVERED');
const rows=[paid,refund,pending,selling,paid],events=[{at:now-100,escrow_id:'paid'},{at:now-100,escrow_id:null}];
const all=summarize(rows,events,{account:{balance:String(E)}},now,7);
assert.equal(all.total,4);assert.equal(all.releasedWei,125n*E/100n);assert.equal(all.refundedWei,E);
assert.equal(all.openBuyingWei,3n*E);assert.equal(all.openSellingWei,E/2n);assert.equal(all.shortfall,2n*E);assert.equal(all.coverage,33);
assert.equal(all.completion,50);assert.equal(all.periodActions,2);assert.equal(all.periodReleasedWei,125n*E/100n);
assert.deepEqual(all.states,{pending:1,checking:1,settled:1,refunded:1,review:0});
const buyer=summarize(rows,events,null,now,30,'buyer');assert.equal(buyer.total,3);assert.equal(buyer.periodActions,1);
const empty=summarize([],[],null,now,90);assert.equal(empty.total,0);assert.equal(empty.coverage,100);assert.equal(empty.buckets.length,90);assert.ok(empty.buckets.every(bucket=>bucket.actions===0&&bucket.releasedWei===0n));
const huge=summarize([record('large','buyer',2n**200n,'LOCKED')],[],null,now);assert.equal(huge.openBuyingWei,2n**200n);
assert.throws(()=>summarize([],[],null,now,1));
console.log('Analytics checked: exact money totals, refunds, roles, periods, empty states, duplicate records and large amounts.');
