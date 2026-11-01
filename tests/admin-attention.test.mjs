import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {notificationHref} from '../src/lib/notifications.ts';
const require=createRequire(import.meta.url);
function render(data,mode='center'){
 const source=fs.readFileSync(new URL('../src/components/AdminAttention.tsx',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};let state=0;
 const mockedRequire=name=>{
  if(name==='react')return {...React,useState:()=>[state++===0?data:'',()=>{}],useEffect:()=>{},useCallback:fn=>fn,useRef:()=>({current:null})};
  if(name==='next/navigation')return {usePathname:()=>'/quotes',useRouter:()=>({refresh(){}})};
  if(name==='next/link')return {__esModule:true,default:({children,prefetch,...props})=>React.createElement('a',props,children)};
  if(name==='@/lib/notifications')return {notificationHref};
  return require(name);
 };
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:mockedRequire});
 return renderToStaticMarkup(React.createElement(mod.exports.default,{mode}));
}
const base={unreadCount:0,notifications:[],revisionCount:1,revisions:[{id:'r1',quoteId:'q1',reference:'ARAT-Q1',reason:'price',message:'Please review the price'}],draftCount:1,drafts:[{id:'q2',reference:'ARAT-Q1-R1',status:'draft'}],approvals:1,rfqs:0,alerts:2,tasks:0};
test('reading notifications cannot hide pending revision work and its edit destination',()=>{
 const html=render(base);
 assert.match(html,/request needs.*your review/);
 assert.match(html,/href="\/quotes\/q1"/);
 assert.match(html,/Please review the price/);
 assert.match(html,/href="\/quotes\/q2"/);
 assert.match(html,/Edit &amp; confirm prices/);
 assert.match(html,/open AI alerts/);
});
test('an unread notification has a visible headline and direct destination',()=>{
 const html=render({...base,unreadCount:1,notifications:[{id:'n1',title:'Customer requested a revision',message:'Price change',action_url:'/quotes/q1',created_at:'2026-11-01'}]});
 assert.match(html,/Customer requested a revision/);
 assert.match(html,/Open notification center/);
 assert.match(html,/href="\/quotes\/q1"/);
});

test('ordinary pages show a compact indicator without AI details or work banners',()=>{
 const html=render(base,'compact');
 assert.match(html,/Notifications/);
 assert.doesNotMatch(html,/open AI alerts|attention-banner|attention-drafts|Please review the price|Edit &amp; confirm prices/);
});
