import {createSupabaseServerClient} from '@/lib/supabase/server';
import {ToolError} from '@/lib/errors';
import type {AIContext} from './context';
import {redirect,notFound} from 'next/navigation';

export async function requireAdmin(){
  const supabase=await createSupabaseServerClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) throw new ToolError('AUTHORIZATION','Authentication required');
  const {data:profile}=await supabase.from('profiles').select('role,status').eq('user_id',user.id).single();
  if(profile?.role!=='admin'||profile.status!=='active') throw new ToolError('AUTHORIZATION','Admin access required');
  return {supabase,user};
}

export async function requireInquiryAccess(ctx:AIContext,inquiryId:string){
  const {supabase}=await requireAdmin();
  const {data:inquiry,error}=await supabase.from('inquiries').select('id,customer_id,status,current_version').eq('id',inquiryId).single();
  if(error||!inquiry) throw new ToolError('NOT_FOUND','Inquiry not found');
  if(ctx.inquiryId&&ctx.inquiryId!==inquiryId) throw new ToolError('AUTHORIZATION','Agent context does not permit this Inquiry');
  return {supabase,inquiry};
}


export async function requireCustomerAccess() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ToolError('AUTHORIZATION', 'Authentication required');
  const { data: profile } = await supabase.from('profiles').select('role,status').eq('user_id', user.id).single();
  if (profile?.role !== 'customer' || profile.status !== 'active') throw new ToolError('AUTHORIZATION', 'Customer access required');
  const { data: customer } = await supabase.from('customers').select('id,status,customer_code,name,company_name').eq('user_id', user.id).single();
  if (!customer || customer.status !== 'active') throw new ToolError('AUTHORIZATION', 'Customer account is inactive');
  return { supabase, user, customer };
}

export async function requireCustomerInquiryAccess(inquiryId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ToolError('AUTHORIZATION', 'Authentication required');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role,status')
    .eq('user_id', user.id)
    .single();

  if (profile?.role !== 'customer' || profile.status !== 'active') {
    throw new ToolError('AUTHORIZATION', 'Customer access required');
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('id,status')
    .eq('user_id', user.id)
    .single();

  if (!customer || customer.status !== 'active') {
    throw new ToolError('AUTHORIZATION', 'Customer account is inactive');
  }

  const { data: inquiry, error } = await supabase
    .from('inquiries')
    .select('id,customer_id,status,current_version')
    .eq('id', inquiryId)
    .eq('customer_id', customer.id)
    .single();

  if (error || !inquiry) throw new ToolError('NOT_FOUND', 'Inquiry not found');
  return { supabase, user, inquiry };
}

export async function requireCustomerInquiryPageAccess(inquiryId:string,returnPath='/customer/inquiries/'+inquiryId) {
  const db=await createSupabaseServerClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user) redirect('/login?next='+encodeURIComponent(returnPath));
  const {data:profile}=await db.from('profiles').select('role,status').eq('user_id',user.id).single();
  if(profile?.role==='admin'&&profile.status==='active') redirect('/inquiries/'+inquiryId);
  try{return await requireCustomerInquiryAccess(inquiryId);}
  catch(error){if(error instanceof ToolError&&(error.code==='AUTHORIZATION'||error.code==='NOT_FOUND'))notFound();throw error;}
}
