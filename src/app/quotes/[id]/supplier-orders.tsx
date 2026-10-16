'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {prepareSupplierOrdersAction,sendSupplierOrderAction} from '../supplier-order-actions';
type Preview={id:string;reference:string;status:string;recipient_email:string;subject:string;body:string;fingerprint:string;sent_at:string|null;error_text:string|null;supplier_name?:string;instructions?:string};
export function SupplierOrders({quoteId,orders}:{quoteId:string;orders:Preview[]}) {
  const [previews,setPreviews]=useState(orders),[instructions,setInstructions]=useState((orders.find(order=>order.status==='draft')??orders[0])?.instructions||''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const router=useRouter();
  async function prepare(){setBusy(true);setError('');try{setPreviews(await prepareSupplierOrdersAction(quoteId,instructions));setDirty(false);}catch(e){setError(e instanceof Error?e.message:'Could not prepare orders.');}finally{setBusy(false);}}
  async function send(order:Preview){setBusy(true);setError('');try{await sendSupplierOrderAction(order.id,order.fingerprint);setPreviews(rows=>rows.map(row=>row.id===order.id?{...row,status:'sent'}:row));}catch(e){setError(e instanceof Error?e.message:'Could not send order.');setPreviews(rows=>rows.map(row=>row.id===order.id?{...row,status:'check_status'}:row));}finally{setBusy(false);router.refresh();}}
  return <section className="section supplier-orders" id="supplier-order-confirmation"><div className="detail-card supplier-orders-panel"><div className="section-head"><h2>Customer accepted · supplier orders</h2></div>
    <p>Review one purchase order per supplier. Each message contains only that supplier’s accepted items, quantities, original costs, tax and delivery terms.</p>
    <label>Purchasing / delivery instructions<textarea value={instructions} maxLength={4000} onChange={e=>{setInstructions(e.target.value);setDirty(true);}} rows={3} placeholder="Delivery address, requested dispatch date or other instructions for suppliers" /></label>
    <button className="secondary-button" disabled={busy} onClick={prepare}>{busy?'Working…':'Prepare / refresh supplier order previews'}</button>
    {error&&<p className="error-box" role="alert">{error}</p>}
    {dirty&&previews.some(order=>order.status==='draft')&&<p className="muted">Refresh the previews to apply your changed instructions before sending.</p>}
    {previews.map(order=><article className="detail-card supplier-order-preview" key={order.id}><h3>{order.supplier_name||order.reference}</h3><p><strong>To:</strong> {order.recipient_email}</p><p><strong>Subject:</strong> {order.subject}</p><span className="badge">{order.status.replaceAll('_',' ')}</span>
      <pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',lineHeight:1.6}}>{order.body}</pre>
      {order.error_text&&<p className="error-box">{order.error_text}</p>}
      {order.status==='draft'&&<button className="primary-button" disabled={busy||dirty} onClick={()=>send(order)}>Send order confirmation to supplier & order items</button>}
      {['sending','delivery_uncertain','check_status'].includes(order.status)&&<p className="muted">Check delivery status and the sent mailbox before taking further action.</p>}
      {order.status==='sent'&&<p className="muted">Order confirmation sent{order.sent_at?' · '+new Date(order.sent_at).toLocaleString('en-GB'):''}.</p>}
    </article>)}
  </div></section>;
}
