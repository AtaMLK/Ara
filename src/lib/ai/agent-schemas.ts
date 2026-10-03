import { z } from 'zod';

const documentQualityFlagSchema = z.union([
  z.string(),
  z.object({
    code: z.string().optional(),
    flag: z.string().optional(),
    type: z.string().optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
  }).transform((value) =>
    value.code ?? value.flag ?? value.type ?? value.reason ?? value.message ?? 'UNKNOWN',
  ),
]);

const documentRequirementSchema = z.object({
  type: z.string().optional().default('other').transform((value) => {
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const aliases: Record<string, 'product'|'model_part_number'|'quantity'|'specification'|'delivery'|'other'> = {
      product: 'product',
      product_name: 'product',
      item: 'product',
      part: 'product',
      part_name: 'product',
      model: 'model_part_number',
      model_number: 'model_part_number',
      part_number: 'model_part_number',
      part_no: 'model_part_number',
      mpn: 'model_part_number',
      quantity: 'quantity',
      qty: 'quantity',
      specification: 'specification',
      specs: 'specification',
      technical_specification: 'specification',
      delivery: 'delivery',
      delivery_time: 'delivery',
      lead_time: 'delivery',
      other: 'other',
    };
    return aliases[normalized] ?? 'other';
  }),
  value: z.coerce.string().min(1),
  sourceRef: z.string().optional(),
});

export const documentOutputSchema = z.object({
  extractedText: z.string().default(''),
  extractedData: z.record(z.string(), z.unknown()).default({}),
  qualityFlags: z.array(documentQualityFlagSchema).default([]),
  requirements: z.array(documentRequirementSchema).default([]),
});

const intakeRequirementSchema = z.object({
  type: z.string().optional().default('other').transform((value) => {
    const normalized = value.trim().toLowerCase().replace(/[\\s-]+/g, '_');
    const aliases: Record<string, 'product'|'model_part_number'|'quantity'|'specification'|'delivery'|'other'> = {
      product: 'product',
      product_name: 'product',
      item: 'product',
      part: 'product',
      part_name: 'product',
      model: 'model_part_number',
      model_number: 'model_part_number',
      part_number: 'model_part_number',
      part_no: 'model_part_number',
      mpn: 'model_part_number',
      quantity: 'quantity',
      qty: 'quantity',
      specification: 'specification',
      specs: 'specification',
      technical_specification: 'specification',
      delivery: 'delivery',
      delivery_time: 'delivery',
      lead_time: 'delivery',
      other: 'other',
    };
    return aliases[normalized] ?? 'other';
  }),
  value: z.coerce.string().min(1),
  source: z.string().optional().default('customer_text').transform((value) => {
    const normalized = value.trim().toLowerCase().replace(/[\\s-]+/g, '_');
    if (normalized === 'customer' || normalized === 'customer_text' || normalized === 'text') return 'customer_text' as const;
    if (normalized === 'pdf' || normalized === 'document') return 'pdf' as const;
    if (normalized === 'excel' || normalized === 'spreadsheet' || normalized === 'csv') return 'excel' as const;
    if (normalized === 'image' || normalized === 'photo') return 'image' as const;
    if (normalized === 'clarification' || normalized === 'clarified') return 'clarification' as const;
    return 'customer_text' as const;
  }),
  sourceRef: z.coerce.string().optional(),
});

export const intakeOutputSchema = z.object({
  title: z.coerce.string().min(1).default('Customer inquiry'),
  description: z.coerce.string().min(1).default('Customer inquiry details extracted from the supplied request.'),
  requirements: z.array(intakeRequirementSchema).default([]),
  ambiguities: z.array(z.object({
    requirementType: z.coerce.string().default('other'),
    reason: z.coerce.string().min(1),
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
    discountType: z.enum(['percent','amount']).optional(),
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
