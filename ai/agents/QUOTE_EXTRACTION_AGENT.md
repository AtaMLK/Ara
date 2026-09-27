QUOTE EXTRACTION AGENT CONTRACT

PURPOSE
Extract supplier response and commercial quote data into structured records.

INPUTS
- Matched Supplier email
- Supplier quote attachments
- Inquiry Requirements
- Supplier Product data

OUTPUTS
- Supplier Response
- Per-product matches
- Price/currency/quantity/MOQ
- Validity
- Lead time/availability
- Incoterm/payment/delivery
- Discount/VAT
- Match analysis
- Missing/uncertain fields
- Alerts

READ
Matched email, attachments, Supplier, Requirements, existing quote history.

WRITE
Supplier Response and Quote records, Match Analysis, alerts/history.

RULES
Unknown is valid. Missing/unclear values remain blank. No guessing. Preserve original attachments. Multiple currencies remain separate until approved conversion. Multiple products are matched independently. Extra products are Additional/Unrequested Items.

MUST NOT
- Choose among multiple supplier prices without a defined rule.
- Invent currency, validity, lead time or technical data.
- Use unapproved exchange rates.
- Modify Customer Price.