'use client';
import {Fragment,useState} from 'react';
import {RequirementEdit} from '@/app/inquiries/[id]/requirement-edit';
import {displayText} from '@/lib/ui/display-text';
import type {RequestItem} from '@/lib/ui/request-items';
export default function RequestItemsTable({items,inquiryId}:{items:RequestItem[];inquiryId:string}){
 const [expanded,setExpanded]=useState<number|null>(null);
 return <div className="request-products-table"><table><caption className="sr-only">Requested products</caption><thead><tr><th>#</th><th>Product</th><th>Brand</th><th>Model / Part number</th><th>Quantity</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{items.map(item=><Fragment key={item.index}>
  <tr><td className="item-position">{String(item.index).padStart(2,'0')}</td><td><span className="product-description">{displayText(item.description)||'Description not stated'}</span></td><td>{displayText(item.brand)||'—'}</td><td className="product-model">{displayText(item.model)||'—'}</td><td className="product-quantity">{displayText(item.quantity)||'Not stated'}</td><td><span className={`product-state ${item.status==='confirmed'?'is-confirmed':''}`}>{item.status==='confirmed'?'Confirmed':item.status==='clarification_required'?'Needs clarification':'Review'}</span></td><td><button type="button" className="inline-button" aria-expanded={expanded===item.index} onClick={()=>setExpanded(expanded===item.index?null:item.index)}>{expanded===item.index?'Close':'Edit'}</button></td></tr>
  {expanded===item.index&&<tr className="product-edit-row"><td colSpan={7}><div className="product-edit-fields">{item.requirements.map(row=><div key={row.id}><strong>{row.type.replaceAll('_',' ')}</strong><p>{displayText(row.value)}</p><RequirementEdit inquiryId={inquiryId} requirement={{...row,value:displayText(row.value),status:row.status as 'open'|'clarification_required'|'confirmed'|'rejected'}}/></div>)}</div></td></tr>}
 </Fragment>)}</tbody></table>{!items.length&&<p className="empty">No product items have been recorded yet.</p>}</div>;
}
