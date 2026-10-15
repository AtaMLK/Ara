'use client';
import {useEffect,useTransition} from 'react';
import {useRouter} from 'next/navigation';
export default function AutomationRefresh({enabled}:{enabled:boolean}) {
  const router=useRouter(),[pending,start]=useTransition();
  useEffect(()=>{if(!enabled)return;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!pending)start(()=>router.refresh());},15000);return()=>clearInterval(timer);},[enabled,pending,router]);
  return null;
}
