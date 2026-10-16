export type DocumentRequirement={type:'product'|'model_part_number'|'quantity'|'specification'|'delivery'|'other';value:string;sourceRef?:string};
export type DocumentItem={description:string;model?:string;quantity?:number;unit?:string;brand?:string;sourceRef:string;salesStatus?:string;requestedText?:string};

const units='pcs?|pieces?|adet|units?|kg|g|mm|cm|m|litres?|liters?|l|sets?|pairs?|boxes?|packs?';
const tableRow=new RegExp(`^([^\\s|]+)\\s+(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+(${units})$`,'i');

// Read only explicit Code / Description / Quantity / Unit columns. This is a
// lossless guard for tabular PDFs and sheets, not a guess based on product names.
export function explicitDocumentItems(text:string):DocumentItem[]{
  const lines=text.split(/\r?\n/).map(line=>line.replace(/\s*\|\s*/g,' ').replace(/\s+/g,' ').trim());
  if(!lines.some(line=>/\b(code|kod|item code|part number)\b/i.test(line)&&/\b(description|açıklama|aciklama)\b/i.test(line)&&/\b(qty|quantity|miktar)\b/i.test(line)))return [];
  const items:DocumentItem[]=[];
  let current:DocumentItem|undefined;
  for(const [index,line]of lines.entries()){
    if(/^(?:(?:Code\s+Description|Subtotal|Grand Total|Terms and conditions|Payment terms)\b|Total\s*:)/i.test(line)){current=undefined;continue;}
    const row=line.match(tableRow);
    if(row){
      const quantity=Number(row[3].replace(',','.'));
      if(!Number.isFinite(quantity)||quantity<=0)continue;
      current={sourceRef:`table:line:${index+1}`,model:row[1],description:row[2],quantity,unit:row[4],requestedText:line};items.push(current);continue;
    }
    if(!current||!line)continue;
    if(/^Sales\s+Status\s*:/i.test(line)){current.salesStatus=line.replace(/^Sales\s+Status\s*:\s*/i,'');continue;}
    if(/^(?:Your\s+Pos\.?|Position|Page|Sayfa)\s*[:\d]/i.test(line))continue;
    current.description+='; '+line;
  }
  return items;
}

export function documentItemRequirements(items:DocumentItem[]):DocumentRequirement[]{
  return items.flatMap(item=>{
    const rows:DocumentRequirement[]=[{type:'product',value:item.description.trim(),sourceRef:item.sourceRef}];
    if(item.model?.trim())rows.push({type:'model_part_number',value:item.model.trim(),sourceRef:item.sourceRef});
    if(item.quantity!=null)rows.push({type:'quantity',value:`${item.quantity}${item.unit?.trim()?' '+item.unit.trim():''}`,sourceRef:item.sourceRef});
    if(item.brand?.trim())rows.push({type:'specification',value:'Brand: '+item.brand.trim(),sourceRef:item.sourceRef});
    if(item.salesStatus?.trim())rows.push({type:'other',value:'Sales status: '+item.salesStatus.trim(),sourceRef:item.sourceRef});
    return rows;
  });
}

export function normalizeDocumentRequirements(text:string,requirements:DocumentRequirement[],aiItems:DocumentItem[]=[]){
  const explicit=explicitDocumentItems(text);
  const items=explicit.length?[
    ...explicit.map(item=>{
      const ai=aiItems.find(ai=>ai.model?.toLowerCase()===item.model?.toLowerCase());
      return ai?.brand&&text.toLowerCase().includes(ai.brand.toLowerCase())?{...item,brand:ai.brand}:item;
    }),
    ...aiItems.filter(ai=>!explicit.some(item=>item.model?.toLowerCase()===ai.model?.toLowerCase())),
  ]:aiItems;
  if(!items.length)return {requirements,items};
  // Replace AI groups which represent these same rows. Preserve unrelated items
  // and global delivery/other conditions instead of discarding document content.
  const represented=new Set<string|undefined>();
  for(const row of requirements){
    if(items.some(item=>item.model&&new RegExp(`(?:^|[^a-z0-9])${item.model.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^a-z0-9])`,'i').test(row.value)||row.type==='product'&&row.value.trim().toLowerCase()===item.description.trim().toLowerCase()))represented.add(row.sourceRef);
  }
  const kept=requirements.filter(row=>!(represented.has(row.sourceRef)&&(row.sourceRef!==undefined||['product','model_part_number','quantity'].includes(row.type)))&&!(aiItems.length&&!explicit.length&&row.type==='product'));
  return {requirements:[...kept,...documentItemRequirements(items)],items};
}
