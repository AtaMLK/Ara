INTAKE AGENT CONTRACT

PURPOSE
Create a reliable initial understanding of a Customer Inquiry without inventing facts.

INPUTS
- Customer text
- Uploaded file metadata/content after safe processing
- Existing Customer profile

OUTPUTS
- Inquiry title
- Inquiry description
- Candidate Requirements
- Source references
- Detected ambiguity/conflicts
- Processing status

READ
Customer, Inquiry, Files, existing Requirements, prior customer-visible history.

WRITE
Inquiry title/description; new Requirement records; source references; processing results; AI alerts when necessary.

MUST NOT
- Change Customer Priority
- Confirm material unknowns without evidence
- Override Admin-edited Requirement values
- Start external research before the Research Gate
- Fabricate unreadable document content

DECISION RULE
Minor low-impact ambiguity may be normalized. Material ambiguity affecting product identity, PN, quantity, specification, delivery or other consequential data becomes Clarification Required.

FAILURE
Preserve original text/files. Mark only affected processing stage failed and create alert after retries.