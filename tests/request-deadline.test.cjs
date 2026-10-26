const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./helpers/load-ts.cjs')();
const {withRequestDeadline}=load('@/lib/ai/request-deadline');

test('request deadline aborts a stalled response body and reports a retryable timeout',async()=>{
 let signal;
 await assert.rejects(withRequestDeadline('Test provider',10,async s=>{
   signal=s;
   // Headers have arrived, but consuming the body never finishes.
   const response={json:()=>new Promise(()=>{})};
   return response.json();
 }),error=>error.code==='TRANSIENT'&&/timed out/.test(error.message));
 assert.equal(signal.aborted,true);
 assert.equal(await withRequestDeadline('Healthy provider',1000,async()=>42),42);
 await assert.rejects(withRequestDeadline('Failed provider',1000,async()=>{throw Error('Network unavailable');}),/Network unavailable/);
});

test('AI and Serper requests use a deadline signal including body reads',async()=>{
 const originalFetch=global.fetch,originalTimer=global.setTimeout;
 const oldAI=process.env.OPENAI_API_KEY,oldSerper=process.env.SERPER_API_KEY;
 process.env.OPENAI_API_KEY='test';process.env.SERPER_API_KEY='test';
 const signals=[],deadlines=[];
 global.setTimeout=(callback,ms,...args)=>{
   if(ms===120000||ms===30000){deadlines.push(ms);ms=10;}
   return originalTimer(callback,ms,...args);
 };
 global.fetch=async(url,options)=>{signals.push(options.signal);return {ok:true,json:()=>new Promise(()=>{})};};
 try{
   const {z}=require('zod');
   await assert.rejects(load('@/lib/ai/provider').getAIProvider().generate([],z.object({ok:z.boolean()})),/AI provider timed out/);
   await assert.rejects(load('@/lib/ai/research/provider').getResearchProvider().search({inquiryId:'test',query:'sensor'}),/Serper search timed out/);
   assert.deepEqual(deadlines,[120000,30000]);assert.ok(signals.every(s=>s.aborted));
 }finally{
   global.fetch=originalFetch;global.setTimeout=originalTimer;
   if(oldAI===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldAI;
   if(oldSerper===undefined)delete process.env.SERPER_API_KEY;else process.env.SERPER_API_KEY=oldSerper;
 }
});
