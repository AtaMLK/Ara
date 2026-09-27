import { z } from 'zod';

export const documentOutputSchema = z.object({
  extractedText: z.string().default(''),
  extractedData: z.record(z.string(), z.unknown()).default({}),
  qualityFlags: z.array(z.string()).default([]),
  requirements: z.array(z.object({
    type: z.enum(['product','model_part_number','quantity','specification','delivery','other']),
    value: z.string().min(1),
    sourceRef: z.string().optional(),
  })).default([]),
});

export const intakeOutputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  requirements: z.array(z.object({
    type: z.enum(['product','model_part_number','quantity','specification','delivery','other']),
    value: z.string().min(1),
    source: z.enum(['customer_text','pdf','excel','image','clarification']),
    sourceRef: z.string().optional(),
  })),
  ambiguities: z.array(z.object({
    requirementType: z.string(),
    reason: z.string().min(1),
  })).default([]),
});

export const clarificationOutputSchema = z.object({
  needsClarification: z.boolean(),
  questions: z.array(z.object({
    requirementId: z.string().uuid().optional(),
    question: z.string().min(1),
    reason: z.string().min(1),
  })).max(5),
});

export const supplierDiscoveryOutputSchema = z.object({
  candidates: z.array(z.object({
    name: z.string().min(1),
    country: z.string().optional(),
    website: z.string().url().optional(),
    evidence: z.array(z.string()).default([]),
  })),
});

export const supplierVerificationOutputSchema = z.object({
  status: z.enum(['pending','verified','rejected']),
  explanation: z.string().min(1),
  evidence: z.array(z.string()).min(1),
});

export const quoteExtractionOutputSchema = z.object({
  quotes: z.array(z.object({
    productId: z.string().uuid().optional(),
    matchStatus: z.enum(['match','partial_match','mismatch','unknown']),
    currency: z.string().length(3).optional(),
    quantity: z.number().nonnegative().optional(),
    moq: z.number().nonnegative().optional(),
    listPrice: z.number().nonnegative().optional(),
    discount: z.number().nonnegative().optional(),
    netPrice: z.number().nonnegative().optional(),
    vat: z.number().nonnegative().optional(),
    grossPrice: z.number().nonnegative().optional(),
    validityFrom: z.string().optional(),
    validUntil: z.string().optional(),
    availability: z.string().optional(),
    leadTimeText: z.string().optional(),
    paymentTerms: z.string().optional(),
    incoterm: z.string().optional(),
    deliveryMethod: z.string().optional(),
    conditions: z.array(z.object({
      type: z.string().min(1),
      text: z.string().min(1),
      deadline: z.string().optional(),
      stackable: z.boolean().optional(),
    })).default([]),
    priceTiers: z.array(z.object({
      minQuantity: z.number().nonnegative().optional(),
      maxQuantity: z.number().nonnegative().optional(),
      unitPrice: z.number().nonnegative(),
      currency: z.string().length(3),
      conditionText: z.string().optional(),
    })).default([]),
    uncertainties: z.array(z.string()).default([]),
    originalData: z.record(z.string(),z.unknown()).default({}),
  })),
});

export const comparisonOutputSchema = z.object({
  comparisons: z.array(z.object({
    supplierResponseId: z.string().uuid(),
    findings: z.array(z.object({
      requirementId: z.string().uuid(),
      supplierQuoteId: z.string().uuid().optional(),
      status: z.enum(['match','partial_match','mismatch','unknown']),
      evidence: z.string().min(1),
    })),
  })),
});

export const customerQuoteOutputSchema = z.object({
  lines: z.array(z.object({
    supplierQuoteId: z.string().uuid(),
    productId: z.string().uuid().optional(),
    quantity: z.number().positive(),
    requirementIds: z.array(z.string().uuid()).default([]),
    reason: z.string().min(1),
  })).default([]),
  warnings: z.array(z.string()).default([]),
});

export const reportingOutputSchema = z.object({
  summary: z.string().min(1),
  facts: z.array(z.string()).default([]),
  openIssues: z.array(z.string()).default([]),
});
