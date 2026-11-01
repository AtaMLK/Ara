import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestItems} from '../src/lib/ui/request-items.ts';
import {displayText,quoteDisplayReference} from '../src/lib/ui/display-text.ts';
import {getInquiryDisplayReference} from '../src/lib/ui/inquiry-reference.ts';
const uuid='a3fdd9bc-94c6-45a2-a32d-31c1df2c7460';
test('ten product groups become ten rows rather than separate requirement rows',()=>{
 const fields=Array.from({length:10},(_,i)=>[
  {id:'p'+i,type:'product',value:'Product '+(i+1),source_ref:uuid+':Position '+(i+1),status:'confirmed'},
  {id:'m'+i,type:'model_part_number',value:'D'+(5000+i)+'S',source_ref:uuid+':Position '+(i+1),status:'confirmed'},
  {id:'q'+i,type:'quantity',value:(i+1)+' PCS',source_ref:uuid+':Position '+(i+1),status:'confirmed'},
 ]).flat();
 const items=requestItems({},fields);assert.equal(items.length,10);
 assert.equal(items[9].model,'D5009S');assert.equal(items[9].quantity,'10 PCS');assert.equal(items[0].requirements.length,3);
});
test('admin edits win and absent quantities remain unstated',()=>{
 const items=requestItems({},[{id:'a',type:'product',value:'A',status:'confirmed',source_ref:'item:1'},{id:'b',type:'quantity',value:'2',status:'confirmed',source_ref:'item:1'},{id:'c',type:'quantity',value:'5',status:'confirmed',admin_edited:true,source_ref:'item:1'},{id:'d',type:'product',value:'B',status:'open',source_ref:'item:2'}]);
 assert.equal(items.length,2);assert.equal(items[0].quantity,'5');assert.equal(items[1].quantity,'');
});
test('screen text uses meaningful requirement labels and never shows UUIDs',()=>{
 const label='Connector: 4-pin M12';assert.equal(displayText('Requirement '+uuid,{[uuid]:label}),'Requirement '+label);
 assert.doesNotMatch(displayText('Supplier quote '+uuid),new RegExp(uuid));
 assert.equal(displayText('6ES7214-1AG40-0XB0'),'6ES7214-1AG40-0XB0');
 assert.equal(displayText('HS-421T'),'HS-421T');
 assert.equal(quoteDisplayReference('DRAFT-'+uuid),'Draft quotation');
 assert.equal(quoteDisplayReference('DRAFT-'+uuid,'AO-20261023-0C5148-Q1'),'AO-20261023-0C5148-Q1');
 assert.equal(getInquiryDisplayReference('AO-20261016-8D9632',null,'2026-10-16T11:00:00Z',1),'AO-20261016-8D9632');
});
test('technical processing dumps have concise visible messages',()=>{
 assert.equal(displayText('AI output failed schema validation: [{"path": ["quotes",0]}]'),'The response could not be processed. Review the request and try again.');
});

test('submitted product quantities keep explicitly supplied units',()=>{
 const items=requestItems({submitted_items:[{description:'Cable',partNumber:'C-10',quantity:25,unit:'m'}]},[]);
 assert.equal(items[0].quantity,'25 m');assert.equal(items[0].model,'C-10');
});
