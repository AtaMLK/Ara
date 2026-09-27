# ARAT

AI Procurement & Procurement Intelligence Platform.

## Project direction

ARAT is a single-company procurement platform built around specialized AI agents, a Research Orchestrator, controlled tools, explicit business rules, and human approval where required.

## Architecture principles

- AI follows the ARAT Business Rules / Constitution.
- Specialized agents handle bounded responsibilities.
- The Research Orchestrator coordinates multi-step workflows.
- AI must not fabricate missing information.
- Uncertainty and conflicts are surfaced instead of guessed.
- Admin approval is required for consequential actions defined by the business rules.
- Customer data is isolated by customer account.
- Historical records are retained; important business records are not hard-deleted.
- Supplier and quote information is traceable to source evidence.
- AI reasoning is not exposed; results, alerts, approvals, and exceptions are exposed.
- The system is designed for RAG/knowledge-base driven AI rather than initial model fine-tuning.

## Planned structure

```text
app/                    # Next.js application
components/             # UI components
lib/                    # shared application services
ai/
  orchestrator/         # workflow coordination
  agents/               # specialized procurement agents
  tools/                # controlled AI tools
  rules/                # canonical business rules
  schemas/              # structured AI input/output schemas
supabase/               # database, migrations, policies
docs/
  constitution/         # canonical ARAT business rules
  agents/               # agent specifications
  workflows/            # workflow specifications
  golden-tests/         # AI evaluation cases
```

## Status

Project initialized. Application implementation follows the approved ARAT specification.
