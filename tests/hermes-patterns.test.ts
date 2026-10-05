import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {AgentWorkspace} from '../src/agent-workspace.ts';import {Store} from '../src/store.ts';import {fixture} from '../src/domain.ts';
import {ModelPlanner} from '../src/adapters/model.ts';
test('one evaluation freezes skills and memory; a subsequent evaluation sees updates',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hermes-pattern-'));cpSync(resolve('agent'),dir,{recursive:true});const store=new Store(':memory:',fixture()),workspace=new AgentWorkspace(store,dir);
 try{const context=workspace.capturePromptContext();const first=context.readSkill('settle-obligations');writeFileSync(join(dir,'skills/settle-obligations/SKILL.md'),'---\nname: settle-obligations\ndescription: Updated\n---\nChanged procedure');workspace.memory({action:'add',kind:'FACT',content:'Owner prefers concise operational notices.'});assert.equal(context.readSkill('settle-obligations'),first);assert.equal(context.memory.length,0);const next=workspace.capturePromptContext();assert.match(next.readSkill('settle-obligations'),/Changed procedure/);assert.equal(next.memory.length,1);assert.notEqual(next.manifest.sha256,context.manifest.sha256);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('identical bounded memory writes reuse an entry without changing authority',()=>{
 const store=new Store(':memory:',fixture()),workspace=new AgentWorkspace(store);try{const version=store.read().financialVersion;workspace.memory({action:'add',kind:'LESSON',content:'Wait for the mint receipt.'});workspace.memory({action:'add',kind:'LESSON',content:'Wait for the mint receipt.'});assert.equal(workspace.memorySnapshot().length,1);assert.equal(store.read().financialVersion,version);}finally{store.close();}
});
test('repeat skill reads return a stub while the original procedure stays in the model conversation',async()=>{
 const state=fixture();state.obligations=[state.obligations[0]];const store=new Store(':memory:',state);let round=0,initial='';
 const send=(async(_url,init)=>{const body=JSON.parse(init!.body as string);if(round===1){initial=JSON.parse(body.input.at(-1).output).content;assert.match(initial,/settle-obligations/);}if(round===2){const repeat=JSON.parse(body.input.at(-1).output).content;assert.match(repeat,/already loaded/);assert.ok(repeat.length<initial.length);assert.ok(body.input.some((item:any)=>item.type==='function_call_output'&&JSON.parse(item.output).content===initial));}
 const call=round<2?{name:'read_skill',args:{name:'settle-obligations'}}:round===2?{name:'read_evidence',args:{obligationIds:['A']}}:{name:'finish',args:{decisions:[{obligationId:'A',action:'HOLD',reason:'Keep the current reserve while awaiting more receipts.',evidenceIds:['e-a']}]}};
 round++;return new Response(JSON.stringify({usage:{input_tokens:100,output_tokens:50},output:[{type:'function_call',name:call.name,call_id:`c${round}`,arguments:JSON.stringify(call.args)}]}));})as typeof fetch;
 try{const [decision]=await new ModelPlanner('fake','gpt-5.4-mini',send,new AgentWorkspace(store)).plan(state);assert.equal(decision.action,'HOLD');assert.equal(round,4);}finally{store.close();}
});
