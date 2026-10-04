import React,{useState} from 'react';
import type { State } from '../domain.ts';

export function DecisionRecords({state,api}:{state:State;api:(path:string)=>Promise<any>}){
  const [feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false);
  const runs=[...state.runs].reverse().filter(r=>r.decisionRecordSummary).slice(0,5);
  async function download(id:string){
    setBusy(true);setFeedback('');
    try{
      const record=await api(`runs/${encodeURIComponent(id)}/decision-record`);
      const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`settlepilot-decision-${id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setFeedback('Private decision record exported. It may contain business and wallet details.');
    }catch{setFeedback('Unable to export this record. Refresh and try again.');}finally{setBusy(false);}
  }
  return <section className="panel decision-records"><span className="eyebrow">DECISION HISTORY</span><h2>Revisit the facts behind a decision</h2><p className="sub">Financial inputs and document digests are saved before execution. Each export contains the final choices and separately labelled execution outcomes.</p>
    {runs.map(run=><article className="payment" key={run.id}><div><strong>{new Date(run.createdAt).toLocaleString('en-GB')}</strong><p>{run.source} · {run.decisions.length} decisions · {run.executionStatus?.toLowerCase()}</p></div><button className="secondary" disabled={busy} onClick={()=>void download(run.id)}>Export decision</button></article>)}
    {!runs.length&&<p className="empty">New evaluations will save decision records here. Historical inputs are never reconstructed from today's state.</p>}
    <p className="note">The digest checks file integrity. It is not a signature or independent proof of settlement.</p>{feedback&&<p role="status">{feedback}</p>}
  </section>;
}
