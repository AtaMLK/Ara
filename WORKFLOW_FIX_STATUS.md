# Workflow branch: notifications and quotation revision handling

Base: feat/workflow-queue-runner (e74337f). Repair branch: fix/workflow-customer-quote-ui-20261101. PR18 now includes the customer's follow-up request for visible notifications and a working revision/edit/send path.

## Behavior

- Every admin page has unread count, latest unread headline and direct action link. Data refreshes every15 seconds while visible, on focus and navigation; errors are shown with Retry.
- Pending customer revisions have a persistent review banner with request reason/message and direct quote link. Reading a notification does not resolve or hide pending work.
- Revised drafts/pending approvals remain visible with Edit & confirm prices / Review & send links. Other pending quote approvals, RFQs, open AI alerts and tasks have destinations. Notification, alert and task views are linked from the inbox.
- Review controls exist on the actual quotation as well as the revision queue. Approval opens the new draft; errors are visible. Parent customer request context remains visible on a revised draft.
- Already confirmed prices can be edited and confirmed again. Empty prices are rejected, dates can be cleared, expired quotes cannot be sent. Stored product descriptions/models are used when a catalog relation is absent.
- Customer decisions and admin revision cloning use the existing live atomic RPCs, including notification/audit writes and retry-safe results. Customer item access uses the existing customer-safe RPC projection. Original prices/cost fields remain private.
- Resend is retained as this branch's transport. A unique durable email reservation precedes provider delivery; completed retries reuse the receipt and uncertain deliveries block automatic resending. Provider headers also carry a stable idempotency key. Attachments are encoded for the documented API instead of being silently discarded. No SMTP transport was imported.

## Necessary build repairs

Fixed malformed action template literals, excess intake braces, missing enqueue function reference, missing alert helper/stage mapping, notification schemas, missing revision-list query, and joined relation object/array shapes. Pinned compatible dependencies/lockfile and replaced the unresolved legacy PDF import with unpdf. Added a working ESLint command/config. Restored the22 already-recorded live migration files and hash manifest into this branch so the RPC/schema dependencies are reviewable. No new migration was applied in this follow-up.

## Verification

- Production build including TypeScript passed. ESLint passed.15 Node tests passed, including persistent-work rendering after notifications are read, direct destinations, same-origin guards and durable send retry/concurrency/failure behavior.
- Live rollback integration: customer item ownership/privacy, expiry/decisions/notification generation, atomic revision clone/retry/audit, resolver/dispatch uniqueness, own read-marker updates and cross-user read/update denial. All business fixtures/decisions rolled back.
- Actual authenticated admin UI: three unread notifications, one outstanding revised draft, direct draft navigation, customer request context, product snapshot/model and editable quote controls. A temporary own-admin notification appeared without reloading (3→4); marking only that fixture read returned to3 while draft work stayed visible. Temporary notification was removed.
- Desktop1280 and mobile390 checked; document375px <= viewport390px on mobile. Screenshots saved outside the repo.
- Anonymous attention endpoint returns401. Production dependency audit reports0 known vulnerabilities. Development lint dependency audit retains13 moderate notices.

## Limits

No real customer request was submitted, existing quotation edited/approved, or real email sent in UI testing. Local server-only email credentials are absent. Delivery logic tested through a fake transport; production Resend/domain/keys still need a real deployment check. Pending revision banner was tested with fixture rendering because the live queue currently has0 pending requests.97 existing open AI alerts remain for business review; they were not silently dismissed. Supplier discovery quality/other AI stages have not been comprehensively validated in this follow-up. Existing shared database changes from earlier in the conversation remain applied; nothing was merged into the workflow base or main.

Sources: live ARAT schema/ledger and provided accounts; official Resend send endpoint and idempotency documentation (https://resend.com/docs/api-reference/emails/send-email , https://resend.com/docs/dashboard/emails/idempotency-keys); Supabase Next.js/RLS guide (https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs); installed Next.js route/link/router documentation.
