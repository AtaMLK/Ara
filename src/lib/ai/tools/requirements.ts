import {createRequirementSchema,updateRequirementSchema} from '@/lib/ai/schemas';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireInquiryAccess} from '../guards';

export async function listRequirements(ctx:AIContext,inquiryId:string){
  const {supabase}=await requireInquiryAccess(ctx,inquiryId);
  const {data,error}=await supabase.from('requirements').select('*').eq('inquiry_id',inquiryId).order('created_at');
  if(error) throw new ToolError('TRANSIENT',error.message);
  return data;
}

export async function createRequirement(ctx:AIContext,input:unknown){
  const value=createRequirementSchema.parse(input);
  const {supabase}=await requireInquiryAccess(ctx,value.inquiryId);
  const {data,error}=await supabase.from('requirements').insert({inquiry_id:value.inquiryId,type:value.type,value:value.value,source:value.source,source_ref:value.sourceRef,admin_edited:false}).select('*').single();
  if(error) throw new ToolError('CONFLICT',error.message);
  return data;
}

export async function updateRequirement(ctx:AIContext,input:unknown){
  const value=updateRequirementSchema.parse(input);
  const {supabase}=await requireInquiryAccess(ctx,ctx.inquiryId!);
  const {data:current,error:readError}=await supabase.from('requirements').select('*').eq('id',value.requirementId).single();
  if(readError||!current) throw new ToolError('NOT_FOUND','Requirement not found');
  if(value.expectedVersion&&current.current_version!==value.expectedVersion) throw new ToolError('CONFLICT','Requirement changed since agent read it');
  if(current.admin_edited) throw new ToolError('AUTHORIZATION','Admin-edited Requirement is authoritative');
  const patch:any={current_version:current.current_version+1};
  if(value.value!==undefined) patch.value=value.value;
  if(value.status!==undefined) patch.status=value.status;
  const {data,error}=await supabase.from('requirements').update(patch).eq('id',value.requirementId).eq('current_version',current.current_version).select('*').single();
  if(error||!data) throw new ToolError('CONFLICT','Requirement update conflict');
  return data;
}
