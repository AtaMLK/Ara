import type {OrderGroup} from './supplier-orders';
import type {CommercialDocument} from './commercial-pdf';
export function purchaseOrderDocument(group:OrderGroup,date:string):CommercialDocument {
  const country=(group.country||'').toLocaleLowerCase('tr').replaceAll('ı','i').normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  const domestic=/^(turkey|turkiye|tr)$/.test(country);
  const hasTax=group.lines.some(line=>Number(line.taxRate)>0||line.taxMode==='excluded'||line.taxMode==='included'||line.net!=null&&line.gross!=null&&line.gross!==line.net||/\+.*(?:tax|vat)|\d.*%/i.test(line.taxText));
  const taxLabel=domestic?'KDV':hasTax?'TA':undefined;
  return {kind:'purchase_order',language:group.language||'en',reference:group.reference,date,recipient:group.supplierName,taxLabel,instructions:group.instructions,
    lines:group.lines.map(line=>{
      const net=line.net??(line.gross!=null&&line.taxRate!=null?line.gross/(1+line.taxRate/100):!taxLabel?line.gross:null);
      const amount=net==null?null:Math.round(net*line.quantity*100)/100;
      const gross=line.gross??(line.taxMode==='exempt'||line.taxRate===0?net:null);
      const total=gross==null?null:Math.round(gross*line.quantity*100)/100;
      const taxAmount=amount==null||total==null?null:Math.round((total-amount)*100)/100;
      return {description:line.description,model:line.model,brand:line.brand,quantity:line.quantity,unit:line.unit,unitPrice:net,amount,total,taxAmount,taxRate:line.taxRate,currency:line.currency,delivery:line.delivery,loadingDate:line.loadingDate,deliveryDate:line.deliveryDate,
        terms:line.terms.split(/\s*[·|]\s*/).filter(term=>!/^\+?\s*(?:kdv|vat|tax)\s*(?:hariç|dahil|included|excluded)?$/i.test(term.trim())).join('; ')};
    })};
}
