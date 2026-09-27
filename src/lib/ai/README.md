# ARAT Application Layer

The application layer uses Next.js App Router, TypeScript, Supabase SSR, Supabase PostgreSQL and Zod.

## Server boundaries

- Browser code never receives the Supabase service-role key.
- Customer/Admin sessions use the SSR client.
- AI tools are server-only modules.
- AI tools validate inputs with Zod and enforce authorization before writes.
- Optimistic version checks protect records changed after an Agent read.
- Database RLS remains a second authorization boundary.

## Current tool modules

- inquiries.ts
- requirements.ts
- notifications.ts

## Next implementation groups

1. Supplier and verification tools
2. RFQ/email tools
3. Supplier response and quote extraction tools
4. Customer quote and approval gates
5. Orchestrator/job runner
6. Admin and Customer UI
