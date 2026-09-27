import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireInquiryAccess} from '../guards';

const updateSchema=z.object({inquiryId:z.string().uuid(),title:z.string().min(1).optional(),description:z.string().optional(),expectedVersion:z.number().int().positive().optional()});

export async function getInquiry(ctx:AIContext,inquiryId:string){
  const {supabase}=await requireInquiryAccess(ctx,inquiryId);
  const {data,error}=await supabase.from('inquiries').select('*').eq('id',inquiryId).single();
  if(error||!data) throw new ToolError('NOT_FOUND','Inquiry not found');
  return data;
}

export async function updateInquiryTitleDescription(ctx:AIContext,input:unknown){
  const value=updateSchema.parse(input);
  const {supabase,inquiry}=await requireInquiryAccess(ctx,value.inquiryId);
  if(value.expectedVersion&&inquiry.current_version!==value.expectedVersion) throw new ToolError('CONFLICT','Inquiry changed since agent read it');
  const patch:any={current_version:inquiry.current_version+1};
  if(value.title!==undefined) patch.title=value.title;
  if(value.description!==undefined) patch.description=value.description;
  const {data,error}=await supabase.from('inquiries').update(patch).eq('id',value.inquiryId).eq('current_version',inquiry.current_version).select('*').single();
  if(error||!data) throw new ToolError('CONFLICT','Inquiry update conflict');
  return data;
}
