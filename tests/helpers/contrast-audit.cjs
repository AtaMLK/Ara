// Run in the browser. Check direct text against its composited CSS surface.
module.exports=function contrastAudit(){
 const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number);
 const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const failures=[];
 for(const el of document.querySelectorAll('main *,aside *,header *')){
  const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
  if(rect.width<1||rect.height<1||style.visibility==='hidden'||el.closest('[disabled],[aria-hidden="true"],iframe,svg,script,style'))continue;
  const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
  if(!text)continue;
  let bg=[16,23,31];const ancestors=[];for(let p=el;p;p=p.parentElement)ancestors.unshift(p);
  for(const p of ancestors){const c=rgb(getComputedStyle(p).backgroundColor);if(c.length>=3){const a=c[3]??1;bg=bg.map((v,i)=>c[i]*a+v*(1-a));}}
  const fg=rgb(style.color);if(fg.length<3)continue;
  const [a,b]=[luminance(fg),luminance(bg)].sort((x,y)=>y-x),ratio=(a+.05)/(b+.05);
  const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700);
  if(ratio<(large?3:4.5))failures.push({text:text.slice(0,70),className:String(el.className),ratio:Number(ratio.toFixed(2)),color:style.color,bg});
 }
 return failures;
};
