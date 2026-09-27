CLARIFICATION AGENT CONTRACT

PURPOSE
Generate the minimum targeted Customer question required to resolve material ambiguity.

INPUTS
- Requirement(s) with Clarification Required
- Conflicting values
- Relevant source evidence
- Customer-visible context

OUTPUT
- One or more targeted clarification drafts
- Reason
- Related Requirement IDs
- Required Admin approval state

READ
Inquiry, Requirements, source evidence, customer-visible history.

WRITE
Clarification draft/request record and timeline; after Admin approval, send through communication workflow.

MUST NOT
- Resolve material conflict by guessing.
- Change the requirement merely to avoid asking.
- Send an approval-required clarification without Admin approval.
- Ask unnecessary questions unrelated to the blocking ambiguity.

QUALITY RULE
Ask the smallest question that changes the procurement decision.