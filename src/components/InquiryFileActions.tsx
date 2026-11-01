'use client';
import {useRef,useState} from 'react';
import PdfFilePreview from './PdfFilePreview';
import {getAdminInquiryFileUrlAction} from '@/app/actions';
import {displayText} from '@/lib/ui/display-text';
import {filePreviewKind} from '@/lib/ui/file-preview';
export default function InquiryFileActions({inquiryId,file}:{inquiryId:string;file:{id:string;original_name:string;mime_type:string;file_size:number}}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [url,setUrl]=useState('');const [busy,setBusy]=useState('');const [error,setError]=useState('');
 const [text,setText]=useState('');const [rows,setRows]=useState<string[][]>([]);
 const kind=filePreviewKind(file.mime_type,file.original_name);
 function close(){dialog.current?.close();setUrl('');setText('');setRows([]);}
 async function preview(){
  setBusy('preview');setError('');
  try{
   if(kind==='unsupported')throw new Error('Preview is unavailable for this format. Download the original file.');
   const result=await getAdminInquiryFileUrlAction({inquiryId,fileId:file.id});
   if(kind==='sheet'||kind==='text'){
    if(file.file_size>10*1024*1024)throw new Error('This file is too large to preview. Download the original file.');
    const response=await fetch(result.url);if(!response.ok)throw new Error('Unable to load the file preview.');
    if(kind==='sheet'){
     const XLSX=await import('xlsx');const workbook=XLSX.read(await response.arrayBuffer(),{type:'array',sheetRows:100});
     const first=workbook.SheetNames[0];setRows(first?XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[first],{header:1,defval:''}).slice(0,100).map(row=>row.slice(0,20).map(cell=>String(cell??''))):[]);
    }else setText((await response.text()).slice(0,100000));
   }
   setUrl(result.url);dialog.current?.showModal();
  }catch(error){setError(error instanceof Error?error.message:'Unable to preview file.');}finally{setBusy('');}
 }
 async function download(){
  setBusy('download');setError('');
  try{const result=await getAdminInquiryFileUrlAction({inquiryId,fileId:file.id,download:true});const anchor=document.createElement('a');anchor.href=result.url;anchor.download=result.fileName;anchor.rel='noopener';document.body.appendChild(anchor);anchor.click();anchor.remove();}
  catch(error){setError(error instanceof Error?error.message:'Unable to download file.');}finally{setBusy('');}
 }
 return <><div className="inquiry-file-actions">{kind!=='unsupported'&&<button className="secondary-button compact-button" type="button" disabled={!!busy} onClick={preview}>{busy==='preview'?'Opening…':'Preview'}</button>}<button className="secondary-button compact-button" type="button" disabled={!!busy} onClick={download}>{busy==='download'?'Preparing…':'Download'}</button></div>{error&&<p className="error-inline" role="alert">{displayText(error)}</p>}
  <dialog ref={dialog} className="inquiry-file-dialog" aria-label={'Preview '+displayText(file.original_name)} onCancel={close} onClick={event=>{if(event.target===dialog.current)close();}} onClose={()=>{setUrl('');setText('');setRows([]);}}>
   <div className="inquiry-file-dialog-head"><strong>{displayText(file.original_name)}</strong><button type="button" className="secondary-button compact-button" onClick={close} aria-label="Close file preview">Close ×</button></div>
   <div className="inquiry-file-dialog-body">{url&&kind==='pdf'&&<PdfFilePreview url={url} name={displayText(file.original_name)}/>}{url&&kind==='image'&&<img src={url} alt={displayText(file.original_name)}/>}{url&&kind==='sheet'&&<><p className="muted">First sheet · up to 100 rows and 20 columns. Download for the complete file.</p><div className="spreadsheet-preview"><table><tbody>{rows.map((row,index)=><tr key={index}>{row.map((cell,column)=><td key={column}>{cell}</td>)}</tr>)}</tbody></table></div></>}{url&&kind==='text'&&<pre>{text}</pre>}</div>
  </dialog>
 </>;
}
