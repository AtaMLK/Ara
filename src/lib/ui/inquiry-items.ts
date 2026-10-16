import {quantityUnit} from '@/lib/quotes/quantity-unit';
export type RequestRequirement={id?:string;type:string;value:string;source_ref?:string|null;admin_edited?:boolean;status?:string};
export function readableRequest(text:string|null|undefined) {
  return (text??'').replace(/\\+r\\+n|\\+n|\\+r/g,'\n');
}
export function inquiryItems(normalized:unknown, requirements:RequestRequirement[]=[]) {
  const info=(normalized??{}) as {submitted_items?:Array<Record<string,unknown>>;intake?:{items?:Array<Record<string,unknown>>}};
  const source=info.intake?.items??info.submitted_items??[];
  const groups=[...new Set(requirements.map(r=>r.source_ref).filter((r):r is string=>!!r))];
  const count=Math.max(source.length,groups.length);
  return Array.from({length:count},(_,i)=>{
    const item=source[i]??{},ref=groups.includes('intake:item:'+i)?'intake:item:'+i:groups[i];
    const rows=requirements.filter(r=>r.source_ref===ref&&r.status!=='rejected');
    const field=(type:string)=>rows.find(r=>r.type===type&&r.admin_edited)?.value??rows.find(r=>r.type===type)?.value;
    const submitted=info.submitted_items?.[i];
    const brandRow=rows.find(r=>r.type==='specification'&&/^brand:/i.test(r.value)&&r.admin_edited)??rows.find(r=>r.type==='specification'&&/^brand:/i.test(r.value));
    const brand=brandRow?.admin_edited?brandRow.value.replace(/^brand:\s*/i,''):String(submitted?.brand||brandRow?.value.replace(/^brand:\s*/i,'')||item.brand||'');
    const model=rows.find(r=>r.type==='model_part_number'&&r.admin_edited)?.value??String(submitted?.partNumber||field('model_part_number')||item.model||item.partNumber||'');
    const description=(rows.some(r=>r.type==='product'&&r.admin_edited)?field('product'):String(item.product??item.description??field('product')??''))??'';
    const specifications=[...new Set(rows.filter(r=>r.type==='specification'&&!/^brand:/i.test(r.value)).map(r=>r.value).concat(Array.isArray(item.specifications)?item.specifications.map(String):[]))];
    const quantity=rows.find(r=>r.type==='quantity'&&r.admin_edited)?.value??(submitted?.quantity!=null?String(submitted.quantity):field('quantity')??String(item.quantity??''));
    const compact=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
    const fullDescription=[description,...specifications.filter(spec=>!compact(description).includes(compact(spec)))].filter(Boolean).join(' · ');
    return {index:i+1,sourceRef:ref,description,fullDescription,model,brand,quantity,unit:quantityUnit(submitted?.unit,item.unit,field('quantity')),specifications,serialNumber:String(submitted?.serialNumber??''),additionalDetails:String(submitted?.details??''),
      label:[model,description].filter(Boolean).join(' — ')};
  });
}
export function quoteItemIdentity(calculation:Record<string,unknown>|null, product?:{product_name?:string|null;model_part_number?:string|null}|null) {
  const c=calculation??{};
  return {name:String(c.customer_product_name??c.product_label??product?.product_name??product?.model_part_number??'Item awaiting description'),
    model:String(c.customer_model??product?.model_part_number??''),brand:String(c.customer_brand??''),delivery:typeof c.customer_delivery==='string'?c.customer_delivery:''};
}
