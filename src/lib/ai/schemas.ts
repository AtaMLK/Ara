import {z} from 'zod';
export const uuidSchema=z.string().uuid();
export const requirementTypeSchema=z.enum(['product','model_part_number','quantity','specification','delivery','other']);
export const requirementStatusSchema=z.enum(['open','clarification_required','confirmed','rejected']);
export const requirementSourceSchema=z.enum(['customer_text','pdf','excel','image','clarification']);
export const createRequirementSchema=z.object({inquiryId:uuidSchema,type:requirementTypeSchema,value:z.string().min(1),source:requirementSourceSchema,sourceRef:z.string().optional()});
export const updateRequirementSchema=z.object({requirementId:uuidSchema,value:z.string().min(1).optional(),status:requirementStatusSchema.optional(),reason:z.string().optional(),expectedVersion:z.number().int().positive().optional()}).refine(v=>v.value!==undefined||v.status!==undefined,{message:'At least one change is required'});
