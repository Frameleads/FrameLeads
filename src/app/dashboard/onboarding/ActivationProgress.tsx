'use client';
import {useCallback,useEffect,useState} from 'react';
type Progress={status?:string;code?:string;nextAction?:string;onboarding?:{state:string;first_governed_decision_id?:string|null}};
type Preview={code?:string;allowance?:number;mailboxEmail?:string;signals?:{id:string;receivedAt:string}[];decision?:{id:string;status:string;recommendedNextAction?:string|null}};
export default function ActivationProgress(){
 const [result,setResult]=useState<Progress|null>(null),[busy,setBusy]=useState(true);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [contact,setContact]=useState(''),[messageId,setMessageId]=useState(''),[appPassword,setAppPassword]=useState(''),[setupStatus,setSetupStatus]=useState('');
 const setup=async(kind:'prospect'|'reply')=>{setBusy(true);try{
  const payload=kind==='prospect'?{email:contact}:{prospectEmail:contact,messageId,appPassword};
  const response=await fetch('/api/onboarding/activation-preview/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();setSetupStatus(data.status??data.code);
  const p=await fetch('/api/onboarding/activation-preview',{cache:'no-store'});if(p.ok)setPreview(await p.json());
  const r=await fetch('/api/onboarding/progress',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});setResult(await r.json());
 }catch{setSetupStatus('PREVIEW_SETUP_UNAVAILABLE');}finally{setAppPassword('');setBusy(false);}};
 const refresh=useCallback(async(signal?:AbortSignal)=>{setBusy(true);try{const r=await fetch('/api/onboarding/progress',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal});
  const progress=await r.json();if(!signal?.aborted)setResult(progress);
  const p=await fetch('/api/onboarding/activation-preview',{cache:'no-store',signal});if(p.ok){const data=await p.json();if(!signal?.aborted)setPreview(data);}
 }catch{if(!signal?.aborted)setResult({code:'ONBOARDING_UNAVAILABLE'});}finally{if(!signal?.aborted)setBusy(false);}},[]);
 useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);return()=>controller.abort();},[refresh]);
 const analyze=async(signalId:string)=>{setBusy(true);try{const r=await fetch('/api/onboarding/activation-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({signalId})});setPreview(await r.json());
  const progress=await fetch('/api/onboarding/progress',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});setResult(await progress.json());
 }catch{setPreview({code:'PREVIEW_UNAVAILABLE'});}finally{setBusy(false);}};
 const lifecycle=['PURCHASED','ONBOARDING_STARTED','SETUP_IN_PROGRESS','READY_FOR_DECISION','ACTIVATED'];
 const rank=lifecycle.indexOf(result?.onboarding?.state??'');
 const steps=['Add controlled prospect','Capture one real provider-backed reply','Generate first governed decision'];
 const actionClass='rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:border-[#FF5A1F]/50 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF5A1F] disabled:cursor-not-allowed disabled:opacity-40';
 const inputClass='mt-1 block w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white placeholder:text-gray-600 focus:border-[#FF5A1F]/60 focus:outline-none';
 return <section className="mb-6 rounded-xl border border-white/10 bg-[#0A0A0A] p-5 text-white" aria-label="Customer activation" aria-busy={busy}>
  <header className="flex items-start justify-between gap-4">
   <div><h2 className="text-sm font-semibold uppercase tracking-wider">First governed decision</h2>
    <p className="mt-2 text-sm text-gray-400">Activation is verified from your saved workflow decision and its policy trace.</p></div>
   <button type="button" onClick={()=>void refresh()} disabled={busy} className="shrink-0 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-gray-400 transition hover:border-white/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF5A1F] disabled:cursor-not-allowed disabled:opacity-40">Refresh status</button>
  </header>
  <div role="status" aria-live="polite" className="mt-4">
   <p className="inline-flex rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-gray-300">{result?.onboarding?.state?.replaceAll('_',' ') ?? result?.status ?? result?.code?.replaceAll('_',' ') ?? 'Loading progress...'}</p>
   {result?.nextAction && <p className="mt-3 text-sm text-gray-400">{result.nextAction}</p>}
   {result?.onboarding?.first_governed_decision_id && <p className="mt-2 break-all text-xs text-gray-500">Decision: {result.onboarding.first_governed_decision_id}</p>}
  </div>
  <ol className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="Activation progress">
   {steps.map((label,index)=>{const complete=rank>=index+2,current=rank>=0&&!complete&&(index===0||rank>=index+1);
    return <li key={label} aria-current={current?'step':undefined} className={`rounded-lg border p-3 ${current?'border-[#FF5A1F]/30 bg-[#FF5A1F]/5':'border-white/10 bg-black/20'}`}>
     <div className="flex items-start gap-3"><span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${current?'border-[#FF5A1F]/40 text-[#FF5A1F]':complete?'border-white/25 text-white':'border-white/10 text-gray-600'}`}>{complete?'\u2713':index+1}</span>
      <div><p className={`text-sm ${complete||current?'text-white':'text-gray-500'}`}>{label}</p><p className={`mt-1 text-xs ${current?'text-[#FF5A1F]':'text-gray-500'}`}>{complete?'Complete':current?'Current':'Pending'}</p></div></div>
    </li>;})}
  </ol>
 {preview && <div className="mt-5 space-y-3 border-t border-white/10 pt-5 text-sm text-gray-400" role="status">
  {preview.allowance===1 && <p>Micro-Pilot includes one decision preview from a real controlled prospect reply. It never sends a reply.</p>}
  {preview.allowance===1 && !preview.signals?.length && <div className="mt-3 space-y-3">
   <p>Add a real controlled prospect without generating drafts. This uses one of your 25 prospect slots.</p>
   <label className="block max-w-md">Controlled prospect email<input type="email" value={contact} onChange={e=>setContact(e.target.value)} className={inputClass} /></label>
   <button type="button" disabled={busy||!contact} onClick={()=>setup('prospect')} className={actionClass}>Add controlled prospect</button>
   <p>Receive a real reply in {preview.mailboxEmail}. Existing authenticated provider replies also qualify.</p>
   {preview.mailboxEmail?.endsWith('@gmail.com') && <>
    <p>This single Gmail read checks the reply and its original sent message. It does not connect Inbox Triage or send anything. The app password is never saved.</p>
    <label className="block max-w-md">Reply Message-ID<input value={messageId} onChange={e=>setMessageId(e.target.value)} placeholder="<provider-message-id>" className={inputClass} /></label>
    <label className="block max-w-md">Gmail app password<input type="password" autoComplete="off" value={appPassword} onChange={e=>setAppPassword(e.target.value)} className={inputClass} /></label>
    <button type="button" disabled={busy||!contact||!messageId||!appPassword} onClick={()=>setup('reply')} className={actionClass}>Capture one real reply</button>
   </>}
  </div>}
  {setupStatus && <p>{setupStatus.replaceAll('_',' ')}</p>}
  {preview.allowance===1 && preview.signals?.map(signal=><button key={signal.id} type="button" disabled={busy} onClick={()=>analyze(signal.id)} className={`${actionClass} mr-2`}>Preview reply received {new Date(signal.receivedAt).toLocaleString()}</button>)}
  {preview.decision && <p>Decision {preview.decision.id}: {preview.decision.status}. {preview.decision.recommendedNextAction}. Your preview allowance is reserved; further decisions require an upgrade.</p>}
  {preview.code && <p>{preview.code.replaceAll('_',' ')}</p>}
 </div>}
 </section>;
}
