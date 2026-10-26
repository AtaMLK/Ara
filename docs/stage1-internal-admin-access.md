# Delivery 1: internal admin reads

Date: 2026-10-26

## Business behavior

Active admins can read internal research, supplier relationships, verification history,
document processing, audit records, unmatched mail and settings. Customers retain their
existing inquiry access and cannot read these internal tables. Inactive admins and
anonymous users cannot read them. Updates continue through authorized server actions;
this migration grants no INSERT, UPDATE or DELETE policies.

## Implementation and acceptance

- Added SELECT policies on 14 previously policyless RLS tables using `public.is_admin()`.
- Applied to the connected ARAT Supabase project. The 14 missing-policy notices are gone.
- Ran `supabase/tests/internal_admin_reads.sql` as database owner against seeded data:
  active admin, customer, anonymous, inactive admin, customer inquiry visibility and
  settings write denial passed. The transaction rolls back all test changes.
- The SQL test requires existing active admin/customer profiles and a customer inquiry;
  empty-table checks are supplemented by policy inspection and a sentinel settings row.
- Supplier workflow: 57 tests passed; TypeScript check and production build passed.

## Delivery boundary

This is a database access fix, not acceptance of the entire procurement workflow.
Existing security advisories remain for function search paths, callable authorization
helpers and leaked-password protection. They require separate review:
https://supabase.com/docs/guides/database/database-linter
https://supabase.com/docs/guides/auth/password-security

Next business acceptance target: supplier quote extraction, currency ambiguity,
and mandatory admin review before customer pricing. Worker recovery, email delivery
consistency and preservation of RFQ history remain subsequent delivery items.
