'use client';
import {T} from './language';
import {supplierReplySender} from '@/lib/email/supplier-sender';

export default function SupplierSenderNotice({metadata}:{metadata:unknown}) {
  const sender=supplierReplySender(metadata);
  if(!sender.from) return null;
  return <div className="supplier-reply-sender">
    <div className="muted"><T>Reply from: </T>{sender.from}</div>
    {sender.changed && <div className="supplier-match-warning">
      <strong><T>Different supplier mailbox</T></strong>
      {sender.sameDomain && <> · <T>Same company domain</T></>}
      {sender.originalRecipient && <div><T>RFQ sent to: </T>{sender.originalRecipient}</div>}
      <div><T>Reply linked to this RFQ. Original supplier contact unchanged.</T></div>
    </div>}
  </div>;
}
