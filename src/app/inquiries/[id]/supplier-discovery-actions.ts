'use server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/ai/guards';
import { reviewNextSupplierBatch } from '@/lib/ai/workflow';
import { getSupplierReviewProgress } from '@/lib/ai/supplier-review';
import { revalidatePath } from 'next/cache';
export async function loadMoreSupplierCandidatesAction(input:{inquiryId:string;requirementId:string}) {
  await requireAdmin();
  const value=z.object({inquiryId:z.string().uuid(),requirementId:z.string().uuid()}).parse(input);
  await reviewNextSupplierBatch(value.inquiryId,value.requirementId);
  const progress=await getSupplierReviewProgress(value.inquiryId);
  revalidatePath(`/inquiries/${value.inquiryId}`);
  return progress[value.requirementId] ?? {limit:5,hasMore:false};
}
