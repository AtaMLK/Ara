import {createCommercialPdf} from './commercial-pdf';
export type QuoteCompany={name:string;email:string;address?:string;phone?:string;website?:string;taxDetails?:string;logo?:Uint8Array;logoType?:string};
export type QuoteDocument={reference:string;inquiryReference:string;customerName:string;currency:string;date:string;validUntil?:string|null;message?:string|null;portalUrl?:string;
  lines:Array<{description:string;model?:string|null;brand?:string|null;delivery?:string|null;quantity:number;unit?:string|null;unitPrice:number;total:number}>};
const escape=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function quoteMessage(message?:string|null){return (message??'').trim().replace(/^(?:hello|dear)\s+[^\n,]+,?\s*/i,'').replace(/\n\s*(?:kind\s+regards|regards|best\s+regards)[,\s\S]*$/i,'').trim().replace(/^Please find our quotation (?:below|regarding inquiry [^.]+)\.\s*/i,'').trim();}
export function quotationSubject(reference:string,model?:string|null){return 'Quotation '+reference+(model?' | '+model:'');}
export function renderQuoteEmail(doc:QuoteDocument,company:QuoteCompany){
  const intro='Please find attached our quotation '+doc.reference+' for your review.';
  const next=doc.portalUrl?'Please use the customer portal to accept the quotation or request any changes.':'Please reply to this email to confirm acceptance or request any changes.';
  const text='Dear '+doc.customerName+',\n\n'+intro+'\n\n'+next+(doc.portalUrl?'\n'+doc.portalUrl:'')+'\n\nKind regards,\nPurchase Department\n'+company.name;
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8" /></head><body style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#172b45;line-height:1.6"><div style="max-width:720px;padding:24px"><p style="margin:0 0 18px">Dear '+escape(doc.customerName)+',</p><p style="margin:0 0 18px">'+escape(intro)+'</p><p style="margin:0 0 18px">'+escape(next)+'</p>'+(doc.portalUrl?'<p style="margin:0 0 18px"><a href="'+escape(doc.portalUrl)+'">Review quotation</a></p>':'')+'<p style="margin:0">Kind regards,<br />Purchase Department<br />'+escape(company.name)+'</p></div></body></html>';
  return {html,text};
}
export async function createQuotePdf(doc:QuoteDocument,company:QuoteCompany){
  const notes=quoteMessage(doc.message).replace(/^Delivery and pricing are listed separately for each item\.?$/i,'');
  return createCommercialPdf({kind:'quotation',language:'en',reference:doc.reference,date:doc.date,recipient:doc.customerName,relatedReference:doc.inquiryReference,validUntil:doc.validUntil,notes,
    lines:doc.lines.map(line=>({description:line.description,model:line.model,brand:line.brand,quantity:line.quantity,unit:line.unit,delivery:line.delivery,unitPrice:line.unitPrice,amount:line.total,total:line.total,currency:doc.currency}))},company);
}
