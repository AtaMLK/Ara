const fs=require('node:fs');
const company={name:'Arya Automation',address:'İkitelli OSB\nBaşakşehir / İstanbul',phone:'+90 552 207 5354',website:'www.aryautomation.com',taxDetails:'İkitelli | VAT No. 62527506564',email:'purchase-dep@aryaautomation.com',logo:new Uint8Array(fs.readFileSync('public/branding/arya-logo.png')),logoType:'image/png'};
const group={supplierId:'supplier',supplierName:'Test Supplier',country:'Turkey',recipient:'sales@example.test',reference:'AO-20261010-73857C-Q1-PO1',language:'tr',instructions:'Teslimat adresi: İkitelli OSB, Daire 81',lines:[
 {itemId:'one',supplierQuoteId:'offer1',description:'Temperature accelerometer',model:'HS-421T',brand:'Hansford',quantity:150,unit:'pcs',currency:'EUR',net:175,gross:210,taxRate:20,taxMode:'excluded',taxText:'+20% KDV',delivery:'2 hafta',loadingDate:'23/10/2026',deliveryDate:'30/10/2026',terms:'Banka havalesi'},
 {itemId:'two',supplierQuoteId:'offer2',description:'Machined strip',model:'STRIP-02',brand:'Brand',quantity:2500,unit:'mm',currency:'EUR',net:0.12,gross:0.144,taxRate:20,taxMode:'excluded',taxText:'+20% KDV',delivery:'3 hafta',terms:''},
 {itemId:'three',supplierQuoteId:'offer3',description:'Adhesive',model:'ADH-03',brand:'Brand',quantity:12.5,unit:'kg',currency:'EUR',net:8,gross:9.6,taxRate:20,taxMode:'excluded',taxText:'+20% KDV',delivery:'Stokta',terms:''},
]};

module.exports={company,group};
