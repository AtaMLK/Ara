export type AgentId='orchestrator'|'intake'|'document'|'clarification'|'product_research'|'supplier_discovery'|'supplier_verification'|'contact_research'|'rfq'|'email_response'|'quote_extraction'|'comparison'|'customer_quote'|'reporting';
export type AIContext={agentId:AgentId;executionId:string;inquiryId?:string;customerId?:string};
