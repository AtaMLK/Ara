import 'server-only';

export type ResearchQuery = {
  inquiryId: string;
  query: string;
  country?: string;
  limit?: number;
};

export type ResearchResult = {
  sourceType: 'web' | 'public_specialized_source';
  sourceName: string;
  sourceUrl: string;
  finding: string;
  structuredData: Record<string, unknown>;
  relevance?: string;
  confidence?: number;
  evidence: Record<string, unknown>;
};

export interface ResearchProvider {
  search(input: ResearchQuery): Promise<ResearchResult[]>;
}

export function getResearchProvider(): ResearchProvider | null {
  // Provider credentials and implementation are intentionally injected later.
  // Returning null keeps the workflow honest: no provider means no fabricated research.
  return null;
}
