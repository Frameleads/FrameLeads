'use client';
import {useState} from 'react';
type Progress={status?:string;code?:string;nextAction?:string;onboarding?:{state:string;first_governed_decision_id?:string|null}};
type Preview={code?:string;allowance?:number;mailboxEmail?:string;signals?:{id:string;receivedAt:string}[];decision?:{id:string;status:string;recommendedNextAction?:string|null}};
export default function ActivationProgress(){
 const [result,setResult]=useState<Progress|null>(null),[busy,setBusy]=useState(false);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [contact,setContact]=useState(''),[messageId,setMessageId]=useState(''),[appPassword,setAppPassword]=useState(''),[setupStatus,setSetupStatus]=useState('');
 const setup=async(kind:'prospect'|'reply')=>{setBusy(true);try{
  const payload=kind==='prospect'?{email:contact}:{prospectEmail:contact,messageId,appPassword};
  const response=await fetch('/api/onboarding/activation-preview/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();setSetupStatus(data.status??data.code);
  const p=await fetch('/api/onboarding/activation-preview',{cache:'no-store'});if(p.ok)setPreview(await p.json());
  const r=await fetch('/api/onboarding/progress',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});setResult(await r.json());
 }catch{setSetupStatus('PREVIEW_SETUP_UNAVAILABLE');}finally{setAppPassword('');setBusy(false);}};
 const refresh=async()=>{setBusy(true);try{const r=await fetch('/api/onboarding/progress',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});setResult(await r.json());
  const p=await fetch('/api/onboarding/activation-preview',{cache:'no-store'});if(p.ok)setPreview(await p.json());
 }catch{setResult({code:'ONBOARDING_UNAVAILABLE'});}finally{setBusy(false);}};
 const analyze=async(signalId:string)=>{setBusy(true);try{const r=await fetch('/api/onboarding/activation-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({signalId})});setPreview(await r.json());
  const progress=await fetch('/api/onboarding/progress',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});setResult(await progress.json());
 }catch{setPreview({code:'PREVIEW_UNAVAILABLE'});}finally{setBusy(false);}};
 return <section className="rounded-xl border border-slate-700 p-5 mb-6" aria-label="Customer activation">
  <h2 className="text-xl font-semibold">First governed decision</h2>
  <p className="text-sm text-slate-400">Activation is verified from your saved workflow decision and its policy trace.</p>
  <button type="button" onClick={refresh} disabled={busy} className="mt-3 rounded bg-indigo-600 px-4 py-2">{busy?'Checking progress...':'Check saved progress'}</button>
  {result && <div role="status" className="mt-3"><p>{result.onboarding?.state?.replaceAll('_',' ') ?? result.status ?? result.code}</p>
   {result.nextAction && <p>{result.nextAction}</p>}
   {result.onboarding?.first_governed_decision_id && <p>Decision: {result.onboarding.first_governed_decision_id}</p>}</div>}
 {preview && <div className="mt-3" role="status">
  {preview.allowance===1 && <p>Micro-Pilot includes one decision preview from a real controlled prospect reply. It never sends a reply.</p>}
  {preview.allowance===1 && !preview.signals?.length && <div className="mt-3 space-y-3">
   <p>Add a real controlled prospect without generating drafts. This uses one of your 25 prospect slots.</p>
   <label className="block">Controlled prospect email<input type="email" value={contact} onChange={e=>setContact(e.target.value)} className="ml-2 rounded bg-slate-800 p-2" /></label>
   <button type="button" disabled={busy||!contact} onClick={()=>setup('prospect')} className="rounded bg-indigo-600 px-4 py-2">Add controlled prospect</button>
   <p>Receive a real reply in {preview.mailboxEmail}. Existing authenticated provider replies also qualify.</p>
   {preview.mailboxEmail?.endsWith('@gmail.com') && <>
    <p>This single Gmail read checks the reply and its original sent message. It does not connect Inbox Triage or send anything. The app password is never saved.</p>
    <label className="block">Reply Message-ID<input value={messageId} onChange={e=>setMessageId(e.target.value)} placeholder="<provider-message-id>" className="ml-2 rounded bg-slate-800 p-2" /></label>
    <label className="block">Gmail app password<input type="password" autoComplete="off" value={appPassword} onChange={e=>setAppPassword(e.target.value)} className="ml-2 rounded bg-slate-800 p-2" /></label>
    <button type="button" disabled={busy||!contact||!messageId||!appPassword} onClick={()=>setup('reply')} className="rounded bg-indigo-600 px-4 py-2">Capture one real reply</button>
   </>}
  </div>}
  {setupStatus && <p>{setupStatus.replaceAll('_',' ')}</p>}
  {preview.allowance===1 && preview.signals?.map(signal=><button key={signal.id} type="button" disabled={busy} onClick={()=>analyze(signal.id)} className="mt-2 mr-2 rounded bg-indigo-600 px-4 py-2">Preview reply received {new Date(signal.receivedAt).toLocaleString()}</button>)}
  {preview.decision && <p>Decision {preview.decision.id}: {preview.decision.status}. {preview.decision.recommendedNextAction}. Your preview allowance is reserved; further decisions require an upgrade.</p>}
  {preview.code && <p>{preview.code.replaceAll('_',' ')}</p>}
 </div>}
 </section>;
}
