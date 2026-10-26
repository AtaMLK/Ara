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

## Research configuration

Set `SERPER_API_KEY` in `.env.local` for local development and in your deployment environment for production. Get the key from your [Serper account](https://serper.dev/). Restart the development server or redeploy after changing it.

Product and supplier research uses Serper's Google Search API. The key is server-only and must never use a `NEXT_PUBLIC_` prefix.

## Status

The procurement workflow is implemented and under supervised delivery review.
See [delivery readiness, verification and remaining release gates](docs/stage7-delivery-readiness.md).

Run `npm ci` then `npm run check:delivery` for lint, TypeScript, integration tests,
component browser checks and production build. Browser checks currently use
Microsoft Edge on Windows. See the handoff document for database checks and the
separate controlled live acceptance required before production rollout.
