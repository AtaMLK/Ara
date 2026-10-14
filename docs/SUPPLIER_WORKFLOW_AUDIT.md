# Supplier workflow code audit

Reviewed on 14 October 2026. Scope: document extraction, intake, clarification, research, discovery, contact enrichment, verification, admin shortlist, RFQ preparation and sending guards. A project-wide TypeScript check and production build also covered the application routes, data loaders and email modules. This is not a claim that every possible runtime issue in the repository has been eliminated.

## Findings corrected

| Severity | Problem | Correction |
| --- | --- | --- |
| Critical | Supplier verification treated a name, country and website as sufficient proof. Discovery never queued the verification agent. | Discovery now queues verification. Automatic verification requires readable official evidence, an active published email and an evidence-based agent assessment. Unsupported identities remain pending. Existing verified or rejected supplier decisions are preserved. |
| High | Contact search results use camelCase, while enrichment read snake_case properties. Contact results were discarded. | Corrected the provider boundary and restricted contact searches to the supplier's domain. |
| High | Email regular expressions matched a literal backslash instead of a dot. Named-contact emails disappeared. | Corrected validation and extraction; preserve explicitly published emails, including mailto links. |
| High | Equal quantities, brands or specifications across separate products could disappear on intake retries. | Deduplicate within an item group; protect admin-edited fields in that group. |
| High | Unreadable or failed documents could be followed by research on incomplete requirements. | Fail the document stage, retain the affected file and stop intake/research until processing succeeds. Failed files can be retried. |
| High | Supplier candidate and research-result persistence failures could be silently ignored. | These writes now fail visibly and enter workflow retry handling. |
| High | Successful executions were implicitly requeued. Competing workers could both execute one running task. | Enqueue preserves existing executions; job claims use a conditional state transition, and a competing worker returns without executing. Concurrent initial enqueue cannot overwrite an existing claim. |
| High | Cached completed research fell into the “provider not connected” branch. | Completed evidence is reused and handed to discovery without another search. |
| High | Research cache did not account for changed requirements. | Store and compare the confirmed requirement snapshot. Changed requirements require new evidence, reopen discovery and return previous finalized candidates to proposed status until supported again. |
| High | Hardcoded GMI/Hansford models and special relevance exceptions could contaminate other inquiries. | Use the actual requested identity and generic evidence rules. Remove brand-specific example leakage and guessed domain queries. |
| High | Manufacturer labels could become “exact product” matches; some fallback matching overclaimed exactness. | Manufacturer relationships alone do not imply an exact model. Requested model/part numbers must appear in supporting evidence for the exact label. |
| High | An arbitrary discovered URL could access internal services, with unbounded response reads. | Pin connections to public DNS addresses, reject private/local addresses and credentials, bound response size and time, and allow only bounded same-site redirects. |
| High | Admin verification replaced provenance and could erase the flag preventing another RFQ. RFQ sending did not select that flag. | Merge verification evidence, retain sent flags, select the required evidence, record admin verification history and reject selections outside the inquiry. |
| Medium | RFQ item grouping only recognized intake references, losing document-derived details. Only one model was included; delivery terms were omitted. | Use the full item source reference. Include all model/part-number fields and delivery/other requirements in the actual RFQ and preview. |
| Medium | Inferred country could be overwritten with the original unknown country during candidate persistence. Multiple new addresses could all become primary. | Persist the resolved country and choose one primary address. Preserve previously verified supplier profile values. |
| Medium | The admin shortlist displayed only one contact channel and lacked contact provenance/gap reporting. | Add expandable full contact details, evidence links, verification explanation and missing-field reporting. |
| Medium | Total provider failure could look like a legitimate completed search with zero suppliers. | Failed searches remain failed and retryable. Partial query failures produce a coverage alert. |
| Medium | Numerous existing TypeScript errors prevented a production build. | Normalize to-one embedded relations, restore missing notification/timeline schemas, correct email-analysis types and IMAP result handling, and install mailparser type definitions. |
| Medium | Requirement updates could address a requirement outside the agent's inquiry. | Scope both read and conditional update to the inquiry and preserve admin authority. |
| Low | Date validation, email whitespace normalization and workflow label expressions had the same escaping error. | Correct the regular expressions. |

## Resulting process

1. Extract all readable attachments while retaining their original files. Keep product-specific field groups and source references.
2. Extract requested customer-text items, quantities, brand, model/part numbers, specifications and delivery requirements. Preserve existing admin changes.
3. Run the clarification decision before confirming requirements and researching suppliers.
4. Search each confirmed product independently. Keep evidence tied to the product requirement and its current values.
5. Discover supported company candidates, extract contact facts from official evidence, retain source information and disclose missing fields.
6. Verify supplier identity and activity using official evidence. Supplier identity verification is separate from exact product availability.
7. Present the admin with the candidates, all stored contact channels, product-match qualification, source links and verification status.
8. Prepare RFQs with the product's confirmed details. Sending remains an explicit admin action.

## Verification

- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run test:supplier-workflow`
- `git diff --check`

Regression tests run the real workflow implementation against an in-memory Supabase-shaped adapter and simulated research/AI providers. Cases cover two products with equal quantities, admin-edited quantities, unreadable attachments, missing contacts, cached research and requirement changes, concurrent claims, schema normalization, private-address rejection, admin provenance preservation, mixed-inquiry RFQ selections and provider outage handling. They do not consume research credits or send emails.

For embedded relation behavior, the review also consulted [Supabase's TypeScript documentation](https://supabase.com/docs/reference/javascript/typescript-support) and [join documentation](https://supabase.com/docs/guides/database/joins-and-nesting).

## Remaining limitations and follow-up work

- **Live integration has not been certified.** No live inquiry was submitted, production database migration applied, live search/AI response accepted, or supplier email sent. Validate a representative inquiry in staging using real attachments and providers before deployment. This also needs to confirm deployed migrations, relation cardinality and RLS behavior.
- **Supplier coverage is bounded.** The configured search engine returns a finite set per query. The UI includes evidence-supported persisted candidates; it cannot promise every supplier in the market. A supplier may not publicly publish a person, phone, address or email. Missing information remains explicit rather than invented.
- **Published contact information is not proof of deliverability.** Email syntax and evidence are checked; there is no mailbox ownership/delivery confirmation or verification of stock. Admin review remains useful for ambiguous company identities and exact model availability.
- **Same-name company identity still needs care.** Existing supplier lookup is an exact legal-name lookup, without a complete domain/country entity-resolution key. Distinct companies with the same legal name need explicit review; automatic identity assessment alone is not a complete entity-resolution system.
- **Worker crash recovery remains incomplete.** Competing workers no longer duplicate a running job, but a process killed while a job is running still needs a lease/heartbeat and stale-job recovery mechanism. No such database lifecycle change was made in this review.
- **Multi-table writes and SMTP sends are not one transaction.** Verification history/contact writes and RFQ sending can still partially succeed. A durable outbox and database transaction/RPC are needed for stronger crash recovery and send deduplication. Preserving the sent flag addresses the observed ordinary retry bug, but does not provide exactly-once SMTP delivery.
- **AI completeness still requires representative fixtures.** The regression providers are deterministic. Long documents, conflicting quantities, multiple locations, OCR errors, customer clarifications and model aliases require additional staging cases with actual AI outputs.
- **Dependency advisories remain open.** The local npm audit reported high-severity dependency chains involving Next.js, source-map-js/PostCSS and xlsx. Relevant advisories include [Next.js image optimization SSRF](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), [source-map-js denial of service](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [SheetJS prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [SheetJS ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9). These were recorded rather than applying an unreviewed breaking dependency migration. Many dependencies are declared as `latest`; package pinning and lockfile maintenance remain necessary.
- **Lint configuration is outdated.** The package still declares `next lint`, while the installed Next.js build uses a newer toolchain. A separate ESLint configuration is needed; the completed checks here are TypeScript, production build and regression tests.

No supplier/customer outreach was performed. Existing unrelated workspace edits were retained.

## Supplier reply follow-up: changed sender address

The user clarified that the supplier replied from a different sender mailbox, such as `sales@supplier.com` instead of the stored `info@supplier.com`.

- Previously, sender identity lookup returned `supplier_not_found` before examining RFQ/thread evidence. A new mailbox now matches only when it has both a unique RFQ reference/thread and the same company email domain as the RFQ recipient or a known active contact. Shared consumer domains and unrelated sender domains do not establish supplier identity.
- Thread matching now checks the actual SMTP `provider_message_id`, including when `thread_id` is absent. Repeated reply prefixes are normalized.
- Received supplier responses explicitly enqueue quote extraction. Completed extraction reopens for another reply; RFQ-state continuation processes pending responses instead of always waiting. A later quote also reopens comparison.
- Previously unmatched replies can be reconsidered on subsequent inbox polling. The original communication is reused, the supplier response is stored once and the unmatched record is marked resolved. Partially persisted supplier replies can resume, and duplicate received responses requeue unfinished extraction.
- Incoming recipient/thread information and matching method are retained for diagnosis. Future outgoing emails default their Reply-To to the monitored inbox, with an optional `SMTP_REPLY_TO` override.
- Local configuration was inspected only for non-secret mailbox settings: ARAT polls `purchase-dep@aryaautomation.com` / `INBOX`. This is independent of the supplier changing their sender address; no mailbox credentials were changed.
- Regression coverage increased to 15 cases, including alternate sender matching, rewritten subjects, actual SMTP message IDs, unrelated/shared domains, unmatched reply recovery, duplicate handling and reopening completed extraction. Tests use simulated providers and database records. Actual inbox delivery, the user's particular email and live quote extraction remain unverified. Existing IMAP scanning is bounded to the latest 100 messages from seven days, so recovery applies only to replies present in that scanned set.
