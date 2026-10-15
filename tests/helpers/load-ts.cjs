const fs=require('node:fs'),path=require('node:path'),{transformSync}=require('next/dist/build/swc');
module.exports=function createLoader(mocks={}){
  const root=path.resolve(__dirname,'../..'),cache=new Map();
  function load(spec,parent=root){
    if(Object.hasOwn(mocks,spec))return mocks[spec];
    if(spec==='server-only')return {};
    if(!spec.startsWith('@/')&&!spec.startsWith('.'))return require(spec);
    let file=spec.startsWith('@/')?path.join(root,'src',spec.slice(2)):path.resolve(parent,spec);
    if(!path.extname(file))file+='.ts';
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const code=transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:file.endsWith('.tsx')},target:'es2022'},module:{type:'commonjs'}}).code;
    new Function('require','module','exports',code)(next=>load(next,path.dirname(file)),module,module.exports);return module.exports;
  }
  return load;
};
