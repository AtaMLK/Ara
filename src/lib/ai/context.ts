export type AgentId='orchestrator'|'intake'|'document'|'clarification'|'product_research'|'supplier_discovery'|'supplier_verification'|'contact_research'|'rfq'|'email_response'|'quote_extraction'|'comparison'|'reporting';
export type AIContext={agentId:AgentId;executionId:string;inquiryId?:string;customerId?:string};
