import 'server-only';

import { z } from 'zod';
import type { AgentId, AIContext } from './context';
import { getAIProvider, getAgentSystemPrompt } from './provider';
import { ToolError } from '@/lib/errors';

export type AgentRun<T> = {
  output: T;
  provider: string;
  model: string;
  executionId: string;
};

const toolNames: Record<AgentId, string[]> = {
  orchestrator: ['inquiries','requirements','notifications'],
  intake: ['requirements','inquiries'],
  document: [],
  clarification: ['requirements','inquiries','notifications'],
  product_research: ['requirements'],
  supplier_discovery: ['requirements','suppliers'],
  supplier_verification: ['suppliers'],
  contact_research: ['suppliers'],
  rfq: ['rfq'],
  email_response: ['incoming-email'],
  quote_extraction: ['supplier-responses'],
  comparison: ['supplier-responses','supplier-quotes'],
  customer_quote: ['supplier-quotes'],
  reporting: [],
};

export function getAllowedTools(agentId: AgentId): string[] {
  return [...toolNames[agentId]];
}

export async function runAgent<T>(
  ctx: AIContext,
  input: unknown,
  outputSchema: z.ZodType<T>,
  options: { model?: string; temperature?: number } = {},
): Promise<AgentRun<T>> {
  const provider = getAIProvider();

  const messages = [
    { role: 'system' as const, content: getAgentSystemPrompt(ctx.agentId) },
    {
      role: 'user' as const,
      content: JSON.stringify({
        execution_id: ctx.executionId,
        inquiry_id: ctx.inquiryId,
        allowed_tools: getAllowedTools(ctx.agentId),
        input,
        output_requirement: 'Return only JSON matching the supplied output schema.',
      }),
    },
  ];

  const result = await provider.generate(messages, outputSchema, options);

  return {
    output: result.output,
    provider: result.provider,
    model: result.model,
    executionId: ctx.executionId,
  };
}

export function assertAgentCanUseTool(agentId: AgentId, toolName: string): void {
  if (!getAllowedTools(agentId).includes(toolName)) {
    throw new ToolError('AUTHORIZATION', `Agent ${agentId} is not allowed to use tool ${toolName}`);
  }
}
