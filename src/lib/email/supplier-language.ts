import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
export type SupplierLanguage='tr'|'en';
// Ignore quoted history, headers and signatures: they must not switch language.
export function detectSupplierLanguage(body:string):SupplierLanguage|null {
  const own=body.replace(/<br\s*\/?>|<\/p>/gi,'\n').replace(/<[^>]+>/g,' ').split(/\n\s*(?:On .+wrote:|From:|Kimden:|[-_]{3,}|--\s*$)/im)[0].split('\n').filter(line=>!line.trim().startsWith('>')).join(' ').toLocaleLowerCase('tr').replaceAll('ı','i');
  const tr=(own.match(/\b(?:merhaba|lütfen|lutfen|teklif|fiyat|teslim|termin|miktar|bilgi|rica|teşekkür|sipariş|siparis|hafta|gün|gun|saygılar|saygilar)\b/g)||[]).length;
  const en=(own.match(/\b(?:hello|dear|please|kindly|quotation|price|delivery|quantity|information|thanks|regards|weeks|days|confirm)\b/g)||[]).length;
  return tr>=2&&tr>en?'tr':en>=2&&en>tr?'en':null;
}
export async function getSupplierLanguage(supplierId:string):Promise<SupplierLanguage> {
  const db=createSupabaseAdminClient();
  const {data:supplier,error}=await db.from('suppliers').select('communication_language,primary_country').eq('id',supplierId).maybeSingle();
  if(error)throw new Error('Supplier correspondence language could not be loaded.');
  if(supplier?.communication_language==='tr'||supplier?.communication_language==='en')return supplier.communication_language;
  const {data:messages,error:historyError}=await db.from('communications').select('direction,body,metadata,created_at').eq('supplier_id',supplierId).order('created_at',{ascending:false}).limit(100);
  if(historyError)throw new Error('Supplier correspondence history could not be loaded.');
  const history=[...(messages??[])].sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??''))).reverse();
  let language:SupplierLanguage|null=null;
  for(const message of history){
    if(message.metadata?.send_failed)continue;
    if(message.direction==='incoming')language=detectSupplierLanguage(message.body||'');
    else if(['tr','en'].includes(message.metadata?.language))language=message.metadata.language;
    if(language)break;
  }
  language??=/^(turkey|türkiye|turkiye|tr)$/i.test(supplier?.primary_country||'')?'tr':'en';
  const {error:saveError}=await db.from('suppliers').update({communication_language:language}).eq('id',supplierId);
  if(saveError)throw new Error('Supplier correspondence language could not be saved.');
  return language;
}
export async function recordSupplierReplyLanguage(supplierId:string,body:string){
  const language=detectSupplierLanguage(body);if(!language)return;
  const {error}=await createSupabaseAdminClient().from('suppliers').update({communication_language:language}).eq('id',supplierId);
  if(error)throw new Error('Supplier reply language could not be saved.');
}
export function supplierReplyMessage(language:SupplierLanguage,reply:string){
  const text=(language==='tr'?'Merhaba,\n\n':'Hello,\n\n')+reply+(language==='tr'?'\n\nİyi çalışmalar,\nArya Automation':'\n\nBest regards,\nArya Automation');
  const html='<div style="white-space:pre-wrap">'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</div>';
  return {html,text};
}
