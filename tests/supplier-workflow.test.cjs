const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');

// Exercise the real workflow and schemas with an in-memory database and providers.
// No search credits, database writes, email sends, or production credentials are used.
function fixture({ unreadable = false, protectedQuantity = false, noContacts = false, researchFailure = false } = {}) {
  const inquiryId = randomUUID();
  const tables = { inquiries: [{ id: inquiryId, status: 'processing', current_version: 1, original_customer_text: 'Alpha TS-100 sensor 2 pcs; Beta BM-200 motor 2 pcs' }] };
  if (unreadable) tables.inquiry_files = [{ id: randomUUID(), inquiry_id: inquiryId, status: 'uploaded', mime_type: 'application/pdf', original_name: 'request.pdf', storage_path: 'test.pdf' }];
  if (protectedQuantity) tables.requirements = [{ id: randomUUID(), inquiry_id: inquiryId, type: 'quantity', value: '9 pcs', source: 'customer_text', source_ref: 'intake:item:0', status: 'confirmed', admin_edited: true }];
  let searches = 0;
  let sends = 0;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = 'read'; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    ilike(key, value) { const literal = value.replace(/\\([%_\\])/g, '$1').toLowerCase(); this.filters.push(row => String(row[key] ?? '').toLowerCase() === literal); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    not(key, operator, value) { this.filters.push(row => operator === 'is' ? row[key] != null : row[key] !== value); return this; }
    contains(key, value) { this.filters.push(row => Object.entries(value).every(([k, v]) => row[key]?.[k] === v)); return this; }
    order() { return this; }
    limit(value) { this.count = value; return this; }
    insert(value) { this.op = 'insert'; this.value = value; return this; }
    upsert(value, options) { this.op = 'upsert'; this.value = value; this.conflict = options.onConflict.split(','); return this; }
    update(value) { this.op = 'update'; this.value = value; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
    execute() {
      const rows = tables[this.table] ??= [];
      let matches = rows.filter(row => this.filters.every(filter => filter(row)));
      if (this.op === 'update') matches.forEach(row => Object.assign(row, this.value));
      if (this.op === 'insert' || this.op === 'upsert') {
        matches = (Array.isArray(this.value) ? this.value : [this.value]).map(value => {
          let row = this.op === 'upsert' ? rows.find(row => this.conflict.every(key => row[key] === value[key])) : null;
          if (row) Object.assign(row, value);
          else { row = { id: randomUUID(), created_at: new Date().toISOString(), attempt_count: 0, status: 'open', ...value }; rows.push(row); }
          return row;
        });
      }
      if (this.count) matches = matches.slice(0, this.count);
      const result = matches.map(row => {
        const copy = structuredClone(row);
        if (this.table === 'supplier_candidates') copy.suppliers = tables.suppliers?.find(supplier => supplier.id === copy.supplier_id) ?? null;
        return copy;
      });
      return { data: this.one ? result[0] ?? null : result, error: null };
    }
  }
  const database = { from: table => new Query(table) };
  const provider = { search: async ({ query }) => {
    searches++;
    if (researchFailure) throw new Error('Provider temporarily unavailable');
    const beta = /beta|bm-200/i.test(query);
    const domain = beta ? 'beta.example.com' : 'alpha.example.com';
    const company = beta ? 'Beta Motors Ltd' : 'Alpha Sensors Ltd';
    return [{ sourceType: 'web', sourceName: company, sourceUrl: `https://${domain}/products`, finding: `${company} manufacturer ${beta ? 'BM-200 Beta motor' : 'TS-100 Alpha temperature sensor'} ${noContacts ? '' : `sales contact sales@${domain} 123 Industrial Road +90 212 555 1234 Turkey`}`, structuredData: { title: company }, evidence: {} }];
  } };
  const cache = new Map();
  const mocks = {
    'server-only': {},
    'next/cache': { revalidatePath: () => {} },
    '@/lib/ai/guards': { requireAdmin: async () => ({ user: { id: randomUUID() }, supabase: database }) },
    '@/lib/ai/clarification-replies': { findCustomerClarificationForEmail: async () => ({ matched: false }), cleanEmailReply: (text, html) => text || html || '', extractEmailAddress: value => value.trim().toLowerCase(), applyCustomerClarificationAnswer: async () => {} },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => database },
    '@/lib/ai/document-processor': { downloadInquiryFile: async () => new Uint8Array(), parseInquiryFile: async () => ({ extractedText: '', extractedData: {}, qualityFlags: ['OCR_REQUIRED'] }) },
    '@/lib/ai/research/provider': { getResearchProvider: () => provider },
    '@/lib/ai/supplier-page': { readSupplierHtml: async url => {
      const domain = new URL(url).hostname;
      if (noContacts) return '<html><body>Company product catalog</body></html>';
      return `<html><body>${domain.startsWith('beta') ? 'Beta Motors Ltd BM-200 motor' : 'Alpha Sensors Ltd TS-100 temperature sensor'} manufacturer sales@${domain} 123 Industrial Road +90 212 555 1234 Turkey</body></html>`;
    } },
    '@/lib/email/provider': { getEmailProvider: () => ({ send: async () => { sends++; throw new Error('Unexpected outbound email'); } }) },
    '@/lib/ai/agent-runner': { runAgent: async (ctx, input, schema) => {
      let output;
      if (ctx.agentId === 'intake') output = { title: 'Two products', description: 'Sensor and motor', items: [
        { requestedText: 'Alpha TS-100 sensor 2 pcs', product: 'Temperature sensor', brand: 'Alpha', model: 'TS-100', quantity: 2, unit: 'pcs', confidence: 1, evidence: 'Alpha TS-100 sensor 2 pcs' },
        { requestedText: 'Beta BM-200 motor 2 pcs', product: 'Motor', brand: 'Beta', model: 'BM-200', quantity: 2, unit: 'pcs', confidence: 1, evidence: 'Beta BM-200 motor 2 pcs' },
      ] };
      else if (ctx.agentId === 'clarification') output = { needsClarification: false, questions: [] };
      else if (ctx.agentId === 'email_response') output = { hasActionableInformation: true, summary: 'Supplier provided a quote', supplierIntent: 'quote', customerActionRequired: false, adminReviewRequired: false, confidence: 1 };
      else if (ctx.agentId === 'supplier_discovery') {
        const source = input.research_results[0];
        output = { candidates: [{ name: source.source_name, website: new URL(source.source_url).origin, country: 'Turkey', sourceUrl: source.source_url, requirementId: input.target_product.id, matchType: 'exact_product', matchScore: 95, evidence: [source.finding] }] };
      } else if (ctx.agentId === 'contact_research') {
        if (noContacts) return { output: schema.parse({}), provider: 'test', model: 'test', executionId: ctx.executionId };
        const domain = new URL(input.supplier.website).hostname;
        output = { emails: [{ email: `sales@${domain}`, evidence: 'Published on official page' }, { email: 'invented@unknown.example', evidence: 'Unsupported' }], addresses: [{ address: '123 Industrial Road', country: 'Turkey', evidence: 'Published address' }], phones: [{ phone: '+90 212 555 1234', evidence: 'Published phone' }], contacts: [{ name: 'Invented Person', email: 'guess@unknown.example', evidence: ['Unsupported'] }] };
      } else if (ctx.agentId === 'supplier_verification') output = { status: 'verified', explanation: 'Official company identity, business activity and published contact details agree.', evidence: [input.candidate.website] };
      else throw new Error(`Unexpected agent ${ctx.agentId}`);
      return { output: schema.parse(output), provider: 'test', model: 'test', executionId: ctx.executionId };
    } },
  };
  function load(spec, parent = root) {
    let canonical = spec;
    if (spec.startsWith('.')) canonical = '@/'+path.relative(path.join(root, 'src'), path.resolve(parent, spec)).replaceAll('\\', '/');
    if (mocks[canonical]) return mocks[canonical];
    if (!canonical.startsWith('@/')) return require(canonical);
    const file = path.join(root, 'src', canonical.slice(2)) + '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    let js = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'transform' });
    const exports = [...js.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(match => match[1]);
    for (const match of js.matchAll(/export\s*\{([^}]+)\}/g)) exports.push(...match[1].split(',').map(name => name.trim()).filter(Boolean));
    js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_match, names, source) => `const {${names.replace(/\bas\b/g, ':')}} = require('${source}');`)
      .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (_match, name, source) => `const ${name} = require('${source}');`)
      .replace(/import\s*['"]([^'"]+)['"];?/g, (_match, source) => `require('${source}');`)
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class))/g, '')
      .replace(/export\s*\{[^}]+\};?/g, '')
      + `\nObject.assign(module.exports, {${exports.join(',')}});`;
    new Function('require', 'module', 'exports', 'process', js)(child => load(child, path.dirname(file)), module, module.exports, { env: { OPENAI_API_KEY: 'test', SERPAPI_API_KEY: 'test' } });
    return module.exports;
  }
  return { inquiryId, tables, load, mock: (spec, value) => mocks[spec] = value, unmock: spec => delete mocks[spec], searchCount: () => searches, sendCount: () => sends };
}

test('two-product workflow preserves equal quantities and delivers evidence-backed contacts without sending email', async () => {
  const f = fixture();
  const workflow = f.load('@/lib/ai/workflow');
  const queue = f.load('@/lib/ai/orchestrator');
  await queue.enqueueWorkflow(f.inquiryId, 'document');
  const result = await workflow.processQueuedWorkflow(6, f.inquiryId);
  assert.equal(result.results.some(row => row.error), false, JSON.stringify(result.results));
  assert.equal(f.tables.requirements.filter(row => row.type === 'product').length, 2);
  assert.equal(f.tables.requirements.filter(row => row.type === 'quantity' && row.value === '2 pcs').length, 2);
  assert.equal(f.tables.supplier_candidates.length, 2);
  assert.equal(f.tables.suppliers.filter(row => row.verification_status === 'verified').length, 2);
  assert.ok(f.tables.suppliers.every(row => row.primary_email_id && row.primary_address_id && row.primary_phone_id));
  assert.ok(f.tables.supplier_emails.every(row => row.email.startsWith('sales@')));
  assert.equal(f.tables.supplier_contacts?.length ?? 0, 0);
  assert.ok(f.tables.supplier_candidates.every(row => row.verification_evidence.contact_sources.length && row.verification_evidence.assessment));
  assert.equal(f.sendCount(), 0);
  // Successful jobs remain successful and do not consume search credits on enqueue.
  const searches = f.searchCount();
  assert.equal((await queue.enqueueWorkflow(f.inquiryId, 'research')).status, 'succeeded');
  assert.equal(f.searchCount(), searches);
  // Explicit research recovery must reuse existing evidence and queue discovery.
  f.tables.ai_executions.find(row => row.task_key.endsWith(':research')).status = 'queued';
  await workflow.processQueuedWorkflow(1, f.inquiryId);
  assert.equal(f.searchCount(), searches);
  assert.equal(f.tables.ai_alerts.some(row => row.alert_type === 'RESEARCH_PROVIDER_NOT_CONNECTED'), false);
  const oldCaseCount = f.tables.research_cases.length;
  f.tables.requirements.find(row => row.type === 'model_part_number').value = 'TS-101';
  f.tables.ai_executions.find(row => row.task_key.endsWith(':research')).status = 'queued';
  await workflow.processQueuedWorkflow(1, f.inquiryId);
  assert.equal(f.tables.research_cases.length, oldCaseCount + 1);
  assert.ok(f.searchCount() > searches);
  assert.ok(f.tables.supplier_candidates.every(row => row.status === 'proposed'));
  assert.equal(f.tables.ai_executions.find(row => row.task_key.endsWith(':supplier_discovery')).status, 'queued');
});

test('unreadable attachment blocks intake and supplier research', async () => {
  const f = fixture({ unreadable: true });
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'document');
  const result = await f.load('@/lib/ai/workflow').processQueuedWorkflow(6, f.inquiryId);
  assert.ok(result.results[0].error.includes('could not be fully processed'));
  assert.equal(f.searchCount(), 0);
  assert.equal(f.tables.ai_executions.length, 1);
  assert.equal(f.tables.inquiry_files[0].status, 'processing_failed');
});

test('intake retry preserves admin quantity edits within the item group', async () => {
  const f = fixture({ protectedQuantity: true });
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'intake');
  await f.load('@/lib/ai/workflow').processQueuedWorkflow(1, f.inquiryId);
  const quantities = f.tables.requirements.filter(row => row.type === 'quantity');
  assert.deepEqual(quantities.map(row => row.value).sort(), ['2 pcs', '9 pcs']);
});

test('only one competing worker can claim a queued execution', async () => {
  const f = fixture();
  const queue = f.load('@/lib/ai/orchestrator');
  const execution = await queue.enqueueWorkflow(f.inquiryId, 'intake');
  const claims = await Promise.all([queue.markExecutionRunning(execution.id), queue.markExecutionRunning(execution.id)]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test('schemas preserve published emails and do not equate manufacturers with exact model matches', () => {
  const f = fixture();
  const schemas = f.load('@/lib/ai/agent-schemas');
  const contact = schemas.supplierContactResearchOutputSchema.parse({ contacts: [{ name: 'Sales', email: 'sales@example.com' }] });
  assert.equal(contact.contacts[0].email, 'sales@example.com');
  const candidates = schemas.supplierDiscoveryOutputSchema.parse({ candidates: [
    { name: 'Company', sourceUrl: 'https://example.com', matchType: 'official_manufacturer' },
    { name: 'Company', sourceUrl: 'https://example.com', matchType: 'same_brand_similar_product_match' },
  ] }).candidates;
  assert.deepEqual(candidates.map(row => row.matchType), ['same_brand_distributor', 'same_brand_similar']);
});

test('missing contact evidence leaves suppliers pending and identifies gaps to admin', async () => {
  const f = fixture({ noContacts: true });
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'document');
  await f.load('@/lib/ai/workflow').processQueuedWorkflow(6, f.inquiryId);
  assert.ok(f.tables.suppliers.every(row => row.verification_status === 'pending'));
  assert.ok(f.tables.supplier_candidates.every(row => row.verification_evidence.missing_contact_fields.includes('email')));
  assert.equal(f.tables.ai_executions.some(row => row.task_key.endsWith(':rfq')), false);
});

test('supplier page retrieval rejects local addresses and credential-bearing URLs', async () => {
  const f = fixture(); f.unmock('@/lib/ai/supplier-page');
  const page = f.load('@/lib/ai/supplier-page');
  for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1']) assert.equal(page.isPublicAddress(address), false, address);
  assert.equal(page.isPublicAddress('8.8.8.8'), true);
  assert.equal(await page.readSupplierHtml('http://127.0.0.1/admin'), '');
  assert.equal(await page.readSupplierHtml('https://user:password@example.com'), '');
});

test('admin verification preserves provenance and sent flags; mixed inquiry selections are rejected before send', async () => {
  const f = fixture();
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'document');
  await f.load('@/lib/ai/workflow').processQueuedWorkflow(6, f.inquiryId);
  const actions = f.load('@/app/inquiries/[id]/supplier-rfq-actions');
  const candidate = f.tables.supplier_candidates[0];
  candidate.verification_evidence.rfq_sent = true;
  const source = candidate.verification_evidence.source_url;
  await actions.verifySupplierCandidateAction({ inquiryId: f.inquiryId, candidateId: candidate.id });
  assert.equal(candidate.verification_evidence.source_url, source);
  assert.equal(candidate.verification_evidence.rfq_sent, true);
  await assert.rejects(actions.sendSupplierRfqAction({ inquiryId: f.inquiryId, candidateIds: [f.tables.supplier_candidates[1].id, randomUUID()] }), /do not belong/);
  assert.equal(f.sendCount(), 0);
});

test('provider outage cannot masquerade as successful research with no suppliers', async () => {
  const f = fixture({ researchFailure: true });
  await f.load('@/lib/ai/orchestrator').enqueueWorkflow(f.inquiryId, 'document');
  const result = await f.load('@/lib/ai/workflow').processQueuedWorkflow(6, f.inquiryId);
  assert.ok(result.results.some(row => row.error?.includes('All supplier research queries failed')));
  assert.equal(f.tables.research_cases[0].status, 'failed');
  assert.equal(f.tables.ai_executions.some(row => row.task_key.endsWith(':supplier_discovery')), false);
});

function supplierReplyFixture() {
  const f = fixture();
  const supplierId = randomUUID();
  const rfqId = randomUUID();
  f.tables.suppliers = [{ id: supplierId, legal_name: 'Supplier Company' }];
  f.tables.supplier_emails = [{ supplier_id: supplierId, email: 'info@supplier.example', status: 'active' }];
  f.tables.rfqs = [{ id: rfqId, inquiry_id: f.inquiryId, supplier_id: supplierId, recipient_email: 'info@supplier.example', rfq_code: 'RFQ-20261014-ABCDEF', subject: 'RFQ | RFQ-20261014-ABCDEF', status: 'sent', created_at: new Date().toISOString() }];
  f.tables.communications = [{ id: randomUUID(), rfq_id: rfqId, direction: 'outgoing', channel: 'email', provider_message_id: '<original-rfq@supplier-thread.example>', thread_id: null, metadata: {} }];
  f.tables.inquiries[0].status = 'rfq';
  return { f, supplierId, rfqId };
}

test('new sales sender on the supplier company domain matches a unique RFQ code', async () => {
  const { f, supplierId, rfqId } = supplierReplyFixture();
  const match = await f.load('@/lib/ai/supplier-email-matching').findSupplierRFQForEmail({ sender: 'Sales <sales@supplier.example>', subject: 'Re: Re: RFQ | RFQ-20261014-ABCDEF' });
  assert.equal(match.matched, true);
  assert.equal(match.supplierId, supplierId);
  assert.equal(match.rfq.id, rfqId);
});

test('new sales sender with a rewritten subject matches the actual SMTP message ID', async () => {
  const { f, rfqId } = supplierReplyFixture();
  const match = await f.load('@/lib/ai/supplier-email-matching').findSupplierRFQForEmail({ sender: 'sales@supplier.example', subject: 'Our quotation', inReplyTo: '<original-rfq@supplier-thread.example>' });
  assert.equal(match.matched, true);
  assert.equal(match.rfq.id, rfqId);
});

test('known sender threading also checks provider_message_id when thread_id is absent', async () => {
  const { f, rfqId } = supplierReplyFixture();
  f.tables.rfqs.push({ ...f.tables.rfqs[0], id: randomUUID(), rfq_code: 'RFQ-20261014-OTHER1', subject: 'Another request' });
  const match = await f.load('@/lib/ai/supplier-email-matching').findSupplierRFQForEmail({ sender: 'info@supplier.example', subject: 'Our quotation', inReplyTo: '<original-rfq@supplier-thread.example>' });
  assert.equal(match.matched, true);
  assert.equal(match.rfq.id, rfqId);
});

test('company domain alone or a reference from an unrelated sender cannot attach a quote', async () => {
  const { f } = supplierReplyFixture();
  const matcher = f.load('@/lib/ai/supplier-email-matching');
  assert.equal((await matcher.findSupplierRFQForEmail({ sender: 'sales@supplier.example', subject: 'Quote with no reference' })).matched, false);
  assert.equal((await matcher.findSupplierRFQForEmail({ sender: 'sales@unrelated.example', subject: 'RFQ-20261014-ABCDEF' })).matched, false);
  f.tables.rfqs[0].recipient_email = 'first@gmail.com';
  f.tables.supplier_emails[0].email = 'first@gmail.com';
  assert.equal((await matcher.findSupplierRFQForEmail({ sender: 'different@gmail.com', subject: 'RFQ-20261014-ABCDEF' })).matched, false);
});

test('a previously unmatched sales reply is recovered, saved once and queued for quote extraction', async () => {
  const { f, rfqId } = supplierReplyFixture();
  f.mock('@/lib/ai/workflow', { continueInquiryWorkflow: async () => ({ outcome: 'queued' }) });
  const communicationId = randomUUID();
  f.tables.communications.push({ id: communicationId, provider_message_id: 'reply-001', direction: 'incoming', metadata: { type: 'unmatched_incoming_email' } });
  f.tables.unmatched_emails = [{ id: randomUUID(), communication_id: communicationId, reason: 'supplier_not_found' }];
  const email = { providerMessageId: 'reply-001', from: 'sales@supplier.example', to: ['purchase-dep@aryaautomation.com'], subject: 'Re: RFQ-20261014-ABCDEF', text: 'Price USD 100 per unit, delivery 2 weeks.', provider: 'test' };
  const inbound = f.load('@/lib/email/inbound');
  const result = await inbound.processInboundEmail(email);
  assert.equal(result.matched, true);
  assert.equal(result.rfqId, rfqId);
  assert.equal(f.tables.supplier_responses.length, 1);
  assert.equal(f.tables.communications.find(row => row.id === communicationId).metadata.type, 'supplier_rfq_reply');
  assert.ok(f.tables.unmatched_emails[0].reviewed_at);
  assert.equal(f.tables.ai_executions.find(row => row.task_key.endsWith(':quote_extraction')).status, 'queued');
  await inbound.processInboundEmail(email);
  assert.equal(f.tables.supplier_responses.length, 1);
  assert.equal(f.sendCount(), 0);
});

test('new replies reopen completed extraction; RFQ state processes pending responses', async () => {
  const { f } = supplierReplyFixture();
  const queue = f.load('@/lib/ai/orchestrator');
  const execution = await queue.enqueueWorkflow(f.inquiryId,'quote_extraction');
  await queue.markExecutionRunning(execution.id);
  await queue.markExecutionSuccess(execution.id);
  assert.equal((await queue.enqueueSupplierQuoteExtraction(f.inquiryId)).status,'queued');
  f.tables.supplier_responses = [{ id: randomUUID(), inquiry_id: f.inquiryId, supplier_id: f.tables.suppliers[0].id, communication_id: 'missing-communication', status: 'received' }];
  const result = await f.load('@/lib/ai/workflow').continueInquiryWorkflow(f.inquiryId);
  assert.notEqual(result.outcome,'rfq_waiting_for_supplier_response');
  assert.ok(result.execution.task_key.endsWith(':quote_extraction'));
  assert.equal(f.tables.ai_executions.find(row => row.id === execution.id).output_ref.skipped_count,1);
});
