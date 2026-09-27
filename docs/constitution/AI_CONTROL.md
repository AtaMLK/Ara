ARAT AI CONTROL RULES

ALLOWED AI ACTIONS
- Read authorized records.
- Parse and normalize documents.
- OCR and extract reliable facts.
- Search approved public sources.
- Build research records and candidate suppliers.
- Build/update supplier research profiles.
- Detect permitted duplicates and merge when rules allow.
- Generate clarification drafts.
- Generate RFQ drafts.
- Extract supplier responses and commercial data.
- Create permitted workflow statuses.
- Create Customer Quote Drafts when a defined workflow trigger occurs.
- Create notifications, tasks, alerts, and summaries.

FORBIDDEN AI ACTIONS
- Fabricate missing procurement facts.
- Silently replace Customer Requirements with research findings.
- Override Admin edits or approved values without new valid evidence.
- Use an unapproved exchange rate.
- Choose final Customer Price.
- Expose supplier cost, margin, internal research, internal verification, or AI reasoning to Customer unless an explicit approved workflow says so.
- Re-add a Supplier removed/rejected by Admin in the same Inquiry.
- Resolve material requirement conflicts silently.
- Misattach an unmatched email.
- Guess currency, validity, delivery, quantity, specification, or identity.
- Send communications requiring approval without approval.
- Hard-delete protected business records.
- Perform unsupported unit conversions.

UNCERTAINTY
Minor low-impact ambiguity may be inferred with sufficient confidence. Material ambiguity must be clarified or escalated. Unknown is a valid result. Blank is preferable to an invented value.

ADMIN BOUNDARIES
Admin approval is mandatory where defined for clarification sends, final candidate supplier list, suggested new brands, product/brand/model changes, consequential RFQ sends when approval is required, exchange rates, final Customer Price, quote sends, revision creation when required, and restore operations.
Admin may always Edit, Stop, Cancel, or override within authorized controls.

AI ALERT
An AI Alert is a notification containing the affected Record, workflow stage, problem, and required action when known. Alert is retained as history; it does not need a separate Resolved state. When the underlying issue is fixed, the workflow can resume.

RESULT/AUDIT
Store result, source/evidence references, timestamps, relevant metadata, and internal confidence when useful. Never store or expose chain-of-thought. AI Result History retains current and previous results. Admin correction becomes Current Value; AI cannot overwrite it without new valid Customer/Source evidence.

FAILURE
On failure: detect -> alternative valid method -> up to 3 retries for temporary task failure -> AI Alert. Primary model failure uses fallback. If both primary and fallback fail, stop affected stage and preserve earlier state.

DATA ISOLATION
Customer can read only own customer-facing records. AI tools must enforce the same authorization boundaries as the application. Internal data must never be exposed through an AI response merely because the model can read it.

NO SCORING
ARAT may report factual supplier performance metrics but must not create supplier scores/rankings in MVP.

LANGUAGE
Customer-facing MVP is English. Admin supports English and Turkish. Architecture is i18n-ready for Persian and Russian. Internal normalized AI language is English.