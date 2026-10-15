export type ProgressStep={key:string;title:string;description:string;state:'completed'|'current'|'upcoming'|'warning';detail?:string};
export function inquiryProgress(facts:{status:string;aiComplete:boolean;researchComplete:boolean;verified:boolean;rfqSent:boolean;responseReceived:boolean;clarificationPending:boolean;quoteStatuses:string[]}) {
  const accepted=facts.status==='converted'||facts.quoteStatuses.includes('accepted');
  const sent=facts.quoteStatuses.some(s=>['sent','accepted','rejected','expired','revision_requested'].includes(s));
  const prepared=facts.quoteStatuses.length>0;
  const current=accepted?11:sent?9:prepared?7:facts.clarificationPending?6:facts.responseReceived?7:facts.rfqSent?5:facts.verified?4:facts.researchComplete?3:facts.aiComplete?2:1;
  const names=[['request','Request Received','Customer request has been submitted.'],['ai','AI Understanding','Customer item fields are extracted and validated.'],['research','Supplier Research','Potential suppliers are researched.'],['verification','Supplier Verification','Supplier identity and contacts are verified.'],['rfq','RFQ Sent','Approved requests are sent to suppliers.'],['response','Supplier Response','Supplier responses are received and processed.'],['clarification','Additional Information','Clarification is requested when needed.'],['quote','Quote Preparation','Supplier facts and customer quotation are reviewed.'],['quotation','Quotation Sent','The quotation has been sent to the customer.'],['decision','Customer Decision','Waiting for customer acceptance or a revision request.'],['completed','Completed','The procurement request is complete.']];
  const steps:ProgressStep[]=names.map(([key,title,description],i)=>({key,title,description,state:i<current?'completed':i===current?(i===6?'warning':'current'):'upcoming'}));
  if(current>6&&!facts.clarificationPending) steps[6].description='No further customer clarification is pending.';
  return {steps,label:accepted?'Completed':sent?'Awaiting Customer Decision':prepared?'Quote Preparation':steps[current]?.title??'Processing'};
}
