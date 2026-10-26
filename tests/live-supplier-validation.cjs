// Explicit read-only model smoke test against the saved live Serper evidence.
// Uses model credits, never creates suppliers/inquiries or sends email.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');require('@next/env').loadEnvConfig(root);
const load=require('./helpers/load-ts.cjs')(),policy=load('@/lib/ai/supplier-policy');
const {getAIProvider,getAgentSystemPrompt}=load('@/lib/ai/provider');
const {supplierDiscoveryOutputSchema}=load('@/lib/ai/agent-schemas');
const {exactModelResults}=load('@/lib/ai/research/model-evidence');
(async()=>{
 const evidence=JSON.parse(fs.readFileSync(path.join(root,'test-results','stage6-live-search.json'),'utf8'));
 const report=[];
 for(const sample of evidence.report){
   const id=randomUUID(),rows=sample.evidence.filter(policy.isSupplierEvidenceSource);
   const response=await getAIProvider().generate([{role:'system',content:getAgentSystemPrompt('supplier_discovery')},{role:'user',content:JSON.stringify({
     target_product:{id,value:sample.item.product,brand:sample.item.brand,models:[sample.item.model]},
     research_results:rows.map(r=>({...r,structured_data:{...r.structured_data,arat_requirement_id:id}})),
     instructions:['Identify only real commercial suppliers/manufacturers for this product.','Reject marketplaces, support/documentation portals, third-party PDF mirrors and unrelated sites.','Only source URLs from research_results are allowed. Country requires published evidence, never a search query or locale.','Use requirementId exactly as target_product.id. Preserve missing facts as unknown. Exact product requires the explicit model in published evidence; do not invent stock or contacts.'],
   })}],supplierDiscoveryOutputSchema);
   const candidates=response.output.candidates.filter(c=>c.name&&rows.some(r=>r.source_url===c.sourceUrl));
   const unique=[],hosts=new Set();
   for(const candidate of candidates){
     const row=rows.find(r=>r.source_url===candidate.sourceUrl),host=policy.supplierHost(candidate.website||candidate.sourceUrl);
     if(!host||hosts.has(host))continue;hosts.add(host);
     unique.push({...candidate,exactModelSupported:exactModelResults([row],[sample.item.model],id).length>0});
   }
   assert.ok(unique.length>0,'No source-backed commercial candidate for '+sample.item.brand);
   report.push({item:sample.item,model:response.model,sourceBackedCandidateCount:unique.length,candidates:unique});
 }
 fs.writeFileSync(path.join(root,'test-results','stage6-live-validation.json'),JSON.stringify({testedAt:new Date().toISOString(),report},null,2));
 console.log(JSON.stringify(report.map(r=>({brand:r.item.brand,model:r.item.model,candidates:r.sourceBackedCandidateCount,companyNames:r.candidates.map(c=>c.name)})),null,2));
})().catch(error=>{console.error('Live supplier validation failed ('+(error.code??error.name)+'). No records were changed.');process.exitCode=1;});
