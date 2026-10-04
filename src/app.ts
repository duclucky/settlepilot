import express from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Address, CHAIN_ID, isPending, money, SOURCE_CHAIN_NAMES } from './domain.ts';
import { event } from './store.ts';
import { evaluate, planningEligibility } from './policy.ts';
import type { Runtime } from './config.ts';
import { processVerifiedCrosschainRevenue } from './crosschain-revenue.ts';
import { runAdaptive } from './adaptive.ts';
import { resolveAgentUserDecision } from './user-decision.ts';
import { realpathSync, statSync } from 'node:fs';
import { respondToAction, syncActionRequests } from './action-requests.ts';
import { enqueue } from './scheduler-core.ts';
import { exportDecisionRecord, summarizeDecisionRun } from './decision-record.ts';
import { analyzeLiquidity } from './liquidity-analysis.ts';
import type { AgentScheduler } from './scheduler.ts';
import type { TelegramNotificationService } from './telegram-settings.ts';
import type { LlmSettingsService } from './llm-settings.ts';

const ReceiptInput = z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), source: Address, amount: z.string().transform(money), invoice: z.string().trim().min(1).max(120) }).strict();
const CrosschainInput = ReceiptInput.extend({ sourceChain: z.enum(SOURCE_CHAIN_NAMES) });
export function createApp(runtime: Runtime, token = randomBytes(32).toString('hex'), services: { telegram?: TelegramNotificationService; llm?: LlmSettingsService; scheduler?:AgentScheduler } = {}) {
  const { store, engine } = runtime;
  const evaluateChanges = async () => services.scheduler ? { jobId:services.scheduler.wake('OWNER_OR_SOURCE_CHANGED') } : runAdaptive(runtime);
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return res.status(403).json({ error: 'LOCAL_HOST_REQUIRED' });
    const origin = req.headers.origin;
    if (origin && ![`http://${host}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) return res.status(403).json({ error: 'ORIGIN_REJECTED' });
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.get('/healthz',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({service:'tameion',surface:'local',status:'ok'});});
  // Loopback-only desktop session. Never use this bootstrap as internet authentication.
  app.get('/api/session', (_req, res) => res.json({ token }));
  app.use('/api', (req, res, next) => {
    const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'SESSION_REQUIRED' });
    next();
  });
  app.get('/api/state', (_req, res) => {
    syncActionRequests(store);
    const state = store.read();
    res.json({ ...state, runs:state.runs.map(summarizeDecisionRun), liquidityAnalysis:analyzeLiquidity(state), planner: engine.planner.name, sendEnabled: runtime.sendEnabled, bridgeEnabled: runtime.bridgeEnabled, walletProvider: runtime.walletProvider, eligibility: Object.fromEntries(state.obligations.map(o => [o.id, planningEligibility(state, o)])) });
  });
  app.get('/api/source-settings', (_req,res)=>{const a=store.read().autonomy!;res.json({enabled:a.enabled,sourceDirectory:a.sourceDirectory??'',sourceAuthority:a.sourceAuthority});});
  app.get('/api/runs/:id/decision-record', (req,res)=>{
    const state=store.read();
    if(!state.runs.find(r=>r.id===req.params.id)?.decisionRecord)return res.status(404).json({error:'DECISION_RECORD_UNAVAILABLE'});
    res.json(exportDecisionRecord(state,req.params.id));
  });
  app.post('/api/source-settings', (req,res)=>{
    const data=z.object({enabled:z.boolean(),sourceDirectory:z.string().max(1024),sourceAuthority:z.boolean()}).strict().parse(req.body);
    const directory=data.sourceDirectory.trim()?realpathSync(data.sourceDirectory):undefined;
    if(directory&&!statSync(directory).isDirectory())throw new Error('SOURCE_DIRECTORY_REQUIRED');
    store.change(s=>{if(s.autonomy!.lease)throw new Error('AGENT_RUN_IN_PROGRESS');Object.assign(s.autonomy!,{enabled:data.enabled,sourceDirectory:directory,sourceAuthority:data.sourceAuthority});});
    if(data.enabled)services.scheduler?.wake('RESUMED');res.json({ok:true});
  });
  app.post('/api/action-requests/:id/responses',(req,res)=>{res.status(202).json(respondToAction(store,req.params.id,req.body));});
  app.get('/api/telegram-settings', (_req, res) => {
    if (!services.telegram) throw new Error('TELEGRAM_SETTINGS_UNAVAILABLE');
    res.json(services.telegram.settings());
  });
  app.post('/api/telegram-settings', (req, res) => {
    if (!services.telegram) throw new Error('TELEGRAM_SETTINGS_UNAVAILABLE');
    res.json(services.telegram.configure(req.body));
  });
  app.post('/api/telegram-settings/test', async (_req, res) => {
    if (!services.telegram) throw new Error('TELEGRAM_SETTINGS_UNAVAILABLE');
    await services.telegram.test(); res.json({ ok: true });
  });
  app.get('/api/llm-settings', (_req, res) => {
    if (!services.llm) throw new Error('LLM_SETTINGS_UNAVAILABLE');
    res.json(services.llm.settings());
  });
  app.post('/api/llm-settings', (req, res) => {
    if (!services.llm) throw new Error('LLM_SETTINGS_UNAVAILABLE');
    res.json(services.llm.configure(req.body));
  });
  app.post('/api/wallet/check', async (_req, res) => {
    if (store.read().mode !== 'testnet') throw new Error('TESTNET_ONLY');
    const snapshot = await engine.gateway.snapshot();
    store.change(s => { s.snapshot = snapshot; event(s, 'WALLET_CONNECTION_VERIFIED', `${runtime.walletProvider}: ARC-TESTNET ${s.policy.sender}`); });
    res.json({ ok: true });
  });
  app.post('/api/run', async (_req, res) => { res.json(await evaluateChanges()); });
  app.post('/api/reconcile', async (_req, res) => { await engine.reconcile(); res.json({ ok: true }); });
  app.post('/api/payments/recover', async (req, res) => {
    const { intentId, providerId } = z.object({ intentId: z.string().uuid(), providerId: z.string().uuid() }).strict().parse(req.body);
    const intent = store.read().intents.find(i => i.id === intentId);
    if (!intent || !engine.gateway.recover) throw new Error('RECOVERY_NOT_AVAILABLE');
    await engine.gateway.recover(intent, providerId); await engine.reconcile(); res.json({ ok: true });
  });
  app.post('/api/pause', (req, res) => {
    const { paused } = z.object({ paused: z.boolean() }).strict().parse(req.body);
    store.change(s => { s.paused = paused; event(s, paused ? 'PAUSED' : 'RESUMED', 'owner');if(!paused&&services.scheduler)enqueue(s,'RESUMED',`resume:${randomUUID()}`); }); res.json({ ok: true });
  });
  app.post('/api/simulation/revenue', async (req, res) => {
    const { eventId } = z.object({ eventId: z.string().uuid() }).strict().parse(req.body);
    store.change(s => {
      if (s.mode !== 'simulation') throw new Error('SIMULATION_ONLY');
      if (s.revenues.some(r => r.id === eventId)) return;
      if (s.intents.some(isPending)) throw new Error('RECONCILE_REQUIRED');
      s.snapshot.balance = (BigInt(s.snapshot.balance) + BigInt(money('10'))).toString();
      s.snapshot.observedAt = new Date().toISOString();
      s.revenues.push({ id: eventId, source: 'Simulated customer', amount: money('10'), invoice: 'Sample project', createdAt: new Date().toISOString(), simulated: true });
      event(s, 'SIMULATED_REVENUE', '+10 simulated USDC; no onchain transaction');
    });
    res.json(await evaluateChanges());
  });
  app.post('/api/revenue/verify', async (req, res) => {
    const data = ReceiptInput.parse(req.body); const s = store.read();
    if (s.mode !== 'testnet' || !runtime.arc) throw new Error('TESTNET_ONLY');
    await runtime.arc.verify(data.hash, { sender: data.source, recipient: s.policy.sender, amount: data.amount, chainId: CHAIN_ID });
    const snapshot = await engine.gateway.snapshot();
    store.change(state => {
      if (state.revenues.some(r => r.hash?.toLowerCase() === data.hash.toLowerCase())) throw new Error('REVENUE_ALREADY_IMPORTED');
      state.revenues.push({ id: randomUUID(), ...data, createdAt: new Date().toISOString(), simulated: false });
      state.snapshot = snapshot; event(state, 'REVENUE_VERIFIED', `${data.invoice}: ${data.hash}`);
    });
    res.json(await evaluateChanges());
  });
  app.post('/api/receivables', async (req, res) => {
    const data = ReceiptInput.omit({ hash: true }).parse(req.body);
    if (!runtime.arc || store.read().mode !== 'testnet') throw new Error('TESTNET_ONLY');
    const snapshot = await engine.gateway.snapshot();
    store.change(s => {
      if (s.receivables.filter(r => !r.receivedHash).length >= 20 || s.receivables.some(r => !r.receivedHash && r.source === data.source && r.amount === data.amount)) throw new Error('AMBIGUOUS_OR_TOO_MANY_RECEIVABLES');
      s.receivables.push({ ...data, id: randomUUID(), cursor: snapshot.block, createdAt: new Date().toISOString() });
      event(s, 'RECEIVABLE_REGISTERED', data.invoice);
    }); res.status(201).json({ ok: true });
  });
  app.post('/api/crosschain/receivables', async (req, res) => {
    const data = CrosschainInput.omit({ hash: true }).parse(req.body);
    if (!runtime.sources || !runtime.bridge || store.read().mode !== 'testnet') throw new Error('CCTP_NOT_AVAILABLE');
    const reader = runtime.sources.get(data.sourceChain); if (!reader) throw new Error('SOURCE_CHAIN_NOT_CONFIGURED');
    const snapshot = await reader.snapshot(store.read().policy.sender);
    store.change(s => {
      if (s.crosschainReceivables.filter(r => !r.receivedHash).length >= 20 || s.crosschainReceivables.some(r => !r.receivedHash && r.source === data.source && r.amount === data.amount)) throw new Error('AMBIGUOUS_OR_TOO_MANY_RECEIVABLES');
      s.crosschainReceivables.push({ ...data, id: randomUUID(), cursor: snapshot.block, createdAt: new Date().toISOString() });
      event(s, 'CROSSCHAIN_RECEIVABLE_REGISTERED', `${data.invoice}: ${data.sourceChain}`);
    }); res.status(201).json({ ok: true });
  });
  app.post('/api/crosschain/revenue/verify', async (req, res) => {
    const data = CrosschainInput.parse(req.body); const s = store.read();
    if (!runtime.sources || !runtime.bridge || s.mode !== 'testnet') throw new Error('CCTP_NOT_AVAILABLE');
    const reader = runtime.sources.get(data.sourceChain); if (!reader) throw new Error('SOURCE_CHAIN_NOT_CONFIGURED');
    await reader.verifyIncoming(data.hash, { sender: data.source, recipient: s.policy.sender, amount: data.amount });
    const sourceSnapshot = await reader.snapshot(s.policy.sender);
    const id = store.change(state => {
      if (state.revenues.some(r => r.hash?.toLowerCase() === data.hash.toLowerCase())) throw new Error('REVENUE_ALREADY_IMPORTED');
      const r = { id: randomUUID(), sourceChain: data.sourceChain, source: data.source, amount: data.amount, invoice: data.invoice, cursor: sourceSnapshot.block, createdAt: new Date().toISOString(), receivedHash: data.hash } as const;
      state.crosschainReceivables.push(r);
      state.revenues.push({ id: randomUUID(), hash: data.hash, source: data.source, amount: data.amount, invoice: data.invoice, createdAt: new Date().toISOString(), simulated: false, sourceChain: data.sourceChain, bridged: false });
      event(state, 'CROSSCHAIN_REVENUE_VERIFIED', `${data.invoice}: ${data.hash}`); return r.id;
    });
    res.json(services.scheduler ? {jobId:services.scheduler.wake('RECEIPT_VERIFIED')} : await processVerifiedCrosschainRevenue(runtime,id));
  });
  app.post('/api/bridges/fund', async (req, res) => {
    const { receivableId } = z.object({ receivableId: z.string().uuid() }).strict().parse(req.body);
    if (!runtime.bridge) throw new Error('CCTP_NOT_AVAILABLE');
    res.json(services.scheduler?{jobId:services.scheduler.wake('FUNDING_REQUESTED')}:await runAdaptive(runtime, receivableId));
  });
  app.post('/api/bridges/reconcile', async (_req, res) => {
    if (!runtime.bridge) throw new Error('CCTP_NOT_AVAILABLE');
    if (await runtime.bridge.reconcile()) await evaluateChanges(); res.json({ ok: true });
  });
  app.post('/api/bridges/recover', async (req, res) => {
    const { intentId, burnHash } = z.object({ intentId: z.string().uuid(), burnHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict().parse(req.body);
    if (!runtime.bridge) throw new Error('CCTP_NOT_AVAILABLE');
    await runtime.bridge.recover(intentId, burnHash); res.json({ ok: true });
  });
  app.post('/api/obligations', (req, res) => {
    const input = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/), title: z.string().trim().min(1).max(160), contractor: z.string().trim().min(1).max(100), recipient: Address, amount: z.string().transform(money).refine(a => BigInt(a) > 0n), due: z.iso.datetime() }).strict().parse(req.body);
    store.change(s => {
      if (s.obligations.length >= 200 || s.obligations.some(o => o.id === input.id)) throw new Error('DUPLICATE_OR_TOO_MANY_OBLIGATIONS');
      if (!s.policy.allowlist.includes(input.recipient)) throw new Error('RECIPIENT_BLOCKED');
      s.obligations.push({ ...input, accepted: false, disputed: false, paid: false, version: 1 }); event(s, 'OBLIGATION_CREATED', input.id);if(services.scheduler)enqueue(s,'OWNER_OR_SOURCE_CHANGED',randomUUID());
    }); res.status(201).json({ ok: true });
  });
  app.post('/api/evidence', (req, res) => {
    const input = z.object({ obligationId: z.string(), text: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    store.change(s => {
      if (!s.obligations.some(o => o.id === input.obligationId) || s.evidence.length >= 500) throw new Error('INVALID_EVIDENCE_TARGET');
      s.evidence.push({ ...input, id: randomUUID(), author: 'Owner input — unverified content', createdAt: new Date().toISOString() }); event(s, 'EVIDENCE_ADDED', input.obligationId);if(services.scheduler)enqueue(s,'OWNER_OR_SOURCE_CHANGED',randomUUID());
    }); res.json({ ok: true });
  });
  app.post('/api/evidence-requests/:id/resolve', async (req, res) => {
    if(services.scheduler)throw new Error('USE_ACTION_REQUEST_RESPONSE');
    const input = z.object({ outcome: z.enum(['ACCEPTED', 'DISPUTED']), response: z.string().trim().min(1).max(1200) }).strict().parse(req.body);
    const result = store.change(s => {
      if (s.intents.some(isPending)) return { error: 'RECONCILE_REQUIRED' } as const;
      const request = s.evidenceRequests.find(r => r.id === req.params.id);
      if (!request || request.status !== 'OPEN') return { error: 'EVIDENCE_REQUEST_NOT_OPEN' } as const;
      if (Date.parse(request.expiresAt) <= Date.now()) {
        request.status = 'EXPIRED'; event(s, 'EVIDENCE_REQUEST_EXPIRED', request.id);
        return { error: 'EVIDENCE_REQUEST_EXPIRED' } as const;
      }
      const obligation = s.obligations.find(o => o.id === request.obligationId && !o.paid);
      if (!obligation || obligation.version !== request.obligationVersion) {
        request.status = 'CANCELLED'; event(s, 'EVIDENCE_REQUEST_CANCELLED', request.id);
        return { error: 'EVIDENCE_REQUEST_STALE' } as const;
      }
      request.status = 'RESOLVED'; request.resolution = input.outcome; request.response = input.response; request.resolvedAt = new Date().toISOString();
      obligation.accepted = input.outcome === 'ACCEPTED'; obligation.disputed = input.outcome === 'DISPUTED'; obligation.version++;
      s.evidence.push({ id: randomUUID(), obligationId: obligation.id, text: input.response, author: 'Workspace owner — authoritative resolution', createdAt: request.resolvedAt });
      for (const other of s.evidenceRequests.filter(r => r.id !== request.id && r.obligationId === obligation.id && r.status === 'OPEN')) other.status = 'CANCELLED';
      event(s, 'EVIDENCE_REQUEST_RESOLVED', `${request.id}: ${input.outcome}`);
      return { ok: true } as const;
    });
    if ('error' in result) throw new Error(result.error);
    res.json(await evaluateChanges());
  });
  app.post('/api/acceptance', (req, res) => {
    if(services.scheduler)throw new Error('USE_ACTION_REQUEST_RESPONSE');
    const input = z.object({ obligationId: z.string(), accepted: z.boolean(), disputed: z.boolean() }).strict().parse(req.body);
    store.change(s => {
      if (s.intents.some(isPending)) throw new Error('RECONCILE_REQUIRED');
      const o = s.obligations.find(o => o.id === input.obligationId && !o.paid); if (!o) throw new Error('INVALID_OBLIGATION');
      o.accepted = input.accepted; o.disputed = input.disputed; o.version++;
      for (const request of s.evidenceRequests.filter(r => r.obligationId === o.id && r.status === 'OPEN')) request.status = 'CANCELLED';
      event(s, 'OWNER_ACCEPTANCE_UPDATED', o.id);if(services.scheduler)enqueue(s,'OWNER_OR_SOURCE_CHANGED',randomUUID());
    }); res.json({ ok: true });
  });
  app.post('/api/approval', (req, res) => {
    if(services.scheduler)throw new Error('USE_ACTION_REQUEST_RESPONSE');
    const { obligationId } = z.object({ obligationId: z.string() }).strict().parse(req.body);
    store.change(s => {
      const o = s.obligations.find(o => o.id === obligationId); if (!o || evaluate(s, o) !== 'NEEDS_APPROVAL') throw new Error('APPROVAL_NOT_APPLICABLE');
      s.approvals.push({ id: randomUUID(), obligationId, obligationVersion: o.version, policyVersion: s.policy.version, stateVersion: s.financialVersion, expiresAt: new Date(Date.now() + 60000).toISOString(), actor: 'owner' });
      event(s, 'OWNER_APPROVED', `${o.id}: ${o.amount} micro-USDC → ${o.recipient}`);if(services.scheduler)enqueue(s,'OWNER_OR_SOURCE_CHANGED',randomUUID());
    }); res.json({ ok: true });
  });
  app.post('/api/agent-notifications/:id/resolve', async (req, res) => {
    if(services.scheduler)throw new Error('USE_ACTION_REQUEST_RESPONSE');
    const input = z.object({ decision: z.enum(['APPROVE_ONCE', 'KEEP_POLICY']), response: z.string().trim().min(1).max(1200) }).strict().parse(req.body);
    resolveAgentUserDecision(store, req.params.id, input.decision, input.response);
    res.json(await evaluateChanges());
  });
  app.use(express.static(resolve('dist')));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const code = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'INVALID_REQUEST_OR_UNAVAILABLE_SERVICE';
    res.status(400).json({ error: code });
  });
  return app;
}
