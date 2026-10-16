import {customerRequestParts} from '@/lib/ui/customer-request';

export function CustomerRequestMessage({text}:{text:string}) {
  const parts=customerRequestParts(text);
  return <div className="customer-request-message">{parts.map((part,index)=><section className="customer-request-part" key={index}>
    <div className="customer-request-wording">{part.message}</div>
    {part.details.length>0&&<dl className="customer-request-facts">{part.details.map(detail=><div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
  </section>)}</div>;
}
