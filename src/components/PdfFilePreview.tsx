'use client';
import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy,PDFDocumentLoadingTask,RenderTask} from 'pdfjs-dist';
export default function PdfFilePreview({url,name}:{url:string;name:string}){
 const canvas=useRef<HTMLCanvasElement>(null);
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null);
 const [page,setPage]=useState(1);const [busy,setBusy]=useState(true);const [error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;let loading:PDFDocumentLoadingTask|undefined;
  void(async()=>{try{
   const library=await import('pdfjs-dist');if(cancelled)return;
   library.GlobalWorkerOptions.workerSrc='/pdfjs/pdf.worker.min.mjs?v='+library.version;
   loading=library.getDocument({url,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});
   const document=await loading.promise;if(cancelled)return;setPdf(document);
  }catch{if(!cancelled){setError('Unable to render this PDF. Download the original file.');setBusy(false);}}})();
  return()=>{cancelled=true;void loading?.destroy();};
 },[url]);
 useEffect(()=>{
  if(!pdf)return;let cancelled=false;let render:RenderTask|undefined;
  void(async()=>{try{
   const documentPage=await pdf.getPage(page);if(cancelled||!canvas.current)return;
   const element=canvas.current;const viewport=documentPage.getViewport({scale:1.5});const ratio=Math.min(window.devicePixelRatio||1,2);
   element.width=Math.floor(viewport.width*ratio);element.height=Math.floor(viewport.height*ratio);
   const context=element.getContext('2d');if(!context)throw new Error();
   render=documentPage.render({canvas:element,canvasContext:context,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});
   await render.promise;if(!cancelled){setBusy(false);setError('');}
  }catch{if(!cancelled){setError('Unable to render this page. Download the original file.');setBusy(false);}}})();
  return()=>{cancelled=true;render?.cancel();};
 },[pdf,page]);
 return <div className="pdf-canvas-preview"><div className="pdf-page-controls"><button type="button" className="secondary-button compact-button" disabled={busy||page<=1} onClick={()=>{setBusy(true);setPage(value=>value-1);}}>Previous</button><span>Page {page}{pdf?' of '+pdf.numPages:''}</span><button type="button" className="secondary-button compact-button" disabled={busy||!pdf||page>=pdf.numPages} onClick={()=>{setBusy(true);setPage(value=>value+1);}}>Next</button></div>{busy&&<p role="status" className="muted">Loading PDF…</p>}{error&&<p role="alert" className="error-inline">{error}</p>}<canvas ref={canvas} aria-label={name+' · Page '+page} style={{display:error?'none':'block'}}/></div>;
}
