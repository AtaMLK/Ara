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

const optionalIntakeText = z.preprocess(
  (value) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed || /^(null|undefined|n\/a|na)$/i.test(trimmed)) return undefined;
    return trimmed;
  },
  z.string().min(1).optional(),
);

const intakeItemSchema = z.object({
  requestedText: z.coerce.string().min(1),
  product: z.coerce.string().min(1).optional(),
  brand: optionalIntakeText,
  model: optionalIntakeText,
  partNumber: optionalIntakeText,
  quantity: z.preprocess(
    (value) => {
      if (value == null || value === '') return undefined;
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) && numeric <= 0 ? undefined : value;
    },
    z.coerce.number().positive().optional(),
  ),
  unit: z.coerce.string().min(1).optional(),
  specifications: z.array(z.coerce.string().min(1)).default([]),
  deliveryRequirement: z.coerce.string().min(1).optional(),
  confidence: z.coerce.number().min(0).max(1),
  inferredFields: z.array(z.coerce.string().transform((value) => {
    const normalized = value.trim().toLowerCase().replace(/[\\s-]+/g, '');
    const aliases: Record<string, 'product'|'brand'|'model'|'partNumber'|'quantity'|'unit'|'specification'|'delivery'> = {
      product: 'product',
      productname: 'product',
      item: 'product',
      brand: 'brand',
      manufacturer: 'brand',
      model: 'model',
      modelnumber: 'model',
      partnumber: 'partNumber',
      partno: 'partNumber',
      mpn: 'partNumber',
      quantity: 'quantity',
      qty: 'quantity',
      unit: 'unit',
      specification: 'specification',
      specifications: 'specification',
      spec: 'specification',
      specs: 'specification',
      delivery: 'delivery',
      deliverytime: 'delivery',
      leadtime: 'delivery',
    };
    return aliases[normalized] ?? 'specification';
  })).default([]),
  evidence: z.coerce.string().min(1).optional(),
});

export const intakeRepairOutputSchema = z.object({
  items: z.array(z.object({
    requestedText: z.coerce.string().min(1),
    product: z.coerce.string().min(1),
    brand: optionalIntakeText,
    model: optionalIntakeText,
    partNumber: optionalIntakeText,
    quantity: z.preprocess(
    (value) => {
      if (value == null || value === '') return undefined;
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) && numeric <= 0 ? undefined : value;
    },
    z.coerce.number().positive().optional(),
  ),
    unit: z.coerce.string().min(1).optional(),
    specifications: z.array(z.coerce.string().min(1)).default([]),
    deliveryRequirement: z.coerce.string().min(1).optional(),
    confidence: z.coerce.number().min(0).max(1),
    inferredFields: z.array(z.enum(['product','brand','model','partNumber','quantity','unit','specification','delivery'])).default([]),
    evidence: z.coerce.string().min(1),
  })).min(1),
});

export const intakeOutputSchema = z.object({
  title: z.coerce.string().min(1).default('Customer inquiry'),
  description: z.coerce.string().min(1).default('Customer inquiry details extracted from the supplied request.'),
  items: z.array(intakeItemSchema).min(1),
  ambiguities: z.array(z.union([
    z.coerce.string().min(1).transform((reason) => ({ requirementType: 'other', reason })),
    z.object({
      requirementType: z.coerce.string().default('other'),
      reason: z.coerce.string().min(1),
    }),
  ])).default([]),
});

const clarificationQuestionSchema = z.union([
  z.object({
    requirementId: z.preprocess((value) => value == null ? undefined : value, z.string().uuid().optional()),
    question: z.string().min(1),
    reason: z.string().min(1),
  }),
  z.coerce.string().min(1).transform((question) => ({
    requirementId: undefined,
    question,
    reason: question,
  })),
]);

export const clarificationOutputSchema = z.object({
  needsClarification: z.boolean(),
  questions: z.array(clarificationQuestionSchema).max(5),
});

export const clarificationRepairOutputSchema = z.object({
  needsClarification: z.boolean(),
  questions: z.array(z.object({
    requirementId: z.string().uuid(),
    question: z.string().min(1),
    reason: z.string().min(1),
  })).max(5),
});

const supplierDiscoveryCandidateSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  const name =
    record.name ??
    record.supplierName ??
    record.supplier_name ??
    record.companyName ??
    record.company_name ??
    record.legalName ??
    record.legal_name;

  const country = record.country ?? record.primaryCountry ?? record.primary_country;
  const website = record.website ?? record.supplierWebsite ?? record.supplier_website;
  const sourceUrl = record.sourceUrl ?? record.source_url ?? record.source;
  const rawMatchType = record.matchType ?? record.match_type ?? record.match;
  const normalizedMatchType = typeof rawMatchType === 'string'
    ? rawMatchType.trim().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_')
    : rawMatchType;
  const matchTypeAliases: Record<string, string> = {
    exact: 'exact_product',
    exact_match: 'exact_product',
    exact_product_match: 'exact_product',
    manufacturer: 'exact_product',
    official_manufacturer: 'exact_product',
    distributor: 'same_brand_distributor',
    brand_distributor: 'same_brand_distributor',
    same_brand: 'same_brand_distributor',
    same_brand_distribution: 'same_brand_distributor',
    similar: 'same_brand_similar',
    same_brand_similar_product: 'same_brand_similar',
    alternative: 'related_alternative',
    related: 'related_alternative',
  };
  const canonicalMatchType = typeof normalizedMatchType === 'string'
    ? normalizedMatchType
        .replace(/\([^)]*\)/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/[|/:]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .trim()
    : normalizedMatchType;
  const extendedMatchTypeAliases: Record<string, string> = {
    exact_product_supplier: 'exact_product',
    exact_product_manufacturer: 'exact_product',
    exact_product_match_supplier: 'exact_product',
    same_brand_distributor_supplier: 'same_brand_distributor',
    same_brand_distributor_match: 'same_brand_distributor',
    same_brand_or_distributor: 'same_brand_distributor',
    same_brand_or_official_distributor: 'same_brand_distributor',
    same_brand_supplier: 'same_brand_distributor',
    same_brand_similar_match: 'same_brand_similar',
    same_brand_similar_product_match: 'same_brand_similar',
    related_alternative_product: 'related_alternative',
    related_alternative_match: 'related_alternative',
  };
  const matchType = typeof canonicalMatchType === 'string'
    ? (matchTypeAliases[canonicalMatchType] ?? extendedMatchTypeAliases[canonicalMatchType]) ??
      (canonicalMatchType.includes('exact_product') ||
        canonicalMatchType.includes('exact_manufacturer') ||
        canonicalMatchType.includes('exact_model') ||
        canonicalMatchType === 'exact' ||
        canonicalMatchType.includes('manufacturer')
        ? 'exact_product'
        : canonicalMatchType.includes('same_brand_distributor') ||
          canonicalMatchType.includes('brand_distributor') ||
          canonicalMatchType.includes('official_distributor') ||
          canonicalMatchType.includes('official_representative') ||
          canonicalMatchType.includes('same_brand') ||
          canonicalMatchType.includes('distributor')
          ? 'same_brand_distributor'
          : canonicalMatchType.includes('same_brand_similar') ||
            canonicalMatchType.includes('similar_product') ||
            canonicalMatchType === 'similar'
            ? 'same_brand_similar'
            : canonicalMatchType.includes('related_alternative') ||
              canonicalMatchType.includes('alternative') ||
              canonicalMatchType === 'related'
              ? 'related_alternative'
              : undefined)
    : undefined;

  return {
    ...record,
    ...(name !== undefined ? { name } : {}),
    ...(country !== undefined ? { country } : {}),
    ...(website !== undefined ? { website } : {}),
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    ...(matchType !== undefined ? { matchType } : {}),
  };
}, z.object({
  name: z.string().optional().default(''),
  country: z.preprocess((value) => value == null ? undefined : value, z.string().optional()),
  website: z.preprocess((value) => value == null ? undefined : value, z.string().url().optional()),
  sourceUrl: z.string().url(),
  requirementId: z.string().uuid().optional(),
  matchType: z.enum(['exact_product', 'same_brand_distributor', 'same_brand_similar', 'related_alternative']).optional(),
  matchScore: z.number().min(0).max(100).optional(),
  matchNote: z.preprocess((value) => value == null ? undefined : value, z.string().optional()),
  // Some models return a single evidence sentence instead of an array.
  evidence: z.preprocess(
    (value) => typeof value === 'string' ? [value] : value,
    z.array(z.string()).default([]),
  ),
}));

export const supplierDiscoveryOutputSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  if (record.candidates !== undefined) return record;

  // Some models return the same selection under a nearby key despite being
  // instructed to use candidates. Normalize common variants instead of
  // failing the whole supplier-discovery stage.
  const aliases = ['suppliers', 'supplier_candidates', 'results'];
  const alias = aliases.find((key) => record[key] !== undefined);

  return {
    ...record,
    candidates: alias ? record[alias] : [],
  };
}, z.object({
  candidates: z.array(supplierDiscoveryCandidateSchema).default([]),
}));

const optionalContactText = z.preprocess(
  (value) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed || undefined;
  },
  z.string().min(1).optional(),
);

const optionalContactEmail = z.preprocess(
  (value) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    const email = value.trim().toLowerCase();
    if (!email || /^(n\/a|na|none|null|unknown|not available|not found|no email)$/i.test(email)) {
      return undefined;
    }
    // AI sometimes returns labels, placeholders, or otherwise malformed
    // contact values. Do not fail the whole supplier-research stage for one
    // bad contact; only persist a syntactically valid email.
    const emailPattern = /^[A-Z0-9._%+'-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$/i;
    return emailPattern.test(email) ? email : undefined;
  },
  z.string().email().optional(),
);

const optionalContactUrl = z.preprocess(
  (value) => value == null ? undefined : value,
  z.string().url().optional(),
);

const optionalEvidenceText = z.preprocess(
  (value) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed || undefined;
  },
  z.string().min(1).optional(),
);

const supplierContactEvidenceSchema = z.object({
  evidence: optionalEvidenceText,
});

const supplierAddressSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      const address = value.trim();
      return address ? { address, evidence: address } : undefined;
    }
    return value;
  },
  z.object({
    address: optionalContactText,
    country: optionalContactText,
    ...supplierContactEvidenceSchema.shape,
  }),
);

const supplierPhoneSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      const phone = value.trim();
      return phone ? { phone, evidence: phone } : undefined;
    }
    return value;
  },
  z.object({
    phone: optionalContactText,
    country: optionalContactText,
    ...supplierContactEvidenceSchema.shape,
  }),
);

export const supplierContactResearchOutputSchema = z.object({
  contacts: z.array(z.object({
    name: optionalContactText,
    email: optionalContactEmail,
    phone: optionalContactText,
    jobTitle: optionalContactText,
    department: optionalContactText,
    country: optionalContactText,
    professionalProfile: optionalContactUrl,
    evidence: z.array(z.string()).default([]),
  })).default([]),
  addresses: z.array(supplierAddressSchema).default([]),
  phones: z.array(supplierPhoneSchema).default([]),
  emails: z.array(z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const email = value.trim();
        return {
          email,
          evidence: email,
        };
      }
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return {
          ...record,
          email: record.email ?? undefined,
          evidence: record.evidence ?? (typeof record.email === 'string' ? record.email : undefined),
        };
      }
      return value;
    },
    z.object({
      email: z.string().email(),
      evidence: z.string().min(1),
    }),
  )).default([]),
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
