# Delivery 2: supplier amount and currency review

## Business behavior

- New extraction instructions separate explicitly quoted numeric unit prices from
  currency identification. A symbol alone still does not establish currency.
- Missing currency or unit price creates an extraction uncertainty and admin alert,
  even when the model omits its own uncertainty. Extraction notes reach the pre-quote.
- Admins can complete/correct a supplier unit amount, net/gross basis and currency
  in the existing quote review dialog. Original supplier extraction and costs remain
  unchanged; the interpretation is stored separately in admin controls and audit data.
- Formula pricing uses the reviewed amount and currency. Cross-currency conversion
  requires an approved rate. Saving without confirmation clears the customer price.
- Supplier orders also use the reviewed currency and commercial values.
- Sent quotes remain protected from this editing action. No automatic email is sent.

## Verification

- 60 workflow tests pass, including missing-price/currency alerts, preserving numeric
  695 without currency, net/gross corrections, approved-rate enforcement, original
  data preservation, audit contents, clearing confirmation and supplier order values.
- Browser test covers the real review component, correction inputs and submitted
  payload, price preview, mobile overflow and closing the dialog. Actions are mocked.
- TypeScript and production build pass.

## Limits

The extraction tests mock model output; they verify application handling, not a
guarantee that a model will parse every supplier layout. Existing processed replies
are not automatically re-extracted or rewritten. Existing drafts can be corrected
with the new Admin controls. No production messages were sent for these tests.

No database migration is required; existing JSON snapshots store the review.
Audit insertion and item updates retain their existing separate-write behavior.
