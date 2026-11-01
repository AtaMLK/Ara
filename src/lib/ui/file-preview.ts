export function filePreviewKind(mime:string,name:string):'pdf'|'image'|'sheet'|'text'|'unsupported'{
 const extension=name.toLowerCase();
 if(/^(text\/html|application\/xhtml\+xml|image\/svg\+xml)$/.test(mime))return 'unsupported';
 if(mime==='application/pdf'||extension.endsWith('.pdf'))return 'pdf';
 if(/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime))return 'image';
 if(/\.(xlsx?|csv)$/.test(extension)||mime.includes('spreadsheet')||mime==='application/vnd.ms-excel')return 'sheet';
 if(mime.startsWith('text/')&&!/html|xml/.test(mime))return 'text';
 return 'unsupported';
}
