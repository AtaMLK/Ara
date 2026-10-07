import 'server-only';

import { ToolError } from '@/lib/errors';

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

class SerpApiResearchProvider implements ResearchProvider {
  async search(input: ResearchQuery): Promise<ResearchResult[]> {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) throw new ToolError('TRANSIENT', 'SERPAPI_API_KEY is not configured');

    const params = new URLSearchParams({
      engine: 'google',
      q: input.query,
      api_key: apiKey,
      output: 'json',
      hl: 'en',
    });

    if (input.country) params.set('location', input.country);

    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      let detail = '';
      try {
        const errorPayload = await response.json() as {
          error?: string;
          message?: string;
        };
        detail = errorPayload.error || errorPayload.message || '';
      } catch {
        // Keep the provider error generic when the upstream body is not JSON.
      }

      const authFailure = response.status === 401 || response.status === 403 ||
        /invalid.*api.?key|api.?key.*invalid|unauthorized|authentication/i.test(detail);

      throw new ToolError(
        'TRANSIENT',
        authFailure
          ? 'Research provider authentication failed: SERPAPI_API_KEY was rejected.'
          : `Research provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      );
    }

    const payload = await response.json() as {
      error?: string;
      organic_results?: Array<{
        position?: number;
        title?: string;
        link?: string;
        snippet?: string;
        displayed_link?: string;
      }>;
    };

    // SerpApi/Google can return a provider-level "no results" message for a
    // perfectly valid query. That is an empty evidence set, not a workflow
    // failure. The Research stage must continue with its other queries.
    if (payload.error) {
      const normalizedError = payload.error.toLowerCase();
      if (normalizedError.includes("hasn't returned any results") || normalizedError.includes('no results')) {
        return [];
      }
      throw new ToolError('TRANSIENT', payload.error);
    }

    return (payload.organic_results ?? [])
      .filter((item) => Boolean(item.link && item.title))
      .slice(0, Math.min(input.limit ?? 10, 20))
      .map((item) => ({
        sourceType: 'web' as const,
        sourceName: item.displayed_link || item.title || 'Google result',
        sourceUrl: item.link!,
        finding: item.snippet || item.title!,
        structuredData: {
          title: item.title,
          position: item.position,
        },
        relevance: 'search_result',
        evidence: {
          provider: 'serpapi',
          query: input.query,
          position: item.position,
          title: item.title,
          url: item.link,
          snippet: item.snippet,
        },
      }));
  }
}

export function getResearchProvider(): ResearchProvider | null {
  if (process.env.SERPAPI_API_KEY) return new SerpApiResearchProvider();
  return null;
}
