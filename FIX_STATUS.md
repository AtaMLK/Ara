# ARAT repair status — 2026-11-01

Repository: AtaMLK/Ara. Branch: fix/arat-build-review-20261101. This is ARAT only. Application changes require deployment; three additive migrations have already been applied to the existing ARAT database.

## Five follow-up issues

- Email: every SMTP call now reserves an existing durable, unique email_dispatches key before delivery. Concurrent attempts cannot both send. A completed retry reuses the receipt. Interrupted delivery or receipt writes block automatic resend and create an admin alert when possible. SMTP does not guarantee exactly-once delivery; uncertain records require checking the sent mailbox. Five transport-independent tests cover retries, concurrency, changed payloads, interruption and lost receipt writes. No real email was sent during verification.
- Excel: replaced vulnerable registry xlsx 0.18.5 with the official SheetJS 0.20.3 tarball, pinned in the lockfile. Added input/output limits and explicit truncation flags. XLSX, XLS, Unicode and CSV parsing tested. Production dependency audit: zero reported vulnerabilities. Development lint dependencies still have moderate notices.
- Suppliers: three exact normalized-name/website duplicate pairs linked as inactive aliases, preserving all 69 supplier records and their historical foreign keys. Twelve invalid names quarantined from new RFQs and the primary supplier list. Admin review view includes a correction form requiring a source URL; corrections reset commercial verification to Pending and record evidence/audit. Discovery now resolves name/website/country under an advisory lock instead of inserting duplicates. These twelve identities still require evidence-based human resolution; they have not been guessed or marked verified. This repairs the unsafe workflow, not all underlying identity evidence.
- Admin price revisions: one database transaction now clones the quote/items, resets price confirmation, supersedes the original, reviews the request and records timeline/notification/audit. Parent locks serialize conflicting decisions; result_quote_id makes retries reuse the same replacement. Expired validity is cleared. Integration tests confirm resulting states, item copy/reset, retry behavior, audit count and customer denial.
- Database history: restored all 22 recorded deployed migrations into source with their actual version/name and SQL. SHA-256 manifest and regression test detect source drift. Earlier 0001–0013 baseline files remain; they predate tracked remote history. Fresh empty-database replay was not verified. See docs/database/README.md.

## Validation

- 17 Node tests passed.
- Production build and TypeScript passed.
- ESLint: zero errors, two pre-existing warnings (image rendering and sign-out navigation).
- Live database integration: customer projection/privacy, ownership, decisions, expiry, idempotency, notifications, inactive/anonymous access; admin revision copy/retry/audit; supplier resolver reuse/invalid-name rejection; durable email key uniqueness. All fixtures and test decisions rolled back.
- Production dependency audit: zero reported vulnerabilities.
- Customer quotation desktop/mobile/dark/history checks completed, including the screenshot's Siemens quote; quotation screenshots retained locally.
- Background AI and real SMTP were not exercised: server-only integration credentials are absent locally. User passwords were not saved in project files.

## Sources & Coverage

Used: live ARAT migration ledger, database records, local source, supplied customer/admin UI access, official SheetJS installation documentation (https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).

Limited: supplier public websites checked selectively (https://gminternational.com/, https://www.exloc.com/, https://anv-tech.ru/). A shared domain or product page alone does not establish a legal entity, branch or country. No uncertain supplier identities were merged on that basis. No paid enrichment or contact discovery was used.

Remaining: twelve supplier identities need source-backed review; real SMTP/integration deployment validation; existing Supabase leaked-password protection setting and existing helper-function advisory notices; moderate development-tool dependency advisories. No hosting deployment or main-branch merge performed.
