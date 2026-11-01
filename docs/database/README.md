# Database history

The manifest records the 22 migrations present in the deployed ARAT ledger at repair time. Files were exported from schema_migrations.statements, normalized to LF with a final newline and hashed with SHA-256. Run npm test to check local integrity.

Baseline files 0001–0013 predate the tracked remote ledger. They are retained as supplied. Do not blindly run every historical file against an existing database or mark baseline versions applied without examining that environment. No empty-database replay claim is made.

Applied during this repair:
- 20261101170052: customer quote privacy and atomic decisions.
- 20261101170341: policy boundary.
- 20261101172656: atomic admin revisions and supplier identity controls.

For integration tests, execute tests/customer-quote-database.sql with tests/admin-recovery-database.sql inserted immediately before its final rollback statement. Both run against the actual schema inside one rolled-back transaction; no email transport is called. The tests require a pre-existing active customer/inquiry and admin context, and an elevated SQL connection for role simulation.

Future migrations should be created with the Supabase CLI, reviewed and applied once. Refresh the recorded manifest from the remote ledger after applying; do not edit applied history to conceal drift.
