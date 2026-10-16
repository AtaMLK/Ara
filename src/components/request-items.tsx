import {inquiryItems,type RequestRequirement} from '@/lib/ui/inquiry-items';
import {CustomerRequestMessage} from './customer-request-message';
export default function RequestItems({normalized,requirements,original}:{normalized:unknown;requirements:RequestRequirement[];original?:string|null}) {
  const items=inquiryItems(normalized,requirements);
  return <div className="request-item-list">{items.map(item=><article className="detail-card" key={item.index}>
    <div className="eyebrow">ITEM {item.index}</div><h3>{item.label||'Item description pending'}</h3>
    <dl className="details"><div><dt>Quantity</dt><dd>{item.quantity||'Not stated'}</dd></div><div><dt>Brand / Manufacturer</dt><dd>{item.brand||'Not stated'}</dd></div><div><dt>Model / Part number</dt><dd>{item.model||'Not stated'}</dd></div><div><dt>Specifications</dt><dd>{item.specifications.join(' · ')||'Not stated'}</dd></div>{item.serialNumber&&<div><dt>Serial number</dt><dd>{item.serialNumber}</dd></div>}{item.additionalDetails&&<div><dt>Additional details</dt><dd>{item.additionalDetails}</dd></div>}</dl>
  </article>)}{original&&<details><summary>Customer message and submitted details</summary><div className="original-request"><CustomerRequestMessage text={original}/></div></details>}</div>;
}
