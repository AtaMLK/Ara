const test=require('node:test'),assert=require('node:assert/strict');
const {translate,validLocale}=require('./helpers/load-ts.cjs')()('@/lib/i18n/translate');
test('English is primary and unsupported preferences safely fall back to English',()=>{
 for(const value of [undefined,null,'de','TR','<script>'])assert.equal(validLocale(value),'en');
 assert.equal(validLocale('tr'),'tr');assert.equal(translate('en','Quantity'),'Quantity');
});
test('Turkish labels, statuses, whitespace and variable counts are readable',()=>{
 assert.equal(translate('tr','Quantity'),'Miktar');assert.equal(translate('tr','processing'),'İşleniyor');
 assert.equal(translate('tr',' New Request '),' Yeni talep ');
 assert.equal(translate('tr','View all activity · 23 events'),'Tüm hareketleri gör · 23 kayıt');
 assert.equal(translate('tr','Please complete Product Description and Quantity for item 3.'),'3. ürünün açıklamasını ve miktarını doldurun.');
});
test('unknown customer text, identifiers, numbers and model names stay unchanged',()=>{
 for(const value of ['HS-421T – 150 Pcs','AO-20261016-123ABC','175.00 EUR','hello dear, kindly send delivery time','handsfor'])assert.equal(translate('tr',value),value);
});
