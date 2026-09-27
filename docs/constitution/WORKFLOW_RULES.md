ARAT WORKFLOW RULES

RESEARCH
Scope: Web Search, public specialized sources, existing ARAT information. AI determines depth, stop condition, rerun scope, and presentation using importance, source quality, match confidence, and existing status. Every search result is saved, including rejected candidates. Important new information may trigger selective rerun; prior research remains.
Research completes when enough relevant Supplier information exists for RFQ or when no suitable supplier can be found. No Suitable Supplier -> stop research, preserve history, no RFQ.

SUPPLIER CANDIDATES
AI creates Candidate Supplier List. Admin may add/remove/edit/finalize. Admin-removed or rejected candidates cannot be re-suggested by AI for the same Inquiry. Admin may manually add a candidate without research. Verification failure -> Pending, not valid Verified Supplier. Recheck when new relevant information arrives, not by mandatory periodic schedule. Verification success -> Verified and enters/updates Supplier DB without a second Admin approval.

RFQ
Candidate selection considers Product Match, Availability, Country, Verification. Admin finalizes list. Only then AI creates RFQ drafts. RFQ is personalized by Supplier/Product/Country/conditions. AI chooses relevant attachments. AI may redact internal/sensitive data from outbound copies but must preserve original customer file. Redaction uncertainty -> stop and alert Admin.
MVP channel is Email. Provider is abstracted/swappable. Sender default: purchase-dep@aryaautomation.com; configurable in Settings. Replies return to same sender by default.

EMAIL MATCHING
Process only RFQ/Supplier/Inquiry-related emails. Match first by RFQ ID/Reference; otherwise Supplier + Subject + Thread + Message + Attachments. Unmatched email -> Unmatched Emails + Admin alert; never misattach. Once matched, extract supplier response immediately.

SUPPLIER RESPONSE
Match states: MATCH, PARTIAL MATCH, MISMATCH, UNKNOWN. Insufficient evidence -> UNKNOWN. Reliable fields are extracted; unclear fields remain blank; no guessing. Missing validity, price, currency, lead time, availability, payment terms, Incoterm, or delivery method -> blank + Admin notification. Supplier quantity is stored exactly; no conversion. Quantity difference is notified. MOQ is stored exactly; MOQ above requested quantity is shown/notified and does not automatically mean Partial Match.
Multiple currencies remain separate; no conversion without approved rate. All attachments are saved. Duplicate responses merge into the main response with traceability. Quote updates update current state while preserving old state. Technical differences are recorded in Match Analysis.
Multiple products are matched separately under one Supplier Response. Extra/unrequested items are stored separately and notified. Fewer quoted products leave unquoted products without quote and notify Admin.

COMMERCIAL EXTRACTION
Price ranges are preserved; AI does not select a value. Price tiers are all stored; applicable tier is selected from customer quantity. Discounts store List Price, Discount, Net Price. If net is absent, AI may calculate it and mark AI Calculated + notify Admin. VAT stores Net/VAT/Gross. Conditional prices preserve price, condition, and deadline/terms. Conflicting conditions are preserved and escalated. Multiple payment options are preserved; AI does not choose. Multiple delivery options default to fastest while preserving alternatives; Admin may override. Expired supplier quotes become Expired and are not extended/deleted by AI. Supplier extensions update current validity and preserve old date; no new quote solely for extension.
Per-product fields are supported for validity, MOQ, lead time, currency, Incoterm, payment, delivery, discount, VAT. Unit conversion is allowed only when explicit; preserve original and converted values; fractional order units round DOWN to whole units and notify. Do not round Customer Quantity upward for minimum order units; show feasible order quantity and notify.
Discount rule: explicit unmet condition removes discount; no condition does not remove it; “Additional X%” can stack when applicable; explicitly stackable discounts stack; ambiguous stacking does not.

EXCHANGE RATES
AI may find/extract/propose rates. Every rate requires Admin approval before use. Approved rate stores From, To, Rate, Validity, Source, Approval. No approved rate -> no conversion. Historical quotes never change because of later rates.

CUSTOMER QUOTE
Customer price is Admin-controlled. AI may create a Customer Quote Draft when workflow triggers it but never choose final Customer Price. Product total = quantity x unit price. Quote total = sum of product totals. Supplier currencies may differ; approved rates are required for conversion.

REVISION
Quote lifecycle: Draft -> Pending Approval -> Sent -> Accepted/Rejected/Expired; Revision Requested is used during revision workflow. Customer can request revision for any Quote not Accepted. Request includes Reason + optional text. Reasons: Price, Quantity, Delivery Time, Product/Specification, Payment/Terms, Other. Admin approval is required. Accepted quote cannot be revised. Rejected/Expired may receive request; approved revision for expired quote creates a new Quote with a new Reference. Price/quantity/delivery/terms/payment changes continue same Inquiry/reference as revision. Product changes create a new Quote for new Product. Supplier direct price change may automatically create a Customer Quote Draft revision; Admin sets customer price. Unrelated research price changes do not alter quotes.
Customer acceptance -> Inquiry Converted and procurement workflow ends. MVP excludes PO/payment/accounting.

QUOTE EMAIL
AI generates quote email from scratch in English. Admin reviews/edits/approves before sending. Subject is AI-generated and editable. Provider tracking, if supported: Sent, Delivered, Opened, Clicked, Replied. Customer reply matches to Quote/Revision/Inquiry; AI analyzes and alerts Admin when action is needed. Simple receipt acknowledgements become Admin Tasks.