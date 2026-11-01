import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { parseSpreadsheet } from '../src/lib/documents/spreadsheet.ts';

for (const bookType of ['xlsx','xls']) {
  test(`patched parser reads ${bookType} product/model/quantity and Unicode`, () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Product','Model','Qty'],['حسگر','HS-421T',150]]),'Request');
    const parsed = parseSpreadsheet(new Uint8Array(XLSX.write(book,{type:'buffer',bookType})));
    assert.match(parsed.extractedText,/HS-421T/);
    assert.match(parsed.extractedText,/حسگر/);
    assert.match(parsed.extractedText,/150/);
    assert.deepEqual(parsed.qualityFlags,[]);
  });
}
test('CSV is supported and huge worksheet ranges are bounded and disclosed', () => {
  assert.match(parseSpreadsheet(new TextEncoder().encode('Product,Qty\nSensor,10')).extractedText,/Sensor \| 10/);
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Sensor',10]]); sheet['!ref']='A1:EZ2501';
  XLSX.utils.book_append_sheet(book,sheet,'Large');
  const parsed = parseSpreadsheet(new Uint8Array(XLSX.write(book,{type:'buffer',bookType:'xlsx'})));
  assert.ok(parsed.qualityFlags.includes('SPREADSHEET_TRUNCATED'));
  assert.ok(parsed.extractedData.sheets[0].rows.length <= 2000);
  assert.ok(parsed.extractedText.length <= 120000);
});
test('empty and oversized spreadsheet uploads are rejected', () => {
  assert.throws(()=>parseSpreadsheet(new Uint8Array()));
  assert.throws(()=>parseSpreadsheet(new Uint8Array(10*1024*1024+1)));
});
