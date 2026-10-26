# Delivery 5: RFQ cancellation with retained history

## Business behavior

The RFQ delete control is replaced with Cancel RFQ and a required reason. The RFQ,
its items, original content, sent date and linked communications remain stored.
Cancelled RFQs remain visible on the RFQ list and their inquiry, with cancellation
reason/time. Conversation preview remains available; cancellation is not email recall.

Cancellation records the active Admin identity, time and reason, audit entry and
admin timeline event in one transaction. Repeating cancellation does not rewrite
its original reason or create duplicate events. Audit failure rolls back the change.
Old browser tabs calling the former delete action also perform cancellation.

Database guards reject RFQ/item hard deletion and truncation, deletion of RFQ-linked
communications, reassignment/detachment of existing RFQ links, and reopening or
rewriting cancellation metadata. Other field edits are not made append-only here.

## Sending and cancellation

The cancellation RPC and new RFQ email reservation take the same RFQ row lock.
A cancelled RFQ cannot reserve a new SMTP send. In-progress/uncertain deliveries
block cancellation; a sent RFQ whose business state lags its dispatch must also be
reviewed before cancellation. Both legacy `rfq:` and current `rfq-` keys are checked.

The grouped supplier flow now records explicit preview approval as Approved before
sending, uses the canonical dispatch key and inquiry link, and retains Approved
with a review alert if delivery fails or is uncertain. It does not auto-cancel or
claim that no email was sent. A fresh preview cannot bypass existing active RFQ
items for the same supplier/requested product. This history precheck is not a
global uniqueness guarantee for independently created RFQ operations.

## Verification

- 70 Node tests passed across workflow, dispatch, deadlines and cancellation.
- Real Supabase rollback test `supabase/tests/rfq_history.sql` passed: retained
  content/items/communication links, idempotent audit/timeline, sending guards in
  both operation-key formats, cancellation-before-send, invalid actor, deletion/link
  guards, immutable cancellation and rollback on an injected audit permission error.
- Browser test passed on desktop/mobile: required reason, no-recall explanation,
  cancellation payload, disabled repeat and retained conversation.
- TypeScript and production build passed; no new security-advisor findings.
- Commands: `npm run test:rfq-history` and `npm run test:rfq-history-ui`.
- Migrations applied to the connected ARAT project. No real messages sent.

## Limits

Previously deleted RFQs or detached historical links cannot be restored by this
change. Cancellation does not send a supplier cancellation notice, revoke a sent
email, or invalidate an existing customer quote automatically. Existing late-reply
matching rules remain unchanged; cancelled RFQs are not automatically reused as
active RFQ matches. Uncertain transport outcomes still require manual mailbox review.
