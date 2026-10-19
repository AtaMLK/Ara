# Supplier selection rules

Updated 19 October 2026.

- Each item initially displays five supplier rows. Existing stored rows are revealed five at a time without AI calls. For a new discovery, only the first five company domains go through supplier/contact review; remaining search evidence stays in storage. **Show 5 more suppliers** reviews the next page and stops appearing when the stored evidence pool is exhausted. Rejected/non-commercial evidence may produce fewer than five valid suppliers.
- A verified supplier stays verified until an Admin changes the status. Automatic verification skips verified suppliers and respects recorded Admin overrides. Verification updates also check that the supplier record has not changed during an AI assessment.
- Verified brand relationships are saved in `supplier_brands`. New inquiries check these relationships before external research and reuse the supplier and existing contacts, with a preferred position in the shortlist. Compatible historical verified candidate/brand evidence is also reused. Supplier identity verification does not establish stock or availability of a new model.
- The Admin's certified-distributor rule routes **GMI / G.M INTERNATIONAL**, **CTC / Connection Technology Center**, and **Hansford Sensors**, including their supplied long names, exclusively to **https://aryaautomation.com**. No external supplier research is performed for those items. The rule creates or reuses Arya's supplier record, preserves an Admin verification override, hides/removes competing candidates under this rule, and is enforced again before RFQ preview/send. Contact information is taken from existing records or the configured company mailbox, never guessed.
- In an inquiry already undergoing external supplier review, verifying the first page does not suppress later pages. The decision to reuse known brand routes is fixed when that inquiry's research begins; newly verified relationships become shortcuts for subsequent inquiries.
- Selecting a supplier selects its ready, unsent candidates across the inquiry's items. Selection survives switching between item shortlists. RFQs are grouped by supplier ID: one preview, one RFQ, one email and one set of item rows per supplier. Item descriptions, models, quantities and specifications remain separate within the combined message. Every included candidate receives the same sent-RFQ reference. Admin must review the combined preview before sending; changed selections or requirements invalidate the previous preview.

No database migration is required: the implementation uses existing supplier, brand, candidate, research-case and RFQ tables. No live supplier/customer emails were sent during development.

## Checks

- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run test:supplier-workflow`
- `npm.cmd run test:supplier-ui`

The workflow tests use simulated research/AI providers and an in-memory database. The browser test renders the real supplier panel with mocked server actions, checking five-row pagination, requesting the next batch, exhausting results, honoring a pending status despite stale evidence, cross-item selection, and one combined preview. Live provider and deployed database behavior still need staging validation after deployment.
