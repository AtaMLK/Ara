'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/ai/guards';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {getCompanyProfile} from '@/lib/quotes/company';
export async function saveQuoteCompanyAction(form:FormData) {
  const {user}=await requireAdmin();
  const value=z.object({name:z.string().trim().min(1).max(180),email:z.string().email(),address:z.string().max(1000),phone:z.string().max(100),website:z.string().max(250),taxDetails:z.string().max(500)}).parse(Object.fromEntries(['name','email','address','phone','website','taxDetails'].map(key=>[key,String(form.get(key)||'')])));
  const existing=await getCompanyProfile(),db=createSupabaseAdminClient();let logoPath=existing.logoPath;
  const logo=form.get('logo');
  if(logo instanceof File&&logo.size){
    if(logo.size>2*1024*1024)throw new Error('Logo must be under 2 MB.');
    const bytes=new Uint8Array(await logo.arrayBuffer());
    const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
    const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!png&&!jpg)throw new Error('Upload a PNG or JPEG logo.');
    logoPath='company/branding/'+crypto.randomUUID()+(png?'.png':'.jpg');
    const {error}=await db.storage.from('supplier-email-attachments').upload(logoPath,bytes,{contentType:png?'image/png':'image/jpeg'});
    if(error)throw new Error('Logo upload failed: '+error.message);
  }
  const {error}=await db.from('app_settings').upsert({key:'quote_company',value:{...value,logoPath},is_secret:false,updated_by:user.id},{onConflict:'key'});
  if(error)throw new Error(error.message);
  await db.from('audit_logs').insert({actor_type:'admin',actor_user_id:user.id,action:'quote_company_profile_updated',record_type:'app_settings',before_data:existing,after_data:{...value,logoPath}});
  revalidatePath('/settings');return {ok:true};
}
