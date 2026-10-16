export function quantityUnit(...values:unknown[]):string {
  for(const value of values){
    if(typeof value!=='string')continue;
    const text=value.trim();if(!text)continue;
    const match=text.match(/(?:^|\b)(pcs?|pieces?|units?|adet|mm|cm|kg|mg|grams?|kilograms?|metres?|meters?|litres?|liters?|m|g|l)(?:\b|$)/i);
    if(match){const unit=match[1].toLowerCase();return /^(pcs?|pieces?|units?|adet)$/.test(unit)?'pcs':/^(grams?)$/.test(unit)?'g':/^(kilograms?)$/.test(unit)?'kg':/^(metres?|meters?)$/.test(unit)?'m':/^(litres?|liters?)$/.test(unit)?'l':unit;}
    if(/^[a-zA-Zµμ²³/]{1,12}$/.test(text))return text;
  }
  return '';
}
