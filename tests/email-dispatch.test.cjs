const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const createLoader=require('./helpers/load-ts.cjs');
function fixture(){
 const rows=[],alerts=[];let failInsert=false,failSave=false;
 const db={from(table){const filters=[];let op='read',value,one=false;
  const q={order(){return q;},limit(){return q;},in(k,values){filters.push(r=>values.includes(r[k]));return q;},like(k,value){filters.push(r=>r[k].startsWith(value.slice(0,-1)));return q;},insert(v){op='insert';value=v;return q;},update(v){op='update';value=v;return q;},select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},single(){one=true;return q;},maybeSingle(){one=true;return q;},then(resolve,reject){return Promise.resolve().then(()=>{
    const collection=table==='email_dispatches'?rows:alerts;
    if(op==='insert'){
      if(failInsert)return {error:{code:'08006'}};
      if(table==='email_dispatches'&&rows.some(r=>r.idempotency_key===value.idempotency_key))return {error:{code:'23505'}};
      const row={id:randomUUID(),...value};collection.push(row);return {data:structuredClone(row),error:null};
    }
    const matched=collection.filter(r=>filters.every(f=>f(r)));
    if(op==='update'){
      if(failSave&&value.status==='sent')return {data:null,error:{code:'08006'}};
      matched.forEach(r=>Object.assign(r,value));
    }
    return {data:one?structuredClone(matched[0]??null):structuredClone(matched),error:null};
  }).then(resolve,reject);}};return q;
 }};
 const load=createLoader({'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}});
 return {rows,alerts,load,db,send:load('@/lib/email/dispatch').dispatchEmailOnce,failInsert:()=>failInsert=true,failSave:()=>failSave=true};
}
const input={key:'rfq-test',hash:'a'.repeat(64),messageId:'<test@example.test>',subject:'RFQ test',recipients:['sales@example.test']};
const result={providerMessageId:'<accepted@example.test>',sentAt:'2026-10-26T08:00:00Z'};

test('concurrent dispatches reserve one SMTP attempt; completed retries return the stored result',async()=>{
 const f=fixture();let calls=0;
 const send=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return result;};
 const attempts=await Promise.allSettled([f.send(input,send),f.send(input,send)]);
 assert.equal(calls,1);assert.equal(f.rows.length,1);assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
 assert.deepEqual(await f.send(input,send),{...result,threadId:undefined});assert.equal(calls,1);
 await assert.rejects(f.send({...input,hash:'b'.repeat(64)},send),/different content/);assert.equal(calls,1);
});
test('SMTP uncertainty and post-send database failure both block replay',async()=>{
 for(const postSend of [false,true]){
   const f=fixture();let calls=0;if(postSend)f.failSave();
   const send=async()=>{calls++;if(!postSend)throw Error('Connection lost after DATA');return result;};
   await assert.rejects(f.send(input,send),/could not be confirmed/);
   assert.equal(f.rows[0].status,'delivery_uncertain');assert.equal(f.alerts.length,1);
   if(postSend)assert.equal(f.rows[0].provider_message_id,result.providerMessageId);
   await assert.rejects(f.send(input,send),/uncertain/);assert.equal(calls,1);
 }
});
test('reservation failure prevents SMTP, and abandoned sending claims stay blocked',async()=>{
 const f=fixture();f.failInsert();let calls=0;
 await assert.rejects(f.send(input,async()=>{calls++;return result;}),/No email was sent/);assert.equal(calls,0);
 const g=fixture();g.rows.push({id:'abandoned',idempotency_key:input.key,payload_hash:input.hash,status:'sending'});
 await assert.rejects(g.send(input,async()=>{calls++;return result;}),/sending or delivery is uncertain/);assert.equal(calls,0);
});
test('SMTP provider supplies durable keys, attachment hashes, message IDs and timeouts',async()=>{
 const f=fixture(),mails=[],options=[];let closes=0,rejectRecipients=false;
 const old={...process.env};Object.assign(process.env,{SMTP_HOST:'test',SMTP_USER:'test@example.test',SMTP_PASSWORD:'test'});
 const load=createLoader({'@/lib/supabase/admin':{createSupabaseAdminClient:()=>f.db},nodemailer:{createTransport:config=>{options.push(config);return {close(){closes++;},sendMail:async mail=>{mails.push(mail);return {messageId:mail.messageId,accepted:rejectRecipients?[]:mail.to,rejected:rejectRecipients?mail.to:[]};}}}}});
 try{
   const provider=load('@/lib/email/provider').getEmailProvider();
   const mail={from:'purchase@example.test',to:input.recipients,subject:'RFQ',html:'Hello',idempotencyKey:'provider-test',generatedAttachments:[{fileName:'a.pdf',mimeType:'application/pdf',content:new Uint8Array([1,2])}]};
   await provider.send(mail);await provider.send(mail);assert.equal(mails.length,1);
   await assert.rejects(provider.send({...mail,generatedAttachments:[{...mail.generatedAttachments[0],content:new Uint8Array([3])}]}),/different content/);
   assert.match(mails[0].messageId,/^<arat-/);assert.equal(options[0].socketTimeout,60000);assert.equal(closes,1);
   await assert.rejects(provider.send({...mail,idempotencyKey:undefined}),/stable email/);
   rejectRecipients=true;
   await assert.rejects(provider.send({...mail,idempotencyKey:'rejected-test'}),/could not be confirmed/);
   assert.equal(f.rows.find(r=>r.idempotency_key==='rejected-test').status,'delivery_uncertain');
 }finally{for(const k of ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD'])if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
});

test('Admin delivery panel shows unresolved recipients and message IDs, and checks auth before reading',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),f=fixture();let denied=false;
 f.rows.push({id:'one',idempotency_key:'rfq-one',subject:'RFQ awaiting check',recipients:['sales@example.test'],status:'delivery_uncertain',message_id:'<audit@example.test>'});
 f.rows.push({id:'two',idempotency_key:'customer-quote-two',subject:'Private customer quote',recipients:['customer@example.test'],status:'delivery_uncertain',message_id:'<other@example.test>'});
 const load=createLoader({'@/lib/supabase/admin':{createSupabaseAdminClient:()=>f.db},'@/lib/data/admin':{requireAdminPage:async()=>{if(denied)throw Error('Admin required');}},'@/components/language':{T:({children})=>React.createElement(React.Fragment,null,children)}});
 const panel=load('@/components/email-delivery-status.tsx').EmailDeliveryStatus;
 const html=renderToStaticMarkup(await panel({keyPrefix:'rfq-'}));
 assert.match(html,/Delivery uncertain/);assert.match(html,/sales@example.test/);assert.match(html,/audit@example.test/);assert.doesNotMatch(html,/Private customer quote/);
 denied=true;await assert.rejects(panel({}),/Admin required/);
});
