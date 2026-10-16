import {T} from '@/components/language';
import {inquiryItems,type RequestRequirement} from '@/lib/ui/inquiry-items';
import {CustomerRequestMessage} from './customer-request-message';
export default function RequestItems({normalized,requirements,original}:{normalized:unknown;requirements:RequestRequirement[];original?:string|null}) {
  const items=inquiryItems(normalized,requirements);
  return <div className="request-item-list">{items.map(item=><article className="detail-card" key={item.index}>
    <div className="eyebrow"><T>ITEM </T>{item.index}</div><h3>{item.label||<T>{'Item description pending'}</T>}</h3>
    <dl className="details"><div><dt><T>Quantity</T></dt><dd>{item.quantity||<T>{'Not stated'}</T>}</dd></div><div><dt><T>Brand / Manufacturer</T></dt><dd>{item.brand||<T>{'Not stated'}</T>}</dd></div><div><dt><T>Model / Part number</T></dt><dd>{item.model||<T>{'Not stated'}</T>}</dd></div><div><dt><T>Specifications</T></dt><dd>{item.specifications.join(' · ')||<T>{'Not stated'}</T>}</dd></div>{item.serialNumber&&<div><dt><T>Serial number</T></dt><dd>{item.serialNumber}</dd></div>}{item.additionalDetails&&<div><dt><T>Additional details</T></dt><dd>{item.additionalDetails}</dd></div>}</dl>
  </article>)}{original&&<details><summary><T>Customer message and submitted details</T></summary><div className="original-request"><CustomerRequestMessage text={original}/></div></details>}</div>;
}
