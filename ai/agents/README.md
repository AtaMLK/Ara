ARAT AGENT ARCHITECTURE

Agents are bounded AI workers. They do not independently invent business policy. They operate under the ARAT Constitution.

GLOBAL AGENT CONTRACT
Every agent must define:
- Purpose
- Inputs
- Outputs
- Allowed tools
- Read permissions
- Write permissions
- Forbidden actions
- Approval boundaries
- Uncertainty handling
- Retry/idempotency
- Escalation
- Evidence requirements

GLOBAL RULES
- Constitution has higher precedence than agent instructions.
- Agents may only read/write authorized entities.
- Unknown is a valid output.
- No fabricated values.
- Original source evidence must remain traceable.
- Admin-edited values have precedence over AI inference.
- Consequential actions require the approval defined by workflow rules.
- Agents must be idempotent where the operation can be retried.
- Agents return structured results, not free-form operational decisions.

ORCHESTRATOR
The Research Orchestrator coordinates the workflow and delegates bounded tasks. It does not replace specialized agents.

INITIAL AGENTS
1. Intake Agent
2. Document Agent
3. Clarification Agent
4. Product Research Agent
5. Supplier Discovery Agent
6. Supplier Verification Agent
7. Contact Research Agent
8. RFQ Agent
9. Email Response Agent
10. Quote Extraction Agent
11. Comparison Agent
12. Reporting Agent

FUTURE/OPTIONAL AGENTS
- Pricing Calculation Agent (calculation only; never final customer-price selection)
- Notification Agent
- Data Quality Agent

Each specialized agent must use the canonical Constitution documents relevant to its task.