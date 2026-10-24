import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function Logo({compact=false}:{compact?:boolean}) {
  return <span className="brand"><svg width="27" height="32" viewBox="0 0 30 36" aria-hidden="true"><rect x="2" y="1" width="26" height="34" rx="1" fill="currentColor"/><path d="M8 11h14L8 25h14" fill="none" stroke="#fbfbfb" strokeWidth="2.5"/><circle cx="8" cy="25" r="2.5" fill="#fbfbfb"/><circle cx="22" cy="11" r="2.5" fill="#fbfbfb"/></svg>{!compact&&<span>ZTrace</span>}</span>
}

export function CopyButton({value,label='Copy'}:{value:string;label?:string}) {
  const [copied,setCopied]=useState(false)
  const [failed,setFailed]=useState(false)
  return <button className="copy-button" aria-label={copied?'Copied':label} title={copied?'Copied':label} onClick={async()=>{
    try {await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),1600)} catch {setFailed(true);setTimeout(()=>setFailed(false),2000)}
  }}>{copied?<Check size={14}/>:<Copy size={14}/>}<span className="sr-only" role="status">{copied?'Copied to clipboard':failed?'Clipboard unavailable. Select and copy the text manually.':''}</span></button>
}

