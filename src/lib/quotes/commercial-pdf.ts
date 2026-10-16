import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {QuoteCompany} from './document';

export type CommercialLine={description:string;model?:string|null;brand?:string|null;quantity:number;unit?:string|null;unitPrice:number|null;amount:number|null;taxAmount?:number|null;taxRate?:number|null;total:number|null;currency:string;delivery?:string|null;loadingDate?:string|null;deliveryDate?:string|null;terms?:string|null};
export type CommercialDocument={kind:'quotation'|'purchase_order';language:'tr'|'en';reference:string;date:string;recipient:string;relatedReference?:string;validUntil?:string|null;taxLabel?:'KDV'|'TA';instructions?:string;notes?:string;lines:CommercialLine[]};

// Both documents deliberately use this same layout, fonts, logo and company
// block. Customer quotations never receive supplier costs or supplier tax data.
export async function createCommercialPdf(doc:CommercialDocument,company:QuoteCompany){
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const fonts=await Promise.all(['regular','bold','extended-regular','extended-bold'].map(async name=>pdf.embedFont(await readFile(join(process.cwd(),'public/fonts/quotation-'+name+'.woff')),{subset:true})));
  const charsets=fonts.map(font=>new Set(font.getCharacterSet()));
  const runs=(value:string,strong=false)=>Array.from(value.replace(/[\r\t]/g,' ').replace(/[–—‑]/g,'-')).map(char=>({char,font:charsets[strong?1:0].has(char.codePointAt(0)!)?fonts[strong?1:0]:fonts[strong?3:2]}));
  const width=(value:string,size:number,strong=false)=>runs(value,strong).reduce((sum,r)=>sum+r.font.widthOfTextAtSize(r.char,size),0);
  const tr=doc.language==='tr',ink=rgb(.09,.17,.27),muted=rgb(.36,.43,.5),blue=rgb(.16,.37,.56),rule=rgb(.84,.89,.94),pale=rgb(.93,.96,.98);
  const labels=tr?{quote:'FİYAT TEKLİFİ',order:'SATIN ALMA SİPARİŞİ',to:'MUHATAP',date:'Tarih',valid:'Geçerlilik',related:'Talep referansı',no:'No.',item:'Ürün / açıklama',qty:'Miktar',unit:'Birim fiyat',amount:'Tutar',total:'Toplam',subtotal:'Ara toplam',delivery:'TESLİM KOŞULLARI',loading:'Yükleme / sevk tarihi',deliveryDate:'Teslim tarihi',instructions:'TESLİMAT TALİMATLARI',pending:'Teyit bekleniyor',unknownUnit:'birim belirtilmedi',page:'Sayfa'}:{quote:'QUOTATION',order:'PURCHASE ORDER',to:'PREPARED FOR',date:'Date',valid:'Valid until',related:'Inquiry reference',no:'No.',item:'Item / description',qty:'Quantity',unit:'Unit price',amount:'Amount',total:'Total',subtotal:'Subtotal',delivery:'DELIVERY TERMS',loading:'Loading / dispatch date',deliveryDate:'Delivery date',instructions:'DELIVERY INSTRUCTIONS',pending:'Awaiting confirmation',unknownUnit:'unit not stated',page:'Page'};
  const title=doc.kind==='quotation'?labels.quote:labels.order;
  pdf.setTitle(title+' '+doc.reference);pdf.setAuthor(company.name);
  const logo=company.logo?company.logoType==='image/jpeg'?await pdf.embedJpg(company.logo):await pdf.embedPng(company.logo):null;
  const wrap=(value:string,maxWidth:number,size=9,strong=false)=>{
    const result:string[]=[];
    for(const paragraph of value.split(/\r?\n/)){
      let row='';for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(width(row?row+' '+word:word,size,strong)<=maxWidth){row=row?row+' '+word:word;continue;}
        if(row){result.push(row);row='';}
        for(const char of Array.from(word)){if(row&&width(row+char,size,strong)>maxWidth){result.push(row);row='';}row+=char;}
      }if(row)result.push(row);
    }return result.length?result:[''];
  };
  let page=pdf.addPage([595.28,841.89]),y=0;
  const draw=(value:string,x:number,at:number,size=9,strong=false,color=ink)=>{for(const r of runs(value,strong)){page.drawText(r.char,{x,y:at,size,font:r.font,color});x+=r.font.widthOfTextAtSize(r.char,size);}};
  const right=(value:string,x:number,at:number,size=9,strong=false,color=ink)=>draw(value,x-width(value,size,strong),at,size,strong,color);
  const heading=()=>{
    page.drawRectangle({x:0,y:830,width:596,height:12,color:blue});
    if(logo){const scale=Math.min(175/logo.width,58/logo.height);page.drawImage(logo,{x:42,y:752,width:logo.width*scale,height:logo.height*scale});}else draw(company.name,42,790,19,true,blue);
    const companyLines=[company.name,...wrap(company.address||'',255,8),...wrap(company.taxDetails||'',255,8),...wrap([company.phone,company.email,company.website].filter(Boolean).join(' | '),255,8)].filter((v):v is string=>!!v);
    companyLines.forEach((line,i)=>draw(line,298,800-i*12,i===0?10:8,i===0,i===0?ink:muted));
    const bottom=Math.min(732,800-companyLines.length*12-12);
    draw(title,42,bottom,17,true,blue);draw(doc.reference,42,bottom-22,12,true);
    right(labels.date+': '+doc.date,553,bottom,9);
    if(doc.validUntil)right(labels.valid+': '+doc.validUntil,553,bottom-17,8,false,muted);
    y=bottom-55;draw(labels.to,42,y,8,true,muted);y-=17;
    for(const line of wrap(doc.recipient,500,11,true)){draw(line,42,y,11,true);y-=15;}
    if(doc.relatedReference){draw(labels.related+': '+doc.relatedReference,42,y,8,false,muted);y-=17;}
    y-=12;
  };
  heading();
  const newPage=()=>{page=pdf.addPage([595.28,841.89]);heading();};
  const columns=doc.taxLabel?[{key:'no',label:labels.no,w:24},{key:'item',label:labels.item,w:158},{key:'qty',label:labels.qty,w:58},{key:'unit',label:labels.unit,w:67},{key:'amount',label:labels.amount,w:68},{key:'tax',label:doc.taxLabel,w:68},{key:'total',label:labels.total,w:68}]:[{key:'no',label:labels.no,w:26},{key:'item',label:labels.item,w:230},{key:'qty',label:labels.qty,w:75},{key:'unit',label:labels.unit,w:88},{key:'amount',label:labels.amount,w:92}];
  const headers=()=>{page.drawRectangle({x:42,y:y-30,width:511,height:30,color:pale});let x=42;for(const c of columns){wrap(c.label,c.w-10,7.5,true).forEach((line,i)=>draw(line,x+5,y-12-i*10,7.5,true));x+=c.w;}y-=43;};
  headers();
  const money=(n:number|null|undefined,currency:string,precision=2)=>n==null?labels.pending:Number(n).toLocaleString(tr?'tr-TR':'en-GB',{minimumFractionDigits:2,maximumFractionDigits:precision})+' '+currency;
  for(const [index,item] of doc.lines.entries()){
    const values:Record<string,string>={no:String(index+1),item:[item.description,...[item.model,item.brand].filter(Boolean)].join('\n'),qty:Number(item.quantity).toLocaleString(tr?'tr-TR':'en-GB',{maximumFractionDigits:6})+' '+(item.unit||labels.unknownUnit),unit:money(item.unitPrice,item.currency,6),amount:money(item.amount,item.currency),tax:(item.taxRate!=null?(tr?'%'+item.taxRate:item.taxRate+'%')+'\n':'')+money(item.taxAmount,item.currency),total:money(item.total,item.currency)};
    const descriptionLines=wrap(item.description,columns[1].w-10,9,true);
    const cells=columns.map(c=>c.key==='item'?[...descriptionLines,...wrap([item.model,item.brand].filter(Boolean).join(' | '),c.w-10,8)]:wrap(values[c.key],c.w-10,8));
    const count=Math.max(...cells.map(lines=>lines.length));let offset=0;
    while(offset<count){
      if(y<145){newPage();headers();}
      const available=Math.max(1,Math.floor((y-110)/13)),take=Math.min(count-offset,available);
      let x=42;columns.forEach((c,j)=>{cells[j].slice(offset,offset+take).forEach((text,i)=>{const strong=c.key==='item'&&offset+i<descriptionLines.length;draw(text,x+5,y-i*13,strong?9:8,strong,c.key==='item'&&!strong?muted:ink);});x+=c.w;});
      y-=take*13+16;page.drawLine({start:{x:42,y:y+5},end:{x:553,y:y+5},color:rule});y-=10;offset+=take;
      if(offset<count){newPage();headers();}
    }
  }
  y-=10;
  const totalRow=(label:string,value:string,strong=false)=>{if(y<130)newPage();draw(label,285,y,strong?10:9,strong);right(value,553,y,strong?11:9,strong,strong?blue:ink);y-=strong?27:20;};
  for(const currency of [...new Set(doc.lines.map(line=>line.currency))]){
    const lines=doc.lines.filter(line=>line.currency===currency);
    const sum=(key:'amount'|'taxAmount'|'total')=>lines.some(line=>line[key]==null)?null:lines.reduce((n,line)=>n+Number(line[key]),0);
    if(doc.taxLabel){totalRow(labels.subtotal+' ('+currency+')',money(sum('amount'),currency));totalRow(doc.taxLabel+' ('+currency+')',money(sum('taxAmount'),currency));}
    totalRow(labels.total+' ('+currency+')',money(sum('total'),currency),true);
  }
  const section=(title:string,text:string)=>{const lines=wrap(text,500,9);if(y<150)newPage();y-=12;draw(title,42,y,9,true,blue);y-=20;for(const line of lines){if(y<100)newPage();draw(line,42,y,9);y-=14;}y-=7;};
  const delivery=doc.lines.flatMap((line,i)=>{
    const details=[line.delivery,line.loadingDate?labels.loading+': '+line.loadingDate:'',line.deliveryDate?labels.deliveryDate+': '+line.deliveryDate:'',line.terms].filter(Boolean);
    return details.length?[(i+1)+'. '+(line.model||line.description)+' - '+details.join('; ')]:[];
  });
  if(delivery.length)section(labels.delivery,delivery.join('\n'));
  if(doc.instructions?.trim())section(labels.instructions,doc.instructions.trim());
  if(doc.notes?.trim())section(tr?'KOŞULLAR':'TERMS',doc.notes.trim());
  for(const [index,p] of pdf.getPages().entries()){
    page=p;page.drawLine({start:{x:42,y:66},end:{x:553,y:66},color:rule});draw(company.name,42,48,8,false,muted);right(doc.reference+' | '+labels.page+' '+(index+1)+' / '+pdf.getPageCount(),553,48,8,false,muted);
  }
  return pdf.save();
}
