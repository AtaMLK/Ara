ARAT REFERENCE, TIMELINE, SEARCH, REPORTING AND SETTINGS RULES

REFERENCES
Inquiry: CustomerCode-DDMMYY-N.
Quote: CompanyCode-DDMMYY-N.
Revision: CompanyCode-DDMMYY-N-R1/R2/R3.
Customer Code is AI-generated, stable, meaningful, and collision-safe. Company Code is Admin-configurable. Historical Quote References never change when Company Code changes. Quote Reference date is the date sent to Customer. Same-day independent quotes increment N. Revision keeps original Quote date; actual send date is separate. References appear in PDF and Email.
Supplier and Product have no separate business-facing code in MVP.

TIMELINE
Every Inquiry retains a full timeline: creation, file upload/process, AI interpretation, clarification, requirement changes, research start/update, supplier found/verified, RFQ created/sent, supplier response, quote created/revised, customer actions, approvals, status changes, conversion/closure. Customer sees only customer-visible events; Admin sees full timeline.

DASHBOARD/NOTIFICATIONS
Admin Dashboard: Needs Attention + Recent Activity. Needs Attention includes open approvals, urgent tasks, AI alerts, and important actionable items with direct links. Activity filters: type + date range; text search supported.
Notification categories: Approval, Task, AI Alert, Customer, Supplier, Email, System. Priority Normal/Urgent. AI may set; Admin may change. Approval notification includes direct link and Approve/Edit/Reject. Notifications have Unread/Read and Mark All Read. No separate Resolved state is required; history/read state remains.

GLOBAL SEARCH
Entities: Inquiries, Suppliers, Customers, Products. Exact match only, case-insensitive. Inquiry fields: Reference/Title. Supplier: official name and authorized identity. Customer: ID/Name/Company Name. Product: Name/Model-PN. Results grouped by entity, max 5/category + View All. No-result screen does not suggest AI-similar matches. Click opens Preview Modal and can navigate to Detail. Top bar supports Ctrl/Cmd+K.

REPORTS
MVP: Inquiry Volume; Inquiry-to-Quote Conversion; Quote-to-Conversion; Supplier Performance; Supplier Response Time; Average Lead Time; Price History; Non-Conversion Reasons.
Supplier Performance is factual history only: RFQ Count, Response Rate, Response Time, Quote Count, Successful/Unsuccessful Quotes, Historical Lead Time, Price History. No score/ranking.
Date filters: Today, Last 7 Days, Last 30 Days, This Month, This Year, Custom. Each report has Chart + Table and AI Summary based only on current data/filter. Summary refreshes with filters. Drill-down preserves filters/date range. Date comparison supports two ranges. Export Excel/CSV/PDF and must represent current page data/filter/date range exactly.

SETTINGS
Sections: Company Information, Email Provider, Sender Email, Exchange Rates, AI Settings, Notification Settings, System Preferences.
Company fields: Company Name, Legal Name, Address, Country, Phone, Email, Website, Tax/Registration Information. Logo is stored in Settings, may be used in Quote/PDF/Email, and changing it does not alter historical documents.
Email provider is configurable/swappable; workflow/history remain provider-independent; credentials are secure. Default sender: purchase-dep@aryaautomation.com. Exchange rate approval is mandatory. AI settings include primary/fallback model; business rules remain model-independent.

BACKUP
Database + Files; daily; 30 versions; encrypted at rest; keys/secrets separate. Restore Admin only, requires final approval and audit. Restore scope: Database, Files, or Both.

ENVIRONMENTS
Development, Test, Production.

MVP NON-GOALS
No multi-company SaaS tenancy, customer self-registration, public customer/supplier search, supplier scoring/ranking, AI commercial price recommendation, unapproved currency conversion, PO execution, payment, accounting, model fine-tuning as the initial AI strategy, chain-of-thought exposure, or separate Solution Center before procurement platform foundation.