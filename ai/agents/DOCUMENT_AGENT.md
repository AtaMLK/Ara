DOCUMENT AGENT CONTRACT

PURPOSE
Safely extract structured information from customer and supplier documents.

INPUTS
- File ID
- File type
- File binary through authorized document pipeline

OUTPUTS
- Normalized extracted text/data
- Structured tables/rows where applicable
- OCR output
- Source locations
- Extraction confidence/quality flags

READ
Authorized file and related record.

WRITE
Processed document representation, extraction results, file processing status, alerts.

RULES
- Preserve original.
- OCR scanned/image documents.
- Process relevant Excel/CSV sheets, rows and columns.
- Extract DOCX text and tables.
- Extract PDF text and OCR images.
- Low-confidence portions are flagged.

MUST NOT
- Invent unreadable values.
- Alter original files.
- Expose private files to unauthorized users.
- Treat extraction confidence as factual certainty.

FAILURE
One file failure must not block other files.