import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireInquiryAccess,requireAdmin} from '../guards';

const candidateSchema=z.object({inquiryId:z.string().uuid(),proposedName:z.string().min(1),proposedCountry:z.string().optional(),proposedWebsite:z.string().url().optional(),matchEvidence:z.record(z.string(),z.unknown()).default({}),availabilityEvidence:z.record(z.string(),z.unknown()).default({}),verificationEvidence:z.record(z.string(),z.unknown()).default({})});
const verificationSchema=z.object({supplierId:z.string().uuid(),status:z.enum(['unverified','pending','verified','rejected']),reason:z.string().optional(),explanation:z.string().optional(),evidence:z.record(z.string(),z.unknown()).default({})});

export async function getSupplier(ctx:AIContext,supplierId:string){
  const {supabase}=await requireAdmin();
  const {data,error}=await supabase.from('suppliers').select('*').eq('id',supplierId).single();
  if(error||!data) throw new ToolError('NOT_FOUND','Supplier not found');
  return data;
}

export async function createSupplierCandidate(ctx:AIContext,input:unknown){
  const value=candidateSchema.parse(input);
  const {supabase}=await requireInquiryAccess(ctx,value.inquiryId);
  const {data,error}=await supabase.from('supplier_candidates').insert({
    inquiry_id:value.inquiryId,proposed_name:value.proposedName,proposed_country:value.proposedCountry,
    proposed_website:value.proposedWebsite,match_evidence:value.matchEvidence,
    availability_evidence:value.availabilityEvidence,verification_evidence:value.verificationEvidence
  }).select('*').single();
  if(error) throw new ToolError('CONFLICT',error.message);
  return data;
}

export async function verifySupplier(ctx:AIContext,input:unknown){
  const value=verificationSchema.parse(input);
  const {supabase}=await requireAdmin();
  if(value.status==='verified' && Object.keys(value.evidence).length===0) throw new ToolError('VALIDATION','Verified supplier requires evidence');
  const {data:current,error:readError}=await supabase.from('suppliers').select('verification_status').eq('id',value.supplierId).single();
  if(readError||!current) throw new ToolError('NOT_FOUND','Supplier not found');
  const {data,error}=await supabase.from('suppliers').update({verification_status:value.status,last_verified_at:value.status==='verified'?new Date().toISOString():null}).eq('id',value.supplierId).select('*').single();
  if(error||!data) throw new ToolError('CONFLICT','Supplier verification update failed');
  await supabase.from('supplier_verification_history').insert({
    supplier_id:value.supplierId,old_status:current.verification_status,new_status:value.status,
    reason:value.reason,explanation:value.explanation,agent_id:ctx.agentId
  });
  return data;
}
