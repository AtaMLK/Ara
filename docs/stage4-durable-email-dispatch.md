# Delivery 4: durable SMTP dispatch reservations

## Business behavior

Every SMTP send now requires a stable operation key and reserves that key in
`email_dispatches` before contacting SMTP. Concurrent callers cannot reserve the
same key twice. The payload fingerprint covers sender, reply-to, recipients, subject,
HTML, plain text, attachment names/types/CIDs and attachment content hashes.

- A completed identical request returns the recorded provider result without SMTP.
- A changed payload using an existing key is rejected for review.
- An in-progress or uncertain request is blocked from replay, including after restart.
- SMTP acceptance is recorded before the caller updates RFQ/quote/history records.
- If SMTP or recording its result fails, the durable reservation remains blocking;
  its status becomes delivery_uncertain and an urgent Admin alert is attempted.
  A known provider Message-ID is retained when available.
- Worker scans change abandoned sending records older than five minutes to uncertain
  and create one alert atomically. Fresh sends are not changed.
- Admin pages show relevant unresolved recipient/subject/Message-ID information.
  Customer quote pages also show recorded SMTP acceptance for that revision.
- SMTP has 10-second connection/greeting, 60-second idle and 90-second total send
  limits. Requests get a stable Message-ID for mailbox investigation.

The common provider protects RFQs, customer quotations, supplier orders and existing
automatic clarification replies. Missing keys are rejected before contacting SMTP.
No new automatic sending or approval behavior was introduced.

## Verification

- 68 Node tests passed across workflow, worker deadlines and email dispatch.
- Tests use fake SMTP and simulate concurrent requests, SMTP failure, post-acceptance
  database failure, reservation failure, content/attachment changes and recipient
  rejection. The server status panel is rendered and authorization checked.
- Live rollback SQL test `supabase/tests/email_dispatch.sql` verified key uniqueness,
  abandoned-send detection, idempotent alerts and access for Admin/customer/anonymous
  roles. Dispatch writes and the expiration RPC are service-role only.
- TypeScript and production build passed; security advisors added no new findings.
- Migration applied to the connected ARAT Supabase project. No real email sent.
- Run `npm run test:email-dispatch` for dispatch regressions.

## Delivery boundary and operation

SMTP acceptance is not proof of final mailbox delivery. See the transport documentation:
https://nodemailer.com/smtp

This provides one transport attempt per retained operation key, not an exactly-once
delivery guarantee from the remote mail server. Delivery uncertainty requires checking
the sent mailbox and contacting the recipient before any separate approved resend.
This delivery deliberately has no automatic unlock/resend button.

The dispatch ledger is authoritative for transport status; existing RFQ/quote/history
writes remain separate. A crash after SMTP acceptance can leave their business state
behind the ledger and require reconciliation. Cached provider results do not make
those caller-side writes transactional. A regenerated PDF with different bytes also
requires review rather than silently reusing the same operation key.

Old emails are not retroactively imported into the ledger. Existing communication
history checks remain. Stale-send alerts require a running worker/cron. Existing
security advisories from earlier deliveries remain separately tracked.
