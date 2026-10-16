import {readableRequest} from './inquiry-items';

export type CustomerRequestPart = {message:string;details:Array<{label:string;value:string}>};

// Only unwrap the exact format produced by the inquiry form. Free-form emails
// remain verbatim; this is presentation, never a rewrite of the customer's words.
export function customerRequestParts(value:string):CustomerRequestPart[] {
  const text=readableRequest(value).trim();
  const fallback=[{message:text,details:[]}];
  if(!/^Item 1\r?\nDescription: /.test(text))return fallback;
  const [items,extra]=text.split(/\r?\n\r?\nAdditional product list \/ customer text:\r?\n/);
  const blocks=items.split(/\r?\n\r?\n(?=Item \d+\r?\nDescription: )/);
  const parts:CustomerRequestPart[]=[];
  for(const [index,block] of blocks.entries()) {
    const match=block.match(/^Item (\d+)\r?\nDescription: ([\s\S]*)\r?\nQuantity: ([^\r\n]+)((?:\r?\n(?:Brand \/ Manufacturer|Part Number \/ Model|Serial Number|Additional details): [\s\S]*)?)$/);
    if(!match||Number(match[1])!==index+1)return fallback;
    const details=[{label:'Quantity',value:match[3]}];
    const labels:Record<string,string>={'Brand / Manufacturer':'Manufacturer','Part Number / Model':'Model / part number','Serial Number':'Serial number','Additional details':'Additional details'};
    const fields=match[4].matchAll(/\r?\n(Brand \/ Manufacturer|Part Number \/ Model|Serial Number|Additional details): ([\s\S]*?)(?=\r?\n(?:Brand \/ Manufacturer|Part Number \/ Model|Serial Number|Additional details): |$)/g);
    for(const field of fields)details.push({label:labels[field[1]],value:field[2].trim()});
    parts.push({message:match[2].trim(),details});
  }
  if(extra?.trim())parts.push({message:extra.trim(),details:[]});
  return parts;
}
