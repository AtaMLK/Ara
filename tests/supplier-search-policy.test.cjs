const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-ts.cjs')(),policy=load('@/lib/ai/supplier-policy');
const row=(host,finding='',data={})=>({source_url:'https://'+host+'/products',finding,structured_data:{arat_requirement_id:'one',...data}});
test('published Turkish .com address is prioritized without treating search locale or shipping destinations as country',()=>{
 const local=row('integralel.com','Office: Karaköy, İstanbul / Türkiye');
 assert.equal(policy.supplierEvidencePriority(local),1);
 assert.equal(policy.supplierCountryEvidence(local).country,'Turkey');
 assert.equal(policy.supplierEvidencePriority(row('local.com','Manufacturer based in Turkey')),1);
 assert.equal(policy.supplierEvidencePriority(row('international.com','Ships worldwide, including Turkey')),2);
 assert.equal(policy.supplierCountryEvidence(row('unknown.com','Contact +90 212 123 4567')),null);
 assert.equal(policy.supplierEvidencePriority(row('foreign.com','İstanbul / Türkiye',{country:'Germany'})),2);
 assert.equal(policy.isTurkishCountry(' TÜRKİYE '),true);
 const foreign=Array.from({length:6},(_,i)=>row('foreign'+i+'.com','Manufacturer',{country:'Germany'}));
 assert.equal(policy.supplierEvidenceBatch([...foreign,local],[])[0],local);
});
test('irrelevant portals consume no company slots; backfill counts distinct supplier choices',()=>{
 const rows=[row('en.wikipedia.org'),row('example.gov.tr'),...Array.from({length:12},(_,i)=>row('supplier'+i+'.com'))];
 const first=policy.supplierEvidenceBatch(rows,[]);
 assert.equal(first.length,5);assert.equal(first[0].source_url,rows[2].source_url);
 const reviewed={one:first.map(r=>policy.supplierHost(r.source_url))};
 const candidates=[{requirement_id:'one',status:'finalized',supplier_id:'same-company',proposed_website:rows[2].source_url},{requirement_id:'one',status:'finalized',supplier_id:'same-company',proposed_website:rows[3].source_url}];
 const backfill=policy.supplierReviewBackfill(rows,candidates,{},reviewed);
 assert.equal(backfill.needed,true);assert.equal(backfill.limits.one,10);
 assert.equal(policy.supplierReviewBackfill(rows,candidates,{},reviewed,{one:1}).needed,false);
 const next=policy.supplierEvidenceBatch(rows,candidates,backfill.limits,reviewed);
 assert.equal(next.length,5);assert.ok(next.every(r=>!reviewed.one.includes(policy.supplierHost(r.source_url))));
 assert.equal(policy.uniqueSupplierCandidates(candidates).length,1);
 assert.equal(policy.supplierReviewBackfill(first,[],{},reviewed).needed,false,'Exhaustion must not fabricate choices or loop');
});
test('search metadata cannot establish an exact product or model prefix match',()=>{
 const {exactModelResults}=load('@/lib/ai/research/model-evidence');
 const generic={...row('supplier.com','Industrial catalog'),evidence:{query:'Alpha TS-100 supplier Turkey'}};
 assert.equal(exactModelResults([generic],['TS-100'],'one').length,0);
 assert.equal(exactModelResults([row('supplier.com','Alpha TS-1000')],['TS-100'],'one').length,0);
 assert.equal(exactModelResults([row('supplier.com','Alpha TS-100-M1')],['TS-100'],'one').length,0);
 assert.equal(exactModelResults([{...generic,source_name:'Alpha TS-100 official product'}],['TS-100'],'one').length,1);
 const {supplierSearchQueries}=load('@/lib/ai/research/queries');
 const queries=supplierSearchQueries({product:'PLC controller',brand:'Siemens',model:'6ES7214-1AG40-0XB0'});
 assert.ok(queries.some(q=>q.includes('Türkiye')));assert.ok(queries.some(q=>q.includes('Europe')));
});

test('bounded country lookup promotes published .com addresses without replacing explicit foreign facts',async()=>{
 const {enrichSupplierLocations}=load('@/lib/ai/supplier-location'),calls=[];
 const local=row('local.com'),duplicate={...local,source_url:'https://local.com/contact'},foreign=row('foreign.com','',{country:'Germany'}),unknown=row('unknown.com');
 const rows=await enrichSupplierLocations([local,duplicate,foreign,unknown],async url=>{calls.push(url);return url.includes('local.com')?'Office: Istanbul / Türkiye':'We ship to Turkey';});
 assert.equal(calls.length,2);assert.equal(rows[0].structured_data.country,'Turkey');assert.equal(rows[1].structured_data.country,'Turkey');
 assert.equal(rows[2],foreign);assert.equal(rows[3],unknown);assert.equal(local.structured_data.country,undefined,'Original evidence is retained');
 assert.equal(rows[0].structured_data.arat_country_evidence.url,local.source_url);
 assert.equal(policy.supplierCountryEvidence(rows[0]).basis,'published_address');
 const exhausted=await enrichSupplierLocations([unknown],async()=>{throw Error('Unavailable');});assert.equal(exhausted[0],unknown);
 let count=0;await enrichSupplierLocations(Array.from({length:20},(_,i)=>row('unknown'+i+'.com')),async()=>{count++;return '';},{},3);assert.equal(count,3);
 const market=await enrichSupplierLocations([unknown],async()=> 'A multi-vendor marketplace with an office in Istanbul / Turkey');
 assert.equal(policy.isSupplierEvidenceSource(market[0]),false,'Published marketplace identity is not a direct supplier');
});
