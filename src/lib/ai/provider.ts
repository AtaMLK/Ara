import 'server-only';

import { z } from 'zod';
import { ToolError } from '@/lib/errors';
import type { AgentId } from './context';

export type AIMessage = {
  role: 'system' | 'user';
  content: string;
};

export type AIModelResponse<T> = {
  output: T;
  provider: string;
  model: string;
};

export interface AIModelProvider {
  generate<T>(
    messages: AIMessage[],
    schema: z.ZodType<T>,
    options?: { model?: string; temperature?: number },
  ): Promise<AIModelResponse<T>>;
}

const providerResponseSchema = z.object({
  output_text: z.string().min(1),
});

class OpenAICompatibleProvider implements AIModelProvider {
  async generate<T>(
    messages: AIMessage[],
    schema: z.ZodType<T>,
    options: { model?: string; temperature?: number } = {},
  ): Promise<AIModelResponse<T>> {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.6';

    if (!apiKey) throw new ToolError('TRANSIENT', 'OPENAI_API_KEY is not configured');

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: options.temperature ?? 0,
        messages,
        response_format: { type: 'json_object' },
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ToolError(response.status >= 500 ? 'TRANSIENT' : 'AI_PROCESSING', `AI provider error: ${text.slice(0, 500)}`);
    }

    const json = await response.json();
    const parsed = providerResponseSchema.safeParse({
      output_text: json.choices?.[0]?.message?.content,
    });

    if (!parsed.success) throw new ToolError('AI_PROCESSING', 'AI provider returned no JSON output');

    let output: unknown;
    try {
      output = JSON.parse(parsed.data.output_text);
    } catch {
      throw new ToolError('AI_PROCESSING', 'AI provider returned invalid JSON');
    }

    const validated = schema.safeParse(output);
    if (!validated.success) {
      throw new ToolError('AI_PROCESSING', `AI output failed schema validation: ${validated.error.message.slice(0, 800)}`);
    }

    return { output: validated.data, provider: 'openai-compatible', model };
  }
}

const agentPrompts: Partial<Record<AgentId, string>> = {
  intake: 'Create a reliable initial understanding of the customer inquiry. Never invent facts. Material ambiguity must be surfaced.',
  clarification: 'Ask the minimum targeted question needed to resolve material ambiguity. Never silently guess consequential values.',
  product_research: 'Research technical product identity and evidence. Do not replace customer requirements.',
  supplier_discovery: 'Find supplier candidates from evidence. Do not rank suppliers.',
  supplier_verification: 'Verify supplier identity, country, website and activity from evidence. Unresolved conflicts remain pending.',
  contact_research: 'Find supplier contact information from reliable evidence. Do not fabricate contact details.',
  rfq: 'Prepare supplier-specific RFQ drafts. Never send without approval and never expose internal information.',
  email_response: 'Match incoming supplier emails using reliable evidence. Never attach an ambiguous email.',
  quote_extraction: 'Extract supplier quote facts exactly. Unknown or missing values remain unknown.',
  comparison: 'Compare requirements and supplier quotes factually. Never rank suppliers or select a winner.',
  customer_quote: 'Prepare factual customer quote line proposals only. Never set final customer prices, margins, markups, or exchange rates.',
  reporting: 'Produce factual current-state reports. Never rank suppliers or make commercial recommendations.',
};

export function getAgentSystemPrompt(agentId: AgentId): string {
  return [
    'You are an ARAT specialized procurement agent.',
    'Rule precedence: security/access, explicit Admin/Customer values, ARAT Constitution, workflow rules, agent contract, AI inference.',
    'Never fabricate procurement facts. Do not expose chain-of-thought. Return only the requested structured output.',
    agentPrompts[agentId] ?? 'Follow the ARAT Constitution and your agent contract.',
  ].join('\n');
}

export function getAIProvider(): AIModelProvider {
  return new OpenAICompatibleProvider();
}
