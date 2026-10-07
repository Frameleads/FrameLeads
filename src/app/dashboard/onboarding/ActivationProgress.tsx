'use client';
import {useState} from 'react';
type Progress={status?:string;code?:string;nextAction?:string;onboarding?:{state:string;first_governed_decision_id?:string|null}};
type Preview={code?:string;allowance?:number;signals?:{id:string;receivedAt:string}[];decision?:{id:string;status:string;recommendedNextAction?:string|null}};
export default function ActivationProgress(){
 const [result,setResult]=useState<Progress|null>(null),[busy,setBusy]=useState(false);
 const [preview,setPreview]=useState<Preview|null>(null);
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
  {preview.allowance===1 && !preview.signals?.length && <p>Receive a real reply through your existing provider webhook, then check saved progress again.</p>}
  {preview.allowance===1 && preview.signals?.map(signal=><button key={signal.id} type="button" disabled={busy} onClick={()=>analyze(signal.id)} className="mt-2 mr-2 rounded bg-indigo-600 px-4 py-2">Preview reply received {new Date(signal.receivedAt).toLocaleString()}</button>)}
  {preview.decision && <p>Decision {preview.decision.id}: {preview.decision.status}. {preview.decision.recommendedNextAction}. Your preview allowance is reserved; further decisions require an upgrade.</p>}
  {preview.code && <p>{preview.code.replaceAll('_',' ')}</p>}
 </div>}
 </section>;
}
