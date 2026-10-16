const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-ts.cjs')(),{renderSupplierOrder}=load('@/lib/quotes/supplier-orders');
const company={name:'Arya Automation',address:'İkitelli OSB\nBaşakşehir / İstanbul',phone:'+90 552 207 5354',website:'www.aryautomation.com',taxDetails:'İkitelli | VAT No. 62527506564',email:'purchase-dep@aryaautomation.com'};
const group={supplierId:'supplier',supplierName:'Test Supplier',recipient:'sales@example.test',reference:'AO-20261010-73857C-Q1-PO1',language:'tr',instructions:'Teslimat adresi:\nİkitelli OSB, Daire 81',lines:[{itemId:'item',supplierQuoteId:'offer',description:'Dual-output accelerometer with temperature output',model:'HS-421T',brand:'Hansford',quantity:150,currency:'EUR',net:175,gross:210,taxText:'20% (excluded)',delivery:'2 hafta',terms:'Banka havalesi'}]};
test('supplier order HTML preserves paragraph, table and footer structure without white-space CSS',()=>{
 const email=renderSupplierOrder(group,company);assert.match(email.html,/<html lang="tr"/);assert.match(email.html,/<meta charset="utf-8"/);assert.match(email.html,/<p[^>]*>Sayın Test Supplier,<\/p>/);assert.match(email.html,/<thead>/);assert.match(email.html,/<tbody>/);
 assert.match(email.html,/175,00 EUR/);assert.match(email.html,/210,00 EUR/);assert.match(email.html,/31\.500,00 EUR/);assert.match(email.html,/KDV hariç/);assert.match(email.html,/Teslim süresi/);assert.match(email.html,/Teslimat adresi:<br \/>İkitelli/);assert.match(email.html,/Başakşehir \/ İstanbul/);assert.match(email.html,/Satın Alma Departmanı<br \/>/);assert.doesNotMatch(email.html,/white-space:pre|Dear|Purchase order/);
 assert.match(email.body,/\n\n/);assert.match(email.subject,/Satın alma siparişi/);
});
test('HTML escapes supplier text and keeps mixed currencies in separate totals',()=>{
 const email=renderSupplierOrder({...group,language:'en',supplierName:'Supplier <script>bad()</script>',instructions:'Handle <carefully> & confirm',lines:[...group.lines,{...group.lines[0],itemId:'second',currency:'USD',quantity:2,net:10,gross:null}]},company);
 assert.doesNotMatch(email.html,/<script>/);assert.match(email.html,/&lt;script&gt;/);assert.match(email.html,/Handle &lt;carefully&gt; &amp; confirm/);assert.match(email.html,/Order total \(EUR\)/);assert.match(email.html,/31,500\.00 EUR/);assert.match(email.html,/Order total \(USD\): Awaiting confirmation/);
});
test('automatic supplier replies use real paragraphs and explicit signature breaks',()=>{
 const {supplierReplyMessage}=load('@/lib/email/supplier-language');const message=supplierReplyMessage('tr','Gerekli gerilim 24 V DC.\nMiktar: 150 adet.');assert.match(message.html,/<p[^>]*>Merhaba,<\/p>/);assert.match(message.html,/24 V DC\.<br \/>Miktar/);assert.match(message.html,/İyi çalışmalar,<br \/>Arya Automation/);assert.doesNotMatch(message.html,/white-space/);
});
module.exports={group,company};
