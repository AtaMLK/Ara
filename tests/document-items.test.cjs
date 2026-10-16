const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=require('./helpers/load-ts.cjs')(),{explicitDocumentItems,normalizeDocumentRequirements}=load('@/lib/ai/document-items'),{supplierSearchQueries,mapResearchQueries}=load('@/lib/ai/research/queries');
const text=fs.readFileSync(path.join(__dirname,'fixtures/document-item-table.txt'),'utf8');
test('all five PDF rows separate quantity, exact code, description and sales metadata',()=>{
 const items=explicitDocumentItems(text);assert.deepEqual(items.map(i=>[i.model,i.quantity,i.unit]),[['D5072D',35,'PCS'],['D5040S',14,'PCS'],['D5030S',6,'PCS'],['D5011S',6,'PCS'],['D5212Q',1,'PCS']]);
 assert.equal(items[1].description,'SINGLE SIL3 OUT DRIVER NE LOAD LOOP POW.DINRAIL&TB; Country of Origin: IT HS Code: 8543709099');assert.equal(items[1].salesStatus,'ACTIVE');assert.match(items[2].description,/4A 250VAC 1000VA 250VDC 120W/);assert.doesNotMatch(items[1].description,/14 PCS|D5040S|Sales Status|Your Pos/);
});
test('flattened AI products are repaired without dropping distinct rows or global conditions',()=>{
 const flat=explicitDocumentItems(text).map((item,index)=>({type:'product',sourceRef:'row:'+index,value:`${item.quantity} PCS of ${item.model} — ${item.description}`}));
 const result=normalizeDocumentRequirements(text,[...flat,{type:'delivery',value:'Delivery required next month'}]);
 assert.equal(result.requirements.filter(r=>r.type==='product').length,5);assert.equal(result.requirements.filter(r=>r.type==='quantity').length,5);assert.ok(result.requirements.some(r=>r.type==='delivery'));
 for(const item of result.items){const group=result.requirements.filter(r=>r.sourceRef===item.sourceRef);assert.equal(group.find(r=>r.type==='quantity').value,item.quantity+' PCS');assert.equal(group.find(r=>r.type==='model_part_number').value,item.model);}
});
test('ratings, HS codes and item positions never become ordered quantities',()=>{
 assert.deepEqual(explicitDocumentItems('Code Description Qty Unit\nD1 Module 250VAC\nHS Code: 8543709099\nYour Pos.: 14'),[]);
 assert.deepEqual(explicitDocumentItems('D1 Module 14 PCS'),[]);
 const items=explicitDocumentItems('Code | Description | Quantity | Unit\nABC-200 | General material | 12,5 | kg');assert.equal(items[0].quantity,12.5);assert.equal(items[0].model,'ABC-200');
});
test('searches use exact codes and never naked distributor queries or customs metadata',()=>{
 for(const item of explicitDocumentItems(text)){const queries=supplierSearchQueries({product:item.description,model:item.model});assert.ok(queries.some(q=>q.startsWith(item.model+' manufacturer')));assert.ok(queries.every(q=>q.includes(item.model)||q.includes('SINGLE')||q.includes('DUAL')||q.includes('QUADRUPLE')));assert.ok(queries.every(q=>!/8543709099|Country of Origin|Sales Status|\d+ PCS of/i.test(q)));}
 assert.ok(supplierSearchQueries({product:'General requested material'}).every(q=>q.includes('General requested material')));
});
test('provider concurrency is bounded and result ordering is stable',async()=>{
 let active=0,max=0;const result=await mapResearchQueries([1,2,3,4,5,6,7,8],async value=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return value*2;},3);assert.equal(max,3);assert.deepEqual(result,[2,4,6,8,10,12,14,16]);
});
test('structured AI items work without a table header and preserve missing quantities as missing',()=>{
 const {documentOutputSchema}=load('@/lib/ai/agent-schemas');const output=documentOutputSchema.parse({items:[{sourceRef:'page:1:item:1',description:'Requested packaging material',model:'PKG-2',unit:'kg',requestedText:'Please quote PKG-2 packaging material.'}]});
 const result=normalizeDocumentRequirements('Please quote PKG-2 packaging material.',output.requirements,output.items);assert.equal(result.requirements.find(r=>r.type==='model_part_number').value,'PKG-2');assert.equal(result.requirements.some(r=>r.type==='quantity'),false);
 const aliases=documentOutputSchema.parse({requirements:[{type:'item_code',value:'PKG-2'},{type:'description',value:'Packaging material'}]});assert.deepEqual(aliases.requirements.map(r=>r.type),['model_part_number','product']);
});
