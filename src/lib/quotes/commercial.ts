export type TaxMode = 'unknown' | 'excluded' | 'included' | 'exempt';
export type Delivery = { original: string; min: number | null; max: number | null; unit: 'days' | 'weeks' | 'months' | 'stock' | 'unknown'; businessDays: boolean };
export type SupplierCommercial = {
  net: number | null; gross: number | null; taxAmount: number | null;
  quotedNet?: number | null; quotedGross?: number | null;
  taxRate: number | null; taxMode: TaxMode; taxText: string;
  delivery: Delivery; warnings: string[];
};

const words: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9,
  on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90,
};
function plain(text: string) {
  return text.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
export function parseDelivery(original = ''): Delivery {
  let text = plain(original);
  // Preserve words and ranges in the source; normalize supported explicit numbers only.
  const numberWord = Object.keys(words).join('|') + '|hundred|thousand|yuz|bin';
  const phrasePattern = new RegExp('\\b(?:'+numberWord+')(?:[ -]+(?:'+numberWord+'|and))*\\b','g');
  text = text.replace(phrasePattern, phrase => {
    let value=0, total=0;
    for(const word of phrase.split(/[ -]+/)) {
      if(word==='and') continue;
      if(word==='hundred'||word==='yuz') value=(value||1)*100;
      else if(word==='thousand'||word==='bin') { total+=(value||1)*1000; value=0; }
      else value+=words[word]??0;
    }
    return String(total+value);
  });
  const result: Delivery = { original, min: null, max: null, unit: 'unknown', businessDays: /business|working|is gun/.test(text) };
  const unavailable = /\b(not in stock|out of stock|no stock|stokta yok|stok yok|stokta degil)\b/.test(text);
  if (!unavailable && /\b(in stock|ex stock|stokta|hemen teslim|immediate delivery)\b/.test(text)) return { ...result, min: 0, max: 0, unit: 'stock' };
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:(?:-|–|—|to|ila|ile)\s*(\d+(?:[.,]\d+)?))?\s*(?:(?:business|working|is)\s+)?(days?|weeks?|months?|gun\w*|hafta\w*|ay)\b/);
  if (!match) return result;
  const min = Number(match[1].replace(',', '.')), max = Number((match[2] ?? match[1]).replace(',', '.'));
  if (max < min) return result;
  return { ...result, min, max, unit: /^(day|gun)/.test(match[3]) ? 'days' : /^(week|hafta)/.test(match[3]) ? 'weeks' : 'months' };
}

export function supplierCommercial(input: {
  netPrice?: number | null; grossPrice?: number | null; taxRate?: number | null;
  taxMode?: TaxMode | null; taxText?: string | null; leadTimeText?: string | null;
}): SupplierCommercial {
  const taxText = input.taxText ?? '';
  const normalized = plain(taxText);
  const before = normalized.match(/%\s*(\d+(?:[.,]\d+)?)\s*(?:kdv|vat|tax)/);
  const after = normalized.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:kdv|vat|tax)/);
  const named = normalized.match(/(?:kdv|vat|tax)\s*(?:rate\s*)?[:=]?\s*%\s*(\d+(?:[.,]\d+)?)/)
    ?? normalized.match(/(?:kdv|vat|tax)\s*(?:rate\s*)?[:=]?\s*(\d+(?:[.,]\d+)?)\s*%/);
  const rateMatch = before ?? after ?? named;
  let taxRate = input.taxRate ?? (rateMatch ? Number(rateMatch[1].replace(',', '.')) : null);
  let taxMode = input.taxMode ?? 'unknown';
  if (taxMode === 'unknown') {
    if (/exempt|tax free|kdv muaf/.test(normalized)) taxMode = 'exempt';
    else if (/excluded|excluding|\+\s*(?:%?\d+(?:[.,]\d+)?\s*%?\s*)?(?:kdv|vat|tax)|haric/.test(normalized)) taxMode = 'excluded';
    else if (/included|including|dahil/.test(normalized)) taxMode = 'included';
  }
  const money = (n: number) => Math.round((n + Number.EPSILON) * 1000000) / 1000000;
  let net = input.netPrice ?? null, gross = input.grossPrice ?? null;
  const warnings: string[] = [];
  if (taxRate != null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)) throw new Error('Tax rate must be between 0 and 100.');
  if (taxMode === 'exempt') { gross ??= net; net ??= gross; taxRate=0; }
  else if (taxRate != null) {
    if (net != null && gross == null) gross = money(net * (1 + taxRate / 100));
    else if (gross != null && net == null) net = money(gross / (1 + taxRate / 100));
    else if (net != null && gross != null && Math.abs(gross - net * (1 + taxRate / 100)) > 0.02) warnings.push('Supplier net, gross and tax rate conflict; review the original quote.');
  }
  if (taxMode === 'unknown') warnings.push('Supplier tax treatment is not stated.');
  if (taxMode !== 'unknown' && taxMode !== 'exempt' && taxRate == null && (net == null || gross == null)) warnings.push('Tax/KDV rate is missing; the tax-inclusive supplier total cannot be calculated.');
  const delivery = parseDelivery(input.leadTimeText ?? '');
  if (delivery.unit === 'unknown') warnings.push('Delivery needs review; original supplier wording is preserved.');
  return { net, gross, quotedNet:input.netPrice??null, quotedGross:input.grossPrice??null, taxAmount: net != null && gross != null ? money(gross - net) : null, taxRate, taxMode, taxText, delivery, warnings };
}

export function reviewSupplierTax(source: SupplierCommercial, taxMode: TaxMode, taxRate: number|null) {
  if(source.taxMode===taxMode&&source.taxRate===taxRate) return source;
  const net=source.quotedNet??source.net, gross=source.quotedGross??(source.quotedNet==null?source.gross:null);
  // An Admin correction from '+ tax' to 'included' changes how the quoted
  // amount is interpreted; it must not add the same tax to it again.
  return supplierCommercial({
    netPrice:taxMode==='included'?undefined:net??gross,
    grossPrice:taxMode==='included'?gross??net:undefined,
    taxRate,taxMode,taxText:'',leadTimeText:source.delivery.original,
  });
}

// An explicit Admin interpretation of an ambiguous supplier amount. Keep the
// extraction snapshot untouched so corrections remain distinguishable from facts.
export function reviewSupplierAmount(source: SupplierCommercial, review: {amount:number;basis:'net'|'gross'}) {
  if (!Number.isFinite(review.amount) || review.amount < 0) throw new Error('Enter a valid supplier amount.');
  return supplierCommercial({
    netPrice:review.basis==='net'?review.amount:undefined,
    grossPrice:review.basis==='gross'?review.amount:undefined,
    taxMode:source.taxMode,taxRate:source.taxRate,taxText:source.taxText,leadTimeText:source.delivery.original,
  });
}

export type PriceControls = {
  quantity: number; basis: 'net' | 'gross'; markupPercent: number | null;
  deliveryCost: number; deliveryAllocation: 'per_unit' | 'per_line';
  markupOn: 'goods' | 'landed'; rounding: number; exchangeRate: number | null;
};
export function pricePreview(commercial: SupplierCommercial, control: PriceControls) {
  const base = control.basis === 'net' ? commercial.net : commercial.gross;
  if (base == null || control.markupPercent == null || control.exchangeRate == null) return null;
  if (![base, control.quantity, control.markupPercent, control.deliveryCost, control.rounding, control.exchangeRate].every(Number.isFinite) || control.quantity <= 0 || control.exchangeRate <= 0 || control.markupPercent < 0 || control.deliveryCost < 0 || control.rounding < 0) throw new Error('Invalid pricing inputs.');
  const converted = base * control.exchangeRate;
  const deliveryPerUnit = control.deliveryAllocation === 'per_line' ? control.deliveryCost / control.quantity : control.deliveryCost;
  const unrounded = control.markupOn === 'landed'
    ? (converted + deliveryPerUnit) * (1 + control.markupPercent / 100)
    : converted * (1 + control.markupPercent / 100) + deliveryPerUnit;
  const rounded = control.rounding ? Math.ceil((unrounded - 1e-9) / control.rounding) * control.rounding : unrounded;
  const unitPrice = Math.round((rounded + Number.EPSILON) * 100) / 100;
  return { base, converted, deliveryPerUnit, unitPrice, total: Math.round(unitPrice * control.quantity * 100) / 100 };
}
