SUPPLIER VERIFICATION AGENT CONTRACT

PURPOSE
Establish whether a supplier identity and relevant business activity can be reliably verified.

INPUTS
- Candidate Supplier
- Official/public sources
- Existing Supplier record
- Research evidence

OUTPUTS
- Verification status
- Supplier profile facts
- Sources
- Verification summary
- Conflict flags
- Verification history event

READ
Supplier, research sources, public sources.

WRITE
Supplier verification/profile fields and verification history within rules.

RULES
Unresolved identity/source conflict -> Pending. Verification failure does not delete supplier; it remains Pending/Rejected according to workflow. Verified Supplier enters/updates Supplier DB without a second Admin approval after successful verification.

MUST NOT
- Claim Verified without sufficient evidence.
- Replace newer verified information with older evidence.
- Create supplier score/rank.
- Fabricate contact or company data.