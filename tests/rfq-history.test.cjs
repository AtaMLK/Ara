const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const createLoader=require('./helpers/load-ts.cjs');

test('RFQ cancellation and the legacy delete endpoint use one atomic history-preserving RPC',async()=>{
 const calls=[],paths=[],id=randomUUID(),userId=randomUUID(),inquiryId=randomUUID();let denied=false,rpcError=null;
 const load=createLoader({'@/lib/ai/guards':{requireAdmin:async()=>{if(denied)throw Error('Admin required');return {user:{id:userId}};}},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>({from(){throw Error('Direct table mutation is forbidden');},rpc:async(name,args)=>{calls.push({name,args});return {data:rpcError?null:{inquiry_id:inquiryId,already_cancelled:false},error:rpcError};}})},'next/cache':{revalidatePath:p=>paths.push(p)}});
 const actions=load('@/app/rfqs/actions');
 await actions.cancelRfqAction(id,'  Supplier scope changed  ');
 assert.deepEqual(calls[0],{name:'cancel_rfq_preserving_history',args:{p_rfq_id:id,p_actor_id:userId,p_reason:'Supplier scope changed'}});
 assert.deepEqual(paths,['/rfqs','/inquiries/'+inquiryId]);
 await actions.deleteRfqAction(id);assert.equal(calls[1].name,'cancel_rfq_preserving_history');
 await assert.rejects(actions.cancelRfqAction(id,' '));assert.equal(calls.length,2);
 await assert.rejects(actions.cancelRfqAction('bad-id','Valid reason'));assert.equal(calls.length,2);
 denied=true;await assert.rejects(actions.cancelRfqAction(id,'Valid reason'),/Admin required/);assert.equal(calls.length,2);
 denied=false;rpcError={message:'RFQ delivery needs checking'};
 await assert.rejects(actions.cancelRfqAction(id,'Valid reason'),/delivery needs checking/);
 assert.equal(paths.length,4,'Failed cancellation must not report successful invalidation');
});
