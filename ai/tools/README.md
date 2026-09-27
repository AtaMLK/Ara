ARAT AI TOOL LAYER

AI agents never receive unrestricted database or network access. Every capability is exposed through a bounded tool contract.

TOOL PRINCIPLES
- Authorization is enforced server-side.
- Agent permissions do not replace application authorization.
- Tools validate inputs against schema and business rules.
- Tools return structured results.
- Mutating tools must be idempotent where retry is possible.
- Every consequential mutation records actor=AI and the responsible Agent/Task ID.
- Tools must not expose hidden/internal data to a customer-facing agent.
- Search tools preserve source URLs and retrieval metadata.
- Write tools reject stale Admin-overridden values when a current version/updated_at check is required.

TOOL GROUPS
1. inquiry.read / inquiry.write
2. requirement.read / requirement.write
3. file.read / file.process
4. research.search / research.write
5. supplier.read / supplier.write
6. supplier.product.read / supplier.product.write
7. supplier.brand.read / supplier.brand.write
8. supplier.contact.read / supplier.contact.write
9. rfq.read / rfq.write
10. email.read / email.write / email.send
11. supplier_response.read / supplier_response.write
12. quote.read / quote.write
13. exchange_rate.read / exchange_rate.propose
14. notification.write
15. timeline.write
16. report.read / report.summary
17. settings.read

TOOLS THAT MUST NOT BE DIRECTLY EXPOSED TO GENERAL AGENTS
- unrestricted SQL
- arbitrary filesystem access
- unrestricted HTTP requests
- secret/credential retrieval
- raw email provider credentials
- customer-to-customer data access
- final customer price setter without Admin authorization
- exchange-rate approval
- Admin restore

APPROVAL RULE
A tool that performs an Admin-only action must reject an AI caller even if the model requests it. Approval is represented as a server-side state, not as a natural-language instruction.