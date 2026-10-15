import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import type {QuoteCompany} from './document';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export type CompanyProfile={name:string;email:string;address:string;phone:string;website:string;taxDetails:string;logoPath?:string};
export async function getCompanyProfile():Promise<CompanyProfile> {
  const {data,error}=await createSupabaseAdminClient().from('app_settings').select('value').eq('key','quote_company').maybeSingle();
  if(error)throw new Error('Company quotation profile could not be loaded.');
  const v=(data?.value??{}) as Partial<CompanyProfile>;
  return {name:v.name||'Arya Automation',email:v.email||process.env.EMAIL_FROM||process.env.SMTP_FROM||'',address:v.address||'',phone:v.phone||'',website:v.website||'',taxDetails:v.taxDetails||'',logoPath:v.logoPath||(existsSync(join(process.cwd(),'public/branding/arya-logo.png'))?'bundled:arya-logo':undefined)};
}
export async function getQuoteCompany():Promise<QuoteCompany> {
  const profile=await getCompanyProfile();
  const company:QuoteCompany={...profile};
  if(profile.logoPath?.startsWith('company/branding/')) {
    const {data,error}=await createSupabaseAdminClient().storage.from('supplier-email-attachments').download(profile.logoPath);
    if(error||!data)throw new Error('Company logo could not be loaded; update it in Settings.');
    company.logo=new Uint8Array(await data.arrayBuffer());company.logoType=profile.logoPath.endsWith('.jpg')?'image/jpeg':'image/png';
  } else if(profile.logoPath==='bundled:arya-logo') {
    company.logo=new Uint8Array(await readFile(join(process.cwd(),'public/branding/arya-logo.png')));company.logoType='image/png';
  }
  return company;
}
