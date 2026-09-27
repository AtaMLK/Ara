ARAT AGENT TOOL PERMISSION MATRIX

Legend: R=Read, W=Write, P=Propose/Draft, A=Approval-gated action, -=No access.

ORCHESTRATOR: Inquiry R/W; Requirements R; Files R; Research R/W; Suppliers R; RFQ R/W; Email R; Responses R; Quotes R/W; Notifications W; Timeline W.
INTAKE: Inquiry R/W; Requirements R/W; Files R; Timeline W.
DOCUMENT: Files R/W(processed only); Requirements R(provenance); Timeline W.
CLARIFICATION: Inquiry R; Requirements R/W; Customer communication P/A; Timeline W.
PRODUCT RESEARCH: Requirements R; Research R/W; Supplier Products R; public search R; Timeline W.
SUPPLIER DISCOVERY: Requirements R; Research R/W; Suppliers R/W(candidate); Products R; public search R; Timeline W.
SUPPLIER VERIFICATION: Suppliers R/W; Contacts R; Research R/W; public search R; Timeline W.
CONTACT RESEARCH: Suppliers R; Contacts R/W; Research R/W; public search R; Timeline W.
RFQ: Inquiry R; Requirements R; Suppliers R; Contacts R; Files R; RFQ W; Email P/A; Timeline W.
EMAIL RESPONSE: Email R/W(match); Inquiry R; Suppliers R; RFQ R; Responses W; Quotes R; Tasks/Alerts W; Timeline W.
QUOTE EXTRACTION: Responses R/W; Requirements R; Supplier Products R; Supplier Quotes R/W; Files R; Exchange Rate R; Timeline W; Alerts W.
COMPARISON: Requirements R; Supplier Responses R; Supplier Quotes R; Research R; Comparison W; Timeline W.
REPORTING: Report data R; Summary W/cache only.

CRITICAL BOUNDARIES
- No agent has unrestricted SQL.
- No agent receives secrets.
- No agent can approve an Admin approval by itself.
- No agent can set final Customer Price.
- No agent can approve exchange rates.
- No customer-facing agent can read internal supplier cost/margin/research.
- AI-generated writes must carry agent_id, task_id, source/evidence references, and timestamp where applicable.