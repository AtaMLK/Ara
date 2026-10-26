/** Presentation metadata only: a shared domain is not proof of sender authentication. */
export function supplierReplySender(metadata: unknown) {
  const meta=metadata && typeof metadata==='object' && !Array.isArray(metadata) ? metadata as Record<string,unknown> : {};
  const address=(value:unknown)=>typeof value==='string' ? value.trim().toLowerCase() : '';
  const from=address(meta.from);
  const originalRecipient=address(meta.rfq_recipient_email);
  const changed=Boolean(from && (meta.sender_changed===true || (originalRecipient && originalRecipient!==from) || meta.match_method==='alternate_sender_company_domain_and_rfq_reference'));
  const sameDomain=Boolean(from && originalRecipient && from.split('@')[1]===originalRecipient.split('@')[1]);
  return {from,originalRecipient,changed,sameDomain};
}
