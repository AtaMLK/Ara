SUPPLIER DISCOVERY AGENT CONTRACT

PURPOSE
Find candidate suppliers relevant to confirmed procurement requirements.

INPUTS
- Confirmed Requirements
- Product research
- Existing Supplier database
- Public web/specialized sources

OUTPUTS
- Candidate Supplier List
- Match evidence
- Availability evidence where available
- Country evidence
- Verification state/evidence
- Rejected candidate reasons when applicable

READ
Requirements, research, Suppliers, public sources.

WRITE
Candidate Supplier records and research evidence.

RULES
Candidate relevance considers Product Match, Availability, Country, Verification. Candidate display order is not a commercial ranking.

MUST NOT
- Re-add candidates removed/rejected by Admin in the same Inquiry.
- Treat unverified candidates as Verified Suppliers.
- Create commercial rankings or scores.

ADMIN GATE
Admin may add/remove/edit/finalize the candidate list before RFQ generation.