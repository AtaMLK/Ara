# Delivery 6: location evidence and five-company review pages

## Business behavior

- Published company country/address evidence can prioritize a Turkish `.com` site.
  Search locale, a query mentioning Turkey, delivery destinations and phone prefix
  alone do not establish company country. Explicit foreign country evidence is kept.
- A bounded location lookup checks up to eight previously unreviewed company domains
  per discovery pass, using the existing public-page fetch restrictions/timeouts.
  Address provenance is retained with research data and candidate evidence.
- Obvious marketplaces, third-party datasheet sites, government/information portals
  and support/documentation domains do not consume the company evidence window.
  Published marketplace identity is also excluded during the location lookup.
- Five reviewed domains are no longer treated as five supplier choices. When the
  candidate target is short and unused evidence remains, discovery queues another
  owned worker pass. Raw-domain cursors and requested candidate counts are separate.
- The UI shows five distinct company choices initially, then five more on request.
  It deduplicates supplier IDs/websites within each requested product. Cross-product
  rows remain available for grouped RFQs. Foreign options remain accessible.
- Rejected/reviewed domains are not repeatedly sent through discovery. Exhausted
  evidence stops backfill without fabricating the missing supplier rows. The UI
  identifies pending evidence review and prevents another load-more request then.
- Existing Arya/exclusive-brand and preferred-Siemens routing remains in force;
  source location never bypasses supplier verification or email approval.
- Turkish-language search terms were added alongside international queries.

## Product matching

Exact model evidence uses published URL/title/snippet content, not the search-query
metadata returned by Serper. Longer model numbers and hyphenated suffix variants
are not silently treated as the exact base model. Unproven exact matches downgrade
or are rejected; same-brand claims require published brand evidence when stated.

## Verification

- 75 Node tests pass across sourcing, workflow, dispatch, worker recovery and history.
  Cases include Turkish `.com` evidence, shipping-only/unknown country, source noise,
  deduplication, rejected first-page backfill, exhaustion, non-repetition, model-prefix
  and suffix distinctions, and unchanged Arya brand routes.
- Real supplier-panel browser test passes: five initial choices, domestic ordering,
  stored foreign options, local/server pagination, exhaustion, duplicate company
  removal, verified status, cross-item selection and grouped message preview.
- Live Serper tests ran for Siemens 6ES7214-1AG40-0XB0, Omron E2E-X5ME1 and
  Schneider Electric LC1D09M7, followed by read-only model validation of their saved
  evidence. Each final model pass returned six source-backed company proposals.
  These are proposals, not verified identities, stock confirmations or six exact
  model matches. Similar-model suppliers stay distinguished from exact matches.
- Live QA identified Stock Tuner as a marketplace, confirmed on its official site:
  https://stocktuner.com/ . It is excluded from direct supplier selection.
- TypeScript and production build pass. No database migration was needed.
- Live diagnostics created no inquiry/supplier records and sent no email. Workflow
  integration tests use an isolated fake database; live validation is read-only.

## Running checks

- `npm run test:supplier-search`
- `npm run test:supplier-workflow`
- `npm run test:supplier-ui`
- Explicit paid-provider smoke checks: `node tests/live-supplier-search.cjs`, then
  `node tests/live-supplier-validation.cjs`. Reports go to ignored `test-results/`.

## Boundaries

Fewer than five supported companies remain visible when evidence is exhausted.
Location lookup is bounded and unreachable/unstated locations remain unknown.
Discovery does not guarantee authenticity, actual availability, a published email,
or delivery capability; normal verification and RFQ gates remain required.
Technical research evidence stays stored even when excluded from company paging.
Backfill requires the existing worker/cron. Old completed inquiries were not bulk
reprocessed; the logic applies to subsequent discovery/load-more work.
