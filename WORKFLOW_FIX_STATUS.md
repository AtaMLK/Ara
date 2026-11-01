# Workflow branch: notifications and quotation revision handling

Base: feat/workflow-queue-runner (e74337f). Repair branch: fix/workflow-customer-quote-ui-20261101. PR18 now includes the customer's follow-up request for visible notifications and a working revision/edit/send path.

## Behavior

- Ordinary admin pages show only a compact notification indicator (and a pending-revision badge when relevant). Notification, AI, task and unfinished-work details live in the dedicated notification center. Polling remains15 seconds while visible; background details do not clutter ordinary pages.
- Pending customer revisions have a review banner with reason/message and direct quote link inside the notification center only. Reading a notification does not resolve or hide pending work. Dropdown closes on outside pointer, Escape, close button and link selection.
- Revised drafts/pending approvals and other work have destinations within the notification center. AI activity and alert counts are excluded from the main dashboard. Pricing calculations on quote items are collapsed.
- Review controls exist on the actual quotation as well as the revision queue. Approval opens the new draft; errors are visible. Parent customer request context remains visible on a revised draft.
- Already confirmed prices can be edited and confirmed again. Quantity, price, details and approval actions refresh server data without a full reload. Quantity/price saves show local success feedback; unchanged quantity preserves confirmed pricing; zero-row updates cannot report success. Empty prices are rejected, dates can be cleared, expired quotes cannot be sent. Stored descriptions/models are used when a catalog relation is absent.
- Customer decisions and admin revision cloning use the existing live atomic RPCs, including notification/audit writes and retry-safe results. Customer item access uses the existing customer-safe RPC projection. Original prices/cost fields remain private.
- Email delivery supports both SMTP and Resend, selected by EMAIL_PROVIDER. The original ARAT environment selects SMTP. Sender fallback is EMAIL_FROM, SMTP_FROM, then SMTP_USER. Both transports reserve a durable delivery key before sending, reuse completed receipts and block ambiguous retries. SMTP uses deterministic Message-ID and protected attachment loading; Resend also uses its provider idempotency key. No real email was sent in verification.

## Necessary build repairs

Fixed malformed action template literals, excess intake braces, missing enqueue function reference, missing alert helper/stage mapping, notification schemas, missing revision-list query, and joined relation object/array shapes. Pinned compatible dependencies/lockfile and replaced the unresolved legacy PDF import with unpdf. Added a working ESLint command/config. Restored the22 already-recorded live migration files and hash manifest into this branch so the RPC/schema dependencies are reviewable. No new migration was applied in this follow-up.

## Verification

- Production build including TypeScript passed. ESLint passed.19 Node tests passed, including compact-versus-center rendering, persistent work after read, direct destinations, same-origin guards, quantity no-op/persisted-result/zero-row behavior and durable send retry/concurrency/failure behavior.
- Live rollback integration: customer item ownership/privacy, expiry/decisions/notification generation, atomic revision clone/retry/audit, resolver/dispatch uniqueness, own read-marker updates and cross-user read/update denial. All business fixtures/decisions rolled back.
- Actual authenticated admin UI: three unread notifications, one outstanding revised draft, direct draft navigation, customer request context, product snapshot/model and editable quote controls. A temporary own-admin notification appeared without reloading (3→4); marking only that fixture read returned to3 while draft work stayed visible. Temporary notification was removed.
- Desktop1280 and mobile390 checked; document375px <= viewport390px on mobile. Screenshots saved outside the repo.
- Anonymous attention endpoint returns401. Production dependency audit reports0 known vulnerabilities. Development lint dependency audit retains13 moderate notices.

## Limits

No real customer request was submitted, existing quotation edited/approved, or real email sent in UI testing. Local credentials were loaded from the user-designated original ARAT .env.local into the ignored local environment. SMTP TLS/authentication and durable-delivery DB access verified without sending. Actual message acceptance/delivery still requires a separate send test. Pending revision banner was tested with fixture rendering because the live queue currently has0 pending requests.97 existing open AI alerts remain for business review; they were not silently dismissed. Supplier discovery quality/other AI stages have not been comprehensively validated in this follow-up. Existing shared database changes from earlier in the conversation remain applied; nothing was merged into the workflow base or main.

Sources: live ARAT schema/ledger and provided accounts; official Resend send endpoint and idempotency documentation (https://resend.com/docs/api-reference/emails/send-email , https://resend.com/docs/dashboard/emails/idempotency-keys); Supabase Next.js/RLS guide (https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs); installed Next.js route/link/router documentation.

## Latest browser follow-up

Confirmed notification outside click and Escape close the dropdown; selecting the notification-center link closes it before navigation. On the real revised quote, saved its existing quantity5 (no business change); success feedback appeared and scrollY stayed678 before/after. DB quantity5 and admin_confirmed price were preserved. Earlier global work banners are removed from ordinary pages. Build/TypeScript, ESLint and21 tests pass.

The user-triggered email-send failure came from missing local sender/service configuration and a Resend-only adapter on a branch whose original environment selects SMTP. Resolved using the user-designated original environment at E:/ARAT/Ara/.env.local (source file unchanged), adding SMTP adapter selection and sender fallback. The local .env.local remains ignored and was not staged. SMTP connection/TLS/authentication and sender/application URL plus service-role delivery-table access passed. No secret values were printed or committed. Build, ESLint and21 tests passed. No real email sent; authenticated SMTP does not itself prove recipient delivery.

## Inquiry presentation and display identifiers

Inquiry detail now contains a compact product table, customer/quotation summary and collapsed original request/attachments. Supplier candidates, workflow explanations, AI alerts and timeline are not rendered or queried there. Supplier candidate controls are in Suppliers; workflow/clarification controls are on a dedicated Processing page. Business history remains in the database.

Product fields are grouped by their recorded source item/position rather than rendering every requirement as a row. The reviewed file inquiry has5 products from20 fields; the reviewed sensor inquiry has1 product from9 fields. Each item has a single table row with model, explicit quantity/unit, brand when recorded and review status. Per-field editing opens only for the selected row. Admin edits take precedence. No supplier identity, product quantity, unit or business code was invented; source records were not rewritten.

Display references reuse the original office application's inquiry reference helper and stored quote/RFQ display references. No separate supplier/product business codes were introduced, consistent with REFERENCE_RULES.md. Dashboard UUID fragments are replaced by inquiry references. UUIDs in alert/notification text are resolved to related requirement names/business references when known, with a neutral label otherwise. Technical schema/SQL dumps have short readable messages. Internal IDs remain in backend keys and navigation URLs, not visible text; no DOM-hiding workaround is used.

Validation:26 Node tests passed, including10 source item groups→10 rows, admin override priority, unknown quantities, explicit units, UUID-free display text and preservation of real model/part numbers. Browser checks on both supplied inquiry URLs confirmed5 and1 product rows,0 visible UUIDs and no AI/supplier/timeline panels. Row editing opened/closed without writing business data. Dashboard, Quotes, RFQs, Notifications/AI alerts, Suppliers and Processing all loaded with0 UUIDs in visible body text. Desktop screenshot recorded; mobile uses a table-local horizontal scroll area. No database migration or business-data mutation in this presentation follow-up.
