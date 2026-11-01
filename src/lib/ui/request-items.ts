export type RequestRequirement={id:string;type:string;value:string;source_ref?:string|null;admin_edited?:boolean;status:string};
type SourceItem=Record<string,unknown>;
function record(value:unknown):SourceItem{return value&&typeof value==='object'&&!Array.isArray(value)?value as SourceItem:{};}
export function requestItems(normalized:unknown,requirements:RequestRequirement[]){
 const info=record(normalized),intake=record(info.intake);
 const source=(Array.isArray(intake.items)?intake.items:Array.isArray(info.submitted_items)?info.submitted_items:[]).map(record);
 const active=requirements.filter(row=>row.status!=='rejected');
 const refs=[...new Set(active.map(row=>row.source_ref).filter((ref):ref is string=>!!ref))];
 const products=active.filter(row=>row.type==='product');
 const count=Math.max(source.length,refs.length,refs.length?0:products.length,active.length?1:0);
 return Array.from({length:count},(_,index)=>{
  const item=source[index]??{};
  const ref=refs.includes('intake:item:'+index)?'intake:item:'+index:refs[index];
  const rows=ref?active.filter(row=>row.source_ref===ref):count===1?active:products[index]?[products[index]]:[];
  const field=(type:string)=>rows.find(row=>row.type===type&&row.admin_edited)?.value??rows.find(row=>row.type===type)?.value;
  const specs=rows.filter(row=>row.type==='specification');
  const brandRow=specs.find(row=>/^brand:/i.test(row.value)&&row.admin_edited)??specs.find(row=>/^brand:/i.test(row.value));
  return {index:index+1,description:field('product')||String(item.product??item.description??''),model:field('model_part_number')||String(item.model??item.partNumber??item.model_part_number??''),brand:brandRow?.value.replace(/^brand:\s*/i,'')||String(item.brand??''),quantity:field('quantity')||[item.quantity,item.unit].filter(value=>value!=null&&value!=='').map(String).join(' '),status:rows.length&&rows.every(row=>row.status==='confirmed')?'confirmed':rows.some(row=>row.status==='clarification_required')?'clarification_required':'open',requirements:rows};
 });
}
export type RequestItem=ReturnType<typeof requestItems>[number];
