import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { RulesPlanner } from '../src/planner.ts';
import { SimulationGateway } from '../src/adapters/simulation.ts';
import { LlmSettingsService } from '../src/llm-settings.ts';

const openAiKey = 'sk-test-openai-key-abcdefghijklmnopqrstuvwxyz';
const jevKey = 'jev-test-key-abcdefghijklmnopqrstuvwxyz';

function setup(envFile: string, env: NodeJS.ProcessEnv = {}) {
  const store = new Store(':memory:', fixture());
  const engine = new Engine(store, new SimulationGateway(store), new RulesPlanner());
  const service = new LlmSettingsService(store, engine, { envFile, env });
  return { store, engine, service, env };
}

test('LLM settings are write-only, preserve unrelated env values, and replace the planner immediately', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tameion-llm-'));
  const envFile = join(directory, '.env');
  writeFileSync(envFile, 'UNCHANGED=yes\nALLOW_MODEL_REQUESTS=false\nOPENAI_MODEL=gpt-old\n');
  const { store, engine, service, env } = setup(envFile);
  try {
    assert.equal(service.settings().llmKeyConfigured, false);
    const enabled = service.configure({ enabled: true, llmApiKey: openAiKey, llmEndpoint: 'https://api.openai.com/v1/responses', llmModel: 'gpt-5.4', jevEnabled: true, jevApiKey: jevKey, jevEndpoint: 'https://api.typesafe.ai/v1/systemone', jevModel: 'jev-latest', jevMinimumConfidence: 0.82 });
    assert.deepEqual(enabled, { enabled: true, active: true, llmKeyConfigured: true, llmEndpoint: 'https://api.openai.com/v1/responses', llmModel: 'gpt-5.4', jevEnabled: true, jevKeyConfigured: true, jevEndpoint: 'https://api.typesafe.ai/v1/systemone', jevModel: 'jev-latest', jevMinimumConfidence: 0.82, planner: 'AI · gpt-5.4 + Jev jev-latest' });
    assert.equal(JSON.stringify(enabled).includes(openAiKey), false);
    assert.equal(JSON.stringify(enabled).includes(jevKey), false);
    assert.equal(engine.planner.name, 'AI · gpt-5.4 + Jev jev-latest');
    assert.equal(env.OPENAI_API_KEY, openAiKey);
    assert.equal(env.JEV_API_KEY, jevKey);
    const saved = readFileSync(envFile, 'utf8');
    assert.match(saved, /UNCHANGED=yes/);
    assert.match(saved, new RegExp(`OPENAI_API_KEY=${openAiKey}`));
    assert.match(saved, new RegExp(`JEV_API_KEY=${jevKey}`));

    const updated = service.configure({ enabled: true, llmEndpoint: 'http://127.0.0.1:11434/v1/responses', llmModel: 'gpt-5.4-mini', jevEnabled: false, jevEndpoint: 'https://api.typesafe.ai/v1/systemone', jevModel: 'jev-latest', jevMinimumConfidence: 0.82 });
    assert.equal(updated.llmKeyConfigured, true);
    assert.equal(updated.jevKeyConfigured, true);
    assert.equal(updated.planner, 'AI · gpt-5.4-mini');
    assert.match(readFileSync(envFile, 'utf8'), new RegExp(`OPENAI_API_KEY=${openAiKey}`));
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('LLM settings validate dependencies and refuse planner replacement during an active run', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tameion-llm-guard-'));
  const envFile = join(directory, '.env');
  const { store, engine, service } = setup(envFile);
  try {
    assert.throws(() => service.configure({ enabled: true, llmEndpoint: 'https://api.openai.com/v1/responses', llmModel: 'gpt-5.4', jevEnabled: false, jevEndpoint: 'https://api.typesafe.ai/v1/systemone', jevModel: 'jev-latest', jevMinimumConfidence: 0.8 }), /LLM_KEY_REQUIRED/);
    assert.throws(() => service.configure({ enabled: false, llmEndpoint: 'https://api.openai.com/v1/responses', llmModel: 'gpt-5.4', jevEnabled: true, jevApiKey: jevKey, jevEndpoint: 'https://api.typesafe.ai/v1/systemone', jevModel: 'jev-latest', jevMinimumConfidence: 0.8 }), /JEV_REQUIRES_MODEL/);
    assert.throws(() => service.configure({ enabled: true, llmApiKey: openAiKey, llmEndpoint: 'http://provider.example/v1/responses', llmModel: 'gpt-5.4', jevEnabled: false, jevEndpoint: 'https://api.typesafe.ai/v1/systemone', jevModel: 'jev-latest', jevMinimumConfidence: 0.8 }), /INSECURE_LLM_ENDPOINT/);
    store.change(state => { state.runs.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), source: 'test', status: 'RUNNING', decisions: [], executionStatus: 'PLANNED' }); });
    assert.throws(() => engine.setPlanner(new RulesPlanner()), /AGENT_RUN_IN_PROGRESS/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('LLM settings API is session-protected and never returns API keys', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tameion-llm-api-'));
  const envFile = join(directory, '.env');
  const { store, engine, service } = setup(envFile);
  const runtime = { store, engine, arc: undefined, sources: undefined, bridge: undefined, bridgeEnabled: false, sendEnabled: false, useModel: false, walletProvider: 'simulation' } as const;
  const server = createApp(runtime, 'test-session', { llm: service }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/llm-settings`;
  const headers = { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ enabled: true, llmApiKey: openAiKey, llmEndpoint: 'https://api.openai.com/v1/responses', llmModel: 'gpt-5.4', jevEnabled: false, jevEndpoint: 'https://api.typesafe.ai/v1/systemone', jevModel: 'jev-latest', jevMinimumConfidence: 0.8 }) });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.active, true);
    assert.equal(body.planner, 'AI · gpt-5.4');
    assert.equal(JSON.stringify(body).includes(openAiKey), false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('model usage and block reset are owner-only and reset does not resume or erase usage',async()=>{
 const s=fixture();s.paused=true;const store=new Store(':memory:',s),engine=new Engine(store,new SimulationGateway(store),new RulesPlanner());
 store.change(s=>s.modelControl={requests:[{id:'meter',runId:'r',provider:'planner',model:'gpt-5.4-mini',at:Date.now(),status:'UNKNOWN',reservedTokens:8000}],blocks:{planner:{code:'MODEL_CREDIT_EXHAUSTED',at:Date.now()}}});
 const runtime={store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'}as const;
 const server=createApp(runtime,'owner-session').listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address()as any).port}`;
 const headers={Authorization:'Bearer owner-session','Content-Type':'application/json'};
 try{assert.equal((await fetch(base+'/api/model-usage')).status,401);assert.equal((await fetch(base+'/api/model-usage/reset-blocks',{method:'POST',headers,body:'{}'})).status,400);const usage=await(await fetch(base+'/api/model-usage',{headers})).json();assert.equal(usage.requests.length,1);const result=await(await fetch(base+'/api/model-usage/reset-blocks',{method:'POST',headers,body:'{"confirmed":true}'})).json();assert.equal(result.paused,true);assert.equal(store.read().paused,true);assert.equal(store.read().modelControl!.requests.length,1);assert.deepEqual(store.read().modelControl!.blocks,{});}finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});


test('fresh local model settings default to mini without replacing a saved model', () => {
  const directory = mkdtempSync(join(tmpdir(), 'settlepilot-model-default-'));
  const envFile = join(directory, '.env');
  const current = setup(envFile);
  try {
    assert.equal(current.service.settings().llmModel, 'gpt-5.4-mini');
    assert.equal(current.service.settings().active, false);
    current.env.OPENAI_MODEL = 'owner-selected-model';
    assert.equal(current.service.settings().llmModel, 'owner-selected-model');
  } finally { current.store.close(); rmSync(directory, { recursive: true, force: true }); }
});
