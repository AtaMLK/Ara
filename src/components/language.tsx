'use client';

import {createContext,createElement,useContext,useState,type JSX,type ReactNode} from 'react';
import {localeCookie,translate,type Locale} from '@/lib/i18n/translate';

const LanguageContext=createContext<{locale:Locale;setLocale:(locale:Locale)=>void}>({locale:'en',setLocale:()=>{}});
export function LanguageProvider({initialLocale,children}:{initialLocale:Locale;children:ReactNode}) {
  const [locale,setLanguage]=useState(initialLocale);
  function setLocale(next:Locale){
    try{document.cookie=`${localeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;}catch{}
    document.documentElement.lang=next;
    setLanguage(next);
  }
  return <LanguageContext.Provider value={{locale,setLocale}}>{children}</LanguageContext.Provider>;
}
export function useI18n(){const {locale}=useContext(LanguageContext);return {locale,t:(text:string)=>translate(locale,text),dateLocale:locale==='tr'?'tr-TR':'en-GB'};}
export function T({children}:{children:ReactNode}){
  const {t}=useI18n();
  const text=(value:ReactNode):ReactNode=>typeof value==='string'?t(value):Array.isArray(value)?value.map(text):value;
  return <>{text(children)}</>;
}
export function DateText({value,format='datetime'}:{value:string|number;format?:'date'|'datetime'}){
  const {dateLocale}=useI18n();const date=new Date(value);
  if(Number.isNaN(date.getTime()))return <>—</>;
  const options={timeZone:'Europe/Istanbul'};
  return <>{format==='date'?date.toLocaleDateString(dateLocale,options):date.toLocaleString(dateLocale,options)}</>;
}
// Explicitly localize interface attributes; customer/supplier values are untouched.
export function Localized<K extends keyof JSX.IntrinsicElements>(props:{as:K}&JSX.IntrinsicElements[K]){
  const {t}=useI18n();const {as,...attributes}=props;
  const result={...attributes} as Record<string,unknown>;
  for(const key of ['placeholder','title','aria-label'])if(typeof result[key]==='string')result[key]=t(result[key]);
  return createElement(as,result);
}
export function LanguageToggle(){
  const {locale,setLocale}=useContext(LanguageContext);
  const next=locale==='en'?'tr':'en';
  return <button type="button" className="language-toggle" onClick={()=>setLocale(next)} aria-label={locale==='en'?'Switch language to Turkish':'Dili İngilizce olarak değiştir'} title={locale==='en'?'Türkçe':'English'}>
    <svg className="language-flag" viewBox="0 0 30 20" aria-hidden="true">{locale==='tr'?<><path fill="#e30a17" d="M0 0h30v20H0z"/><circle fill="white" cx="12" cy="10" r="6"/><circle fill="#e30a17" cx="13.5" cy="10" r="4.8"/><path fill="white" d="m19 6.5.8 2.5h2.6l-2.1 1.5.8 2.5-2.1-1.5-2.1 1.5.8-2.5L15.6 9h2.6z"/></>:<><path fill="#012169" d="M0 0h30v20H0z"/><path stroke="white" strokeWidth="4" d="m0 0 30 20M30 0 0 20"/><path stroke="#c8102e" strokeWidth="1.5" d="m0 0 30 20M30 0 0 20"/><path stroke="white" strokeWidth="7" d="M15 0v20M0 10h30"/><path stroke="#c8102e" strokeWidth="4" d="M15 0v20M0 10h30"/></>}</svg>
    <span lang={locale}>{locale==='en'?'English':'Türkçe'}</span><span className="language-code">{next.toUpperCase()}</span>
  </button>;
}
