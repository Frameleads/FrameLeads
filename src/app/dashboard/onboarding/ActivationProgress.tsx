'use client';
import {useState} from 'react';
type Progress={status?:string;code?:string;nextAction?:string;onboarding?:{state:string;first_governed_decision_id?:string|null}};
export default function ActivationProgress(){
 const [result,setResult]=useState<Progress|null>(null),[busy,setBusy]=useState(false);
 const refresh=async()=>{setBusy(true);try{const r=await fetch('/api/onboarding/progress',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});setResult(await r.json());}catch{setResult({code:'ONBOARDING_UNAVAILABLE'});}finally{setBusy(false);}};
 return <section className="rounded-xl border border-slate-700 p-5 mb-6" aria-label="Customer activation">
  <h2 className="text-xl font-semibold">First governed decision</h2>
  <p className="text-sm text-slate-400">Activation is verified from your saved workflow decision and its policy trace.</p>
  <button type="button" onClick={refresh} disabled={busy} className="mt-3 rounded bg-indigo-600 px-4 py-2">{busy?'Checking progress...':'Check saved progress'}</button>
  {result && <div role="status" className="mt-3"><p>{result.onboarding?.state?.replaceAll('_',' ') ?? result.status ?? result.code}</p>
   {result.nextAction && <p>{result.nextAction}</p>}
   {result.onboarding?.first_governed_decision_id && <p>Decision: {result.onboarding.first_governed_decision_id}</p>}</div>}
 </section>;
}
