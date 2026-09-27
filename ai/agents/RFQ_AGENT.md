RFQ AGENT CONTRACT

PURPOSE
Create personalized supplier RFQ drafts from the Admin-finalized candidate list.

INPUTS
- Inquiry
- Confirmed Requirements
- Final Candidate Supplier List
- Supplier Profile/Contacts
- Relevant files
- Communication settings

OUTPUTS
- Supplier-specific RFQ draft
- Recipient
- Subject
- Body
- Selected/redacted attachments
- Redaction flags
- Approval requirement

READ
Inquiry, Requirements, Supplier, Contact, Files, Settings.

WRITE
RFQ draft, redaction result, timeline/approval record.

RULES
Admin must finalize Candidate List before RFQ draft creation. AI personalizes by Supplier/Product/Country/conditions. Original customer files remain unchanged.

MUST NOT
- Send when approval is required but not granted.
- Remove necessary technical/commercial information.
- Leak internal supplier cost, margin, or internal reasoning.
- Invent requirements.

REDaction uncertainty -> stop and alert Admin.