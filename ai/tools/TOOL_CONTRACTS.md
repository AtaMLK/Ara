ARAT TOOL CONTRACTS

1. INQUIRY TOOLS
getInquiry(inquiryId) -> current authorized Inquiry.
updateInquiryTitleDescription(inquiryId, title, description, expectedVersion) -> updated Inquiry.
getInquiryTimeline(inquiryId) -> authorized timeline.

Rules: AI cannot change Inquiry Priority unless a specific future rule grants it. Customer-facing reads return only permitted fields.

2. REQUIREMENT TOOLS
listRequirements(inquiryId) -> requirements.
createRequirement(inquiryId, type, value, source, sourceRef) -> Requirement.
updateRequirement(requirementId, patch, expectedVersion) -> Requirement.
setRequirementStatus(requirementId, status, reason?) -> Requirement.
mergeRequirements(primaryId, duplicateId) -> merged Requirement + trace.

Rules: Admin-edited values require version-safe writes. Conflict cannot be silently resolved. Clarification Required is valid state.

3. FILE TOOLS
getFileMetadata(fileId) -> metadata.
processFile(fileId) -> processed representation.
getProcessedDocument(fileId) -> normalized content.
createFileVersion(recordId, sourceFile) -> new version.

Rules: original binary is immutable; private access only; 25 MB upload limit; malware scanning required.

4. RESEARCH TOOLS
searchWeb(query, constraints) -> source results.
searchSpecializedSource(query, sourceType, constraints) -> source results.
saveResearchResult(inquiryId, source, finding, disposition) -> Research Result.
listResearch(inquiryId, scope?) -> research records.

Rules: save relevant and rejected search results; preserve source URL and timestamp; research never overwrites Customer Requirement.

5. SUPPLIER TOOLS
getSupplier(supplierId) -> authorized Supplier.
searchSuppliers(filters) -> candidates.
createCandidateSupplier(inquiryId, candidateData, evidence) -> Candidate.
updateSupplierProfile(supplierId, patch, evidence, expectedVersion) -> Supplier.
setSupplierVerification(supplierId, status, evidence, reason?) -> Verification result.
setSupplierStatus(supplierId, status) -> Supplier.

Rules: Admin-rejected/removed candidate cannot be recreated by AI for same Inquiry. Verification status requires evidence. Supplier scores/rankings are forbidden.

6. PRODUCT/BRAND TOOLS
listSupplierProducts(supplierId).
createSupplierProduct(supplierId, product).
updateSupplierProduct(productId, patch, evidence, expectedVersion).
flagPotentialDuplicate(productA, productB, evidence).
mergeSupplierProducts(primaryId, duplicateId) only when merge rules permit.
listSupplierBrands(supplierId).
createSuggestedBrand(supplierId, brand, evidence).
mergeProductToBrand(productId, brandId) only under brand rules.

7. CONTACT TOOLS
listSupplierContacts(supplierId).
createSupplierContact(supplierId, contact, evidence).
updateSupplierContact(contactId, patch, evidence, expectedVersion).
mergeDuplicateContacts(primaryId, duplicateId).
setPrimaryContact(supplierId, contactId, evidence).

8. RFQ TOOLS
getFinalCandidateList(inquiryId).
createRFQDraft(inquiryId, supplierId, payload).
prepareOutboundAttachments(fileIds, redactionPolicy) -> redacted copies + evidence.
requestRFQApproval(rfqId) -> approval state.

AI cannot call email.send through the RFQ tool unless the required approval state is satisfied.

9. EMAIL TOOLS
listRelevantIncomingEmails(criteria).
matchEmail(emailId, targetType, targetId, evidence).
createEmailDraft(payload).
sendApprovedEmail(emailDraftId) -> provider result.

Unmatched emails must never be autoattached. sendApprovedEmail must verify approval server-side.

10. SUPPLIER RESPONSE TOOLS
createSupplierResponse(emailId, supplierId, inquiryId, extraction).
updateSupplierResponse(responseId, patch, expectedVersion).
createSupplierQuote(responseId, productId, commercialData).
updateSupplierQuote(quoteId, patch, expectedVersion).
recordMatchAnalysis(responseId, productId, analysis).

Unknown/blank fields are valid. No guessing.

11. QUOTE TOOLS
createCustomerQuoteDraft(inquiryId, sourceSupplierQuotes, currency).
updateCustomerQuoteDraft(quoteId, patch, expectedVersion).
requestQuoteApproval(quoteId).
sendApprovedCustomerQuote(quoteId).
recordCustomerQuoteDecision(quoteId, decision, reason?).
requestRevision(quoteId, reason, freeText?).
createQuoteRevision(quoteId, approvedRequest).

Rules: AI cannot set final Customer Price. Currency conversion requires an approved rate. send requires approval. Accepted quotes cannot be revised.

12. EXCHANGE RATE TOOLS
findExchangeRate(from, to, date/source constraints) -> proposal.
getApprovedExchangeRate(from, to, date) -> approved rate or NONE.

AI cannot approve rates.

13. NOTIFICATION/TIMELINE TOOLS
createNotification(category, priority, recordRef, message, action?)
markTimelineEvent(recordRef, eventType, metadata)

14. REPORT TOOLS
getReportData(reportType, filters, dateRange).
generateReportSummary(reportData) -> factual summary only.

15. SETTINGS
getCompanySettings() -> non-secret company configuration.
getAISettings() -> model configuration excluding secrets.
getEmailProviderSettings() -> provider metadata excluding credentials.

No tool may return provider passwords, API keys, access tokens, or encryption keys to an AI agent.