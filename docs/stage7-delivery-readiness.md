# Delivery 7: security review and handoff readiness

Date: 2026-10-26. Repository: AtaMLK/Ara, branch `feature/supplier-rfq-product-flow`.

## Decision

The implemented workflow is a candidate for a supervised pilot. This is not an
unattended-production sign-off. Admin review of suppliers, commercial facts,
customer prices and outbound RFQs/quotes remains part of the business workflow.
The operational release gates and remaining limitations below must travel with
the handoff; a green test suite does not prove actual stock or email delivery.

## Changes

- Replaced removed `next lint` with the ESLint CLI and Next Core Web Vitals config.
  Fixed three actual lint errors: effect-driven hydration/theme state and a render
  timestamp that falsely used the current time for an undated supplier reply.
  The reply now falls back to the RFQ creation timestamp.
- Updated and pinned Next.js 16.4.3, Nodemailer 10.2.1, Mailparser 3.12.4 and Zod
  4.6.7. Updated vulnerable transitive `ip-address` and `source-map-js` packages.
  SheetJS now comes from the official pinned 0.20.3 CDN tarball instead of the
  obsolete npm registry release. The lockfile records integrity hashes.
- Added `npm test`, `test:inquiry-ui` and a fail-fast `check:delivery` command.
- Production smoke testing found the new-request page rendered its form before
  checking customer access (submission itself was already guarded). It now sends
  anonymous visitors to sign-in with a return path, sends active Admin to the
  internal workflow, and rejects inactive/non-customer accounts before rendering.
- Applied `20261026124413_harden_rls_helper_privileges.sql` to ARAT Supabase.
  Identity helpers no longer inherit PUBLIC/anonymous EXECUTE. Policies using
  those helpers now explicitly target authenticated users, preserving their
  existing ownership/Admin predicates. All three touched functions have an empty
  search path. Trigger-only `touch_updated_at` is not callable by API clients.
- The two identity helpers retain SECURITY DEFINER intentionally: they read
  protected identity tables without recursive RLS. Neither accepts a user ID;
  both derive identity from `auth.uid()` and require active records.

## Repeatable verification

Recorded result: 109 Node tests and four component browser checks pass, TypeScript
and production build pass, and `npm audit` reports zero known vulnerabilities.
The rebuilt production server also passes login hydration, anonymous route
redirection and unauthorized cron rejection checks.
The security advisor no longer reports mutable search paths or anonymous definer
execution; the three remaining findings are explained below.

On the supported local Windows environment, Node 24 and installed Microsoft Edge:

```powershell
npm ci
npm run check:delivery
npm audit
```

`check:delivery` runs lint, TypeScript, every `tests/*.test.cjs` test, four real
component browser checks (customer entry, supplier selection, RFQ history, quote
review), and production build. Browser checks mock server actions; workflow tests
use isolated database/providers. They do not send real supplier/customer email.
ESLint 10 is supported by Next's config; several bundled plugins still declare
older peer ranges, so npm emits peer warnings. `npm ci --dry-run --ignore-scripts`
accepts the lockfile. Lint has zero errors and three existing warnings: intentional
full-page navigation after submission/sign-out and a signed-document preview img.

After building, run `npm start -- --port 3107` in a separate terminal, then
`npm run test:production-smoke`. This checks login hydration, anonymous redirects
and unauthorized cron rejection without logging in or running a business action.
Stop that test server when finished. Production scheduling and live email are
separate release gates below.

Five owner-run SQL regression files in `supabase/tests/` were executed against
ARAT and rolled back: internal Admin/customer isolation, identity helper privileges,
worker expiry, durable dispatch, RFQ history. Their assertions include active vs
inactive Admin, customer ownership, anonymous denial, service-only mutation RPCs,
atomic rollback, interruption/late-result handling, and preserved cancellation.

## Workflow acceptance coverage

| Step | Evidence and expected result |
| --- | --- |
| Customer request | Manual, pasted list, PDF and Excel entry; quantities/units retained; missing values not invented; five-row document extraction covered. |
| Research | Per-product research; Arya routing for exclusive brands and preferred Siemens; Turkey evidence before foreign; distinct first five and next five; stop when exhausted. |
| Supplier approval | Stored verification reused across inquiries; Admin downgrade respected; source evidence retained. |
| Grouped RFQ | Shared supplier receives one reviewed message containing selected products; mixed-inquiry selections rejected; uncertain send cannot be bypassed with a new preview. |
| Inbound email | Alternate company mailbox matched using unique RFQ/thread evidence and flagged; original contact unchanged; domain alone cannot attach an unrelated reply. |
| Supplier offer | Multiple replies consolidate into an unpriced draft; missing currency/tax surfaced; raw supplier values retained alongside Admin corrections. |
| Customer price | Server validates explicit Admin confirmation, reviewed cost/currency, exchange rate and formula; editable save clears confirmation. |
| Customer quote | Admin-approved send produces customer-safe PDF; supplier costs/margins are absent; customer decision/revision restricted to owned quote. |
| Procurement | Accepted quote produces source-specific supplier orders using reviewed amounts/currency; incomplete/unapproved orders cannot silently finish procurement. |
| Failure handling | Request deadlines, worker leases/heartbeat, durable email reservation, manual interruption review, RFQ cancellation with history retained. |

These are integration/component regressions across the business path, not a claim
that a single live customer transaction was sent from end to end in production.

## Remaining issues and release gates, in priority order

1. **P1 — Accepted SMTP send versus application finalization.** The durable ledger
   prevents blind retry, but RFQ/quote/communication/audit updates after SMTP are
   not one transaction with delivery. If a post-send write fails, the message may
   have been accepted while the parent record lags. Admin must reconcile the
   dispatch Message-ID with the mail provider and records; never clear a key or
   resend solely because a screen looks unchanged. A dedicated reconciliation
   workflow is the next engineering priority before unattended operation.
2. **Release gate — Production worker and inbound mail scheduling.** Development
   instrumentation runs workers locally; `next start` does not provide that loop.
   Production needs the protected workflow and email-poll routes scheduled (the
   repository declares every-minute Vercel crons), a valid `CRON_SECRET`, and
   deployment plan/runtime limits sufficient for the work. A local build cannot
   establish that deployed scheduling, provider credentials or IMAP work.
3. **Release gate — Controlled live acceptance.** Use a controlled recipient and
   a test customer to verify real SMTP acceptance, alternate-mailbox IMAP reply,
   extraction, Admin price approval and customer-safe PDF. No real external email
   was sent in this stage. Paid-provider search diagnostics from stage 6 remain
   separate from this mocked regression gate.
4. **P2 — Interrupted stages.** Heartbeats identify abandoned workers and lease
   checks fence execution completion. They do not fence every intermediate
   business write or impose a total lifetime on a worker still heartbeating.
   Review partial effects before explicit recovery; do not auto-replay sends.
5. **P2 — Sourcing/extraction uncertainty.** Country fetches are bounded; unknown
   location stays unknown. Search/model results establish proposals rather than
   identity, exact availability or stock. Scanned PDF OCR remains deferred. Admin
   must resolve missing/ambiguous amounts, currency and commercial details.
6. **P2 — Auth password protection.** Leaked-password protection is disabled. ARAT's
   organization is on the Free plan; Supabase documents this feature for Pro and
   above. No paid upgrade was made. See the
   [Auth setting and plan requirement](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
7. **Reviewed advisory — Authenticated identity helper RPCs.** Supabase still flags
   the two signed-in SECURITY DEFINER helpers. Their narrow, own-identity behavior
   is intentional for existing RLS. Moving them into an unexposed schema together
   with policy references is a future hardening option; revoking authenticated
   access alone would break authorization. See
   [the advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
8. **Boundaries.** History guards prevent deletion and cancelled-record reopening,
   not every historical field edit. Old deleted records are not recovered. Existing
   completed inquiries were not bulk reprocessed. Concurrent independent sourcing
   operations are not globally transactional. No actual stock guarantee is made.

## Owner handoff

Start with supervised inquiries, check failed automation and unresolved dispatch
alerts daily, review the five-company supplier choices, approve contacts and RFQ
content, then resolve commercial facts and explicitly confirm customer prices.
Confirm production scheduling and controlled live acceptance before onboarding
customers without direct supervision. Keep service/provider credentials server-only
and out of Git. Run `npm ci` and the delivery gate after pulling; restart the local
server to use updated dependencies and environment settings.

Security sources: [Next advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw),
[official SheetJS installation](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/),
[Next ESLint setup](https://nextjs.org/docs/app/api-reference/config/eslint).
