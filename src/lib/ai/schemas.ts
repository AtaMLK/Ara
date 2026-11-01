import {z} from 'zod';
export const uuidSchema=z.string().uuid();
export const notificationSchema = z.object({
  userId: uuidSchema,
  category: z.enum(['approval', 'task', 'ai_alert', 'customer', 'supplier', 'email', 'system']),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(10000),
  recordType: z.string().optional(),
  recordId: uuidSchema.optional(),
  actionUrl: z.string().startsWith('/').refine(value => !value.startsWith('//')).optional(),
});
export const timelineEventSchema = z.object({
  inquiryId: uuidSchema,
  eventType: z.string().trim().min(1).max(200),
  visibility: z.enum(['admin', 'customer']),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export const requirementTypeSchema=z.enum(['product','model_part_number','quantity','specification','delivery','other']);
export const requirementStatusSchema=z.enum(['open','clarification_required','confirmed','rejected']);
export const requirementSourceSchema=z.enum(['customer_text','pdf','excel','image','clarification']);
export const createRequirementSchema=z.object({inquiryId:uuidSchema,type:requirementTypeSchema,value:z.string().min(1),source:requirementSourceSchema,sourceRef:z.string().optional()});
export const updateRequirementSchema=z.object({requirementId:uuidSchema,value:z.string().min(1).optional(),status:requirementStatusSchema.optional(),reason:z.string().optional(),expectedVersion:z.number().int().positive().optional()}).refine(v=>v.value!==undefined||v.status!==undefined,{message:'At least one change is required'});
