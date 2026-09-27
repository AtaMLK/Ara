# Customer clarification replies by email

ARAT supports two equivalent customer reply channels for a clarification:

1. Customer Portal: the customer submits the answer in the inquiry.
2. Email: the customer replies directly to the clarification email.

Both paths use the same server-side clarification answer handler and continue the inquiry workflow.

## Environment

Add:

```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
EMAIL_FROM=ARAT <purchase-dep@yourdomain.com>
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

## Resend setup

1. Verify the sending domain in Resend.
2. Configure the same domain for inbound email receiving, or use a Resend inbound address during testing.
3. Create a webhook for the public endpoint:
   `https://your-domain.com/api/webhooks/resend`
4. Subscribe the webhook to `email.received`.
5. Copy the webhook signing secret into `RESEND_WEBHOOK_SECRET`.
6. Make sure replies to `EMAIL_FROM` are delivered to the Resend inbound address/domain.

Resend signs webhook requests, so ARAT rejects unsigned or expired webhook requests.

## Matching rules

ARAT matches an incoming customer reply in this order:

- Customer email identity.
- Inquiry reference in the clarification subject.
- The clarification email communication metadata.
- A unique pending clarification.

If the email cannot be matched uniquely, it is stored as an unmatched email and an Admin AI alert is created. ARAT does not guess.

## Duplicate protection

- Incoming Resend email IDs are stored as communication provider IDs.
- A unique database index prevents duplicate provider message IDs.
- Clarification answer application is version-checked.
- Resend sends use an idempotency key derived from the clarification ID.

## Customer experience

The clarification email explicitly tells the customer they can either:

- Reply directly to the email, or
- Open the ARAT request and answer in the portal.

The two channels update the same requirement and clarification record.
