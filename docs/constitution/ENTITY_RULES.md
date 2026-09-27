ARAT ENTITY RULES

SUPPLIER
Supplier Type: Manufacturer, Official Distributor, Distributor, Representative, Reseller, Trading Company, Unknown. One Legal/Official Name; one Primary Country; multiple Active Countries; multiple Products; multiple Brands; multiple Contacts with one Primary; multiple Websites with one Primary; one Primary Address; multiple Emails with one Primary; multiple Phones with one Primary.
Supplier Status Active/Inactive; only Admin changes; never hard-delete. Type changes overwrite current value and create Type History. New active countries may be added without changing Primary Country. Countries may be removed only with reliable evidence; history remains.
Supplier has no business-facing code. Name is sufficient.
Sources attach to Supplier overall. Source types: Official Website, Google Search, Business Directory, LinkedIn, Manufacturer Website, Distributor Website, Referral, Existing Data, AI Research, Other.
Supplier Profile is factual and may contain identity, type, countries, products/brands, contacts, verification, historical activity, response pattern, availability, quotation history, lead-time history, responsiveness, and interaction history. No supplier score or ranking.
Verification states: Unverified, Pending, Verified, Rejected. Identity/source conflicts that cannot be resolved -> Pending. Rejected requires standardized reason: Verification Failed, Company Could Not Be Confirmed, Website/Identity Issue, Product Mismatch, Supplier No Longer Active, Duplicate/Wrong Entity, Other. Rejected may later become Verified. Verification History stores old/new status, date, Admin, reason.

SUPPLIER PRODUCT
Product exists only within Supplier; no global Product. Fields: Product Name, Model/Part Number, Description, Brand, Status. Status Active/Inactive. No fixed price or fixed availability; those come from supplier responses/quotes. Primary identifier is Model/PN when present, otherwise Product Name + Supplier. No business-facing product code.
Product creation may be AI or Admin. Manual creation requires Product Name; PN and Description optional.

DUPLICATES
Same exact Name + PN = duplicate. Superficial case/space/hyphen/underscore differences do not establish a new identity; preserve originals. Same PN with different Name or Description = Potential Duplicate -> Admin decision. Same Name with blank PN may be new unless other identity rules establish duplication. One PN + one blank PN with same Name -> merge, retaining PN. Both PN blank + same Name -> merge. Both PN blank + different Names -> do not merge. Same Name with different real Brands -> resolve by evidence; uncertainty forbids merge. Active Real Brand + Unknown Brand may directly merge when identity is clear. Inactive Brand cannot be merge target until active. Product/Model/Brand changes require AI proposal + Admin approval. Inactive Product with same PN is reactivated, not recreated.

BRAND
Brand exists only within Supplier. Fields: Brand Name, Country of Origin. One Unknown Brand per Supplier. Product belongs to exactly one Brand from same Supplier. Unknown -> existing real Brand may be direct transfer. Unknown -> new real Brand creates Suggested Brand and requires Admin approval.

CONTACT
Contact belongs only to Supplier. Fields: Name, Email, Phone, Job Title, Department, Country, LinkedIn/Professional Profile, Notes. Multiple contacts, one Primary. AI may choose Primary based on role, relevance, response history and interactions. Supplier must have at least one valid contact to be usable. Contact Status Active/Inactive; AI may change directly. Duplicate contacts may be merged by AI, retaining newer reliable information. Supplier Email/Phone are Active/Inactive with status history; duplicates may be merged using newer reliable discovery. Websites have no active/inactive state. One primary address; AI may replace it while older evidence remains traceable.

CUSTOMER
Private; not searchable by other customers. Customer has exactly one User. Customer account is Admin-created, invitation-based, and never hard-deleted.

FILE
Allowed MVP: PDF, DOCX, XLSX, XLS, CSV, JPG, JPEG, PNG, WEBP, TXT. Max 25 MB/file, unlimited files. Lifecycle: Uploaded -> Processing -> Processed/Processing Failed. OCR for images/scanned PDFs. Low-confidence extraction is flagged, never guessed. Original preserved; AI uses processed copy. New upload is a new version. Metadata includes original name, internal ID, type, size, upload date, uploader, version, related record.