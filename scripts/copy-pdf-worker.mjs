import {mkdir,copyFile,cp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const root=path.dirname(require.resolve('pdfjs-dist/package.json'));
await mkdir('public/pdfjs',{recursive:true});
await copyFile(path.join(root,'build/pdf.worker.min.mjs'),'public/pdfjs/pdf.worker.min.mjs');

for(const name of ['cmaps','standard_fonts','wasm'])await cp(path.join(root,name),path.join('public/pdfjs',name),{recursive:true});
