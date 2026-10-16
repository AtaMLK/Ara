const test=require('node:test'),assert=require('node:assert/strict');
const {customerRequestParts}=require('./helpers/load-ts.cjs')()('@/lib/ui/customer-request');
const message='hello dear ,\nkindly please send us delivery time and orice request\nHS-421T – Top Exit – 4 Pin M12 Dual Output Accelerometer With Temp Output  150 Pcs\n\nkind regards.';
test('form wrappers become message plus separate submitted facts without rewriting customer words',()=>{
 const parts=customerRequestParts(`Item 1\nDescription: ${message}\nQuantity: 150\nBrand / Manufacturer: handsfor`);
 assert.equal(parts.length,1);assert.equal(parts[0].message,message);
 assert.deepEqual(parts[0].details,[{label:'Quantity',value:'150'},{label:'Manufacturer',value:'handsfor'}]);
});
test('multiple items, multiline details and additional customer text are preserved',()=>{
 const parts=customerRequestParts('Item 1\\nDescription: First product\\nQuantity: 2\\nAdditional details: One\\nTwo\\n\\nItem 2\\nDescription: Second product\\nQuantity: 3\\nPart Number / Model: ABC\\n\\nAdditional product list / customer text:\\nPlease deliver on Monday.');
 assert.equal(parts.length,3);assert.equal(parts[0].details[1].value,'One\nTwo');assert.equal(parts[1].message,'Second product');assert.equal(parts[2].message,'Please deliver on Monday.');
});
test('free-form emails and ambiguous wrappers remain verbatim',()=>{
 for(const text of [message,'Item 1\nDescription: an email without a generated quantity','Item 1\nDescription: One\nQuantity: 2\n\nItem 3\nDescription: Three\nQuantity: 3'])assert.deepEqual(customerRequestParts(text),[{message:text,details:[]}]);
});
