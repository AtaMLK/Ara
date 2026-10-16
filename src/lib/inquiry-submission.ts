import {z} from 'zod';

const itemSchema=z.object({
  description:z.string().trim().min(1).max(5000),quantity:z.coerce.number().positive(),
  unit:z.string().trim().max(40).default(''),brand:z.string().trim().max(500).default(''),
  partNumber:z.string().trim().max(500).default(''),serialNumber:z.string().trim().max(500).default(''),details:z.string().trim().max(5000).default(''),
});
export type InquiryEntryMode='manual'|'list'|'file';
export function prepareInquirySource(input:{entryMode:InquiryEntryMode;itemsJson:string;originalCustomerText:string;fileCount:number}){
  const raw:unknown=JSON.parse(input.itemsJson);
  // The selected source is authoritative. Stale hidden form rows are not items.
  const items=input.entryMode==='manual'?z.array(itemSchema).min(1).max(100).parse(raw):[];
  const text=input.originalCustomerText.trim();
  if(input.entryMode==='list'&&!text)throw new Error('Paste your request or item list before submitting.');
  if(input.entryMode==='file'&&!input.fileCount)throw new Error('Upload at least one file containing your request.');
  const structured=items.map((item,index)=>[
    `Item ${index+1}`,`Description: ${item.description}`,`Quantity: ${item.quantity}${item.unit?' '+item.unit:''}`,
    item.brand?`Brand / Manufacturer: ${item.brand}`:null,item.partNumber?`Part Number / Model: ${item.partNumber}`:null,
    item.serialNumber?`Serial Number: ${item.serialNumber}`:null,item.details?`Additional details: ${item.details}`:null,
  ].filter(Boolean).join('\n')).join('\n\n');
  const originalText=items.length?[structured,text?`Additional product list / customer text:\n${text}`:''].filter(Boolean).join('\n\n'):text;
  if(originalText.length>120000)throw new Error('The request is too long. Upload a file or shorten the item descriptions.');
  return {items,originalText};
}
