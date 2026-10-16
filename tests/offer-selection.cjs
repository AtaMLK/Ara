// Exercise the actual transaction and API permissions using disposable records.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const db=require('./helpers/load-ts.cjs')()('@/lib/supabase/admin').createSupabaseAdminClient();
const id=randomUUID();let customer,inquiry,quote;
async function insert(table,value){const r=await db.from(table).insert(value).select().single();assert.ifError(r.error);return r.data;}
(async()=>{try{
 customer=await insert('customers',{customer_code:'QA-OFFER-'+id,name:'QA offer selection',company_name:'QA offer selection',customer_type:'company',email:'qa-offer@example.invalid',status:'active',country:'Turkey'});
 inquiry=await insert('inquiries',{customer_id:customer.id,reference:'AO-QA-'+id,title:'QA offer selection',status:'quoting'});
 quote=await insert('customer_quotes',{customer_id:customer.id,inquiry_id:inquiry.id,reference:inquiry.reference+'-Q1',currency:'EUR',status:'pending_approval'});
 const base={customer_quote_id:quote.id,quantity:2,description:'QA requested sensor',price_calculation:{source_ref:'intake:item:0'},price_status:'suggested'};
 const a=await insert('customer_quote_items',{...base,is_selected:true}),b=await insert('customer_quote_items',{...base,is_selected:false});
 const select=await db.rpc('select_customer_quote_offer',{p_item_id:b.id});assert.ifError(select.error);
 const rows=await db.from('customer_quote_items').select('id,is_selected').eq('customer_quote_id',quote.id);assert.ifError(rows.error);
 assert.equal(rows.data.find(row=>row.id===a.id).is_selected,false);assert.equal(rows.data.find(row=>row.id===b.id).is_selected,true);
 const q=await db.from('customer_quotes').select('status').eq('id',quote.id).single();assert.equal(q.data.status,'draft');
 await db.from('customer_quotes').update({status:'sent'}).eq('id',quote.id);
 const locked=await db.rpc('select_customer_quote_offer',{p_item_id:a.id});assert.match(locked.error?.message||'',/not editable/);
 const anon=require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const denied=await anon.rpc('select_customer_quote_offer',{p_item_id:a.id});assert.ok(denied.error,'Anonymous API must not execute selection transaction');
 console.log('Offer selection passed: atomic switch, approval reset, immutable sent quote and anonymous RPC denied.');
}finally{
 for(const [table,column,value] of [['customer_quote_items','customer_quote_id',quote?.id],['customer_quotes','id',quote?.id],['inquiries','id',inquiry?.id],['customers','id',customer?.id]])if(value){const r=await db.from(table).delete().eq(column,value);assert.ifError(r.error);}
}})().catch(e=>{console.error(e.message);process.exitCode=1;});
