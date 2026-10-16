import tr from './tr.json';

export type Locale='en'|'tr';
export const localeCookie='arat-language';
const dictionary=tr as Record<string,string>;
const folded=new Map(Object.entries(dictionary).map(([key,value])=>[key.toLowerCase(),value]));
export function validLocale(value:unknown):Locale{return value==='tr'?'tr':'en';}
export function translate(locale:Locale,text:string):string {
  if(locale==='en')return text;
  const key=text.replace(/\s+/g,' ').trim();
  const translated=dictionary[key]??folded.get(key.toLowerCase());
  if(!translated){
    const activity=key.match(/^View all activity · (\d+) events$/);
    if(activity)return `Tüm hareketleri gör · ${activity[1]} kayıt`;
    const count=key.match(/^(\d+) (prices confirmed|products|candidates|events)$/);
    if(count)return `${count[1]} ${translate(locale,count[2])}`;
    const required=key.match(/^Please complete Product Description and Quantity for item (\d+)\.$/);
    if(required)return `${required[1]}. ürünün açıklamasını ve miktarını doldurun.`;
    const created=key.match(/^Customer created\. Code: (.+)$/);
    if(created)return `Müşteri oluşturuldu. Kod: ${created[1]}`;
    const sent=key.match(/^Sent successfully to (.+)\.$/);
    if(sent)return `${sent[1]} adresine başarıyla gönderildi.`;
    const emails=key.match(/^(\d+) supplier emails were sent successfully\.$/);
    if(emails)return `${emails[1]} tedarikçi e-postası başarıyla gönderildi.`;
    const offer=key.match(/^Choose (only one supplier offer|an offer) for (.+)\.$/);
    if(offer)return `${offer[2]} için ${offer[1]==='an offer'?'bir teklif':'yalnızca bir tedarikçi teklifi'} seçin.`;
  }
  return translated?text.replace(text.trim(),translated):text;
}
