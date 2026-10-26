// Explicit live search smoke test. Uses Serper credits; no database writes or email.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');require('@next/env').loadEnvConfig(root);
const load=require('./helpers/load-ts.cjs')(),policy=load('@/lib/ai/supplier-policy');
const provider=load('@/lib/ai/research/provider').getResearchProvider();
const {enrichSupplierLocations}=load('@/lib/ai/supplier-location');
const {readSupplierHtml}=load('@/lib/ai/supplier-page');
const samples=[{id:'siemens',brand:'Siemens',model:'6ES7214-1AG40-0XB0',product:'PLC CPU'},
 {id:'omron',brand:'Omron',model:'E2E-X5ME1',product:'Inductive proximity sensor'},
 {id:'schneider',brand:'Schneider Electric',model:'LC1D09M7',product:'Contactor'}];
(async()=>{
 if(!provider)throw Error('SERPER_API_KEY is not configured');
 const report=[];
 for(const item of samples){
   const queries=[item.brand+' '+item.model+' supplier Turkey',item.brand+' '+item.model+' Türkiye tedarikçi'];
   const rows=[];
   for(const query of queries){const results=await provider.search({inquiryId:'read-only-smoke',query,country:'Turkey',limit:8});
     rows.push(...results.map(r=>({source_url:r.sourceUrl,source_name:r.sourceName,finding:r.finding,structured_data:{...r.structuredData,arat_requirement_id:item.id}})));
   }
   assert.ok(rows.length>0,'No live results for '+item.brand+' '+item.model);
   const located=await enrichSupplierLocations(rows,async url=>(await readSupplierHtml(url)).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' '));
   const first=policy.supplierEvidenceBatch(located,[]),reviewed={[item.id]:first.map(r=>policy.supplierHost(r.source_url))};
   const next=policy.supplierEvidenceBatch(located,[],{[item.id]:10},reviewed);
   assert.ok(new Set(first.map(r=>policy.supplierHost(r.source_url))).size<=5);
   assert.ok(next.every(r=>!reviewed[item.id].includes(policy.supplierHost(r.source_url))));
   report.push({item,queries,resultCount:rows.length,companyDomains:[...new Set(located.filter(policy.isSupplierEvidenceSource).map(r=>policy.supplierHost(r.source_url)))],firstPage:first.map(r=>({url:r.source_url,countryEvidence:policy.supplierCountryEvidence(r)})),nextPageDomains:[...new Set(next.map(r=>policy.supplierHost(r.source_url)))],evidence:located});
 }
 const file=path.join(root,'test-results','stage6-live-search.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({testedAt:new Date().toISOString(),report},null,2));
 console.log(JSON.stringify(report.map(r=>({brand:r.item.brand,model:r.item.model,results:r.resultCount,domains:r.companyDomains.length,firstPageDomains:[...new Set(r.firstPage.map(x=>policy.supplierHost(x.url)))],nextPageDomains:r.nextPageDomains})),null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
