import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isPending, isBridgePending, money, SOURCE_CHAIN_NAMES, type State } from './domain.ts';
import { emptyAutonomy } from './autonomy-types.ts';
import type {ModelRequestRecord} from './model-requests.ts';

// A single aggregate is intentional for one business and a bounded local pilot.
// BEGIN IMMEDIATE serializes writers across connections, not only JS requests.
export class Store {
  private db: DatabaseSync;
  constructor(path: string, initial: State) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS wallet_binding (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS model_request_archive (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS model_archive_run ON model_request_archive(run_id);');
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (1, ?)').run(JSON.stringify(initial));
    if (this.read().mode !== initial.mode) throw new Error('DATABASE_MODE_MISMATCH');
  }
  bindWallet(identity: string) {
    this.db.prepare('INSERT OR IGNORE INTO wallet_binding VALUES (1, ?)').run(identity);
    if ((this.db.prepare('SELECT identity FROM wallet_binding WHERE id=1').get() as { identity: string }).identity !== identity) throw new Error('DATABASE_WALLET_PROVIDER_MISMATCH');
  }
  read(): State {
    const state = JSON.parse((this.db.prepare('SELECT body FROM state WHERE id=1').get() as { body: string }).body) as State;
    state.receivables ??= []; // Additive upgrade from the first local schema.
    state.bridgePolicy ??= { version: 1, enabled: false, sourceChains: [...SOURCE_CHAIN_NAMES], maxAmount: money('25'), maxFee: money('1') };
    state.crosschainBalances ??= [];
    state.crosschainReceivables ??= [];
    state.bridgeIntents ??= [];
    state.evidenceRequests ??= [];
    state.fundingEvaluations ??= [];
    state.agentMemory ??= [];
    state.agentToolCalls ??= [];
    state.agentNotifications ??= [];
    state.telegramDeliveries ??= [];
    if(state.autonomy&&state.autonomy.schemaVersion!==1)throw new Error('UNSUPPORTED_AUTONOMY_SCHEMA');
    state.autonomy = {...emptyAutonomy(),...state.autonomy};
    return state;
  }
  change<T>(operation: (state: State) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      const finance = (s: State) => JSON.stringify([s.policy, s.bridgePolicy, s.paused, s.snapshot.balance, s.snapshot.chainId, s.obligations, s.evidence, s.crosschainBalances.map(b => [b.sourceChain, b.balance, b.status, b.chainId, b.fundingEnabled !== false]), s.crosschainReceivables, s.bridgeIntents]);
      const before = finance(state); const result = operation(state);
      const pending = state.intents.filter(isPending);
      if (pending.length > 1) throw new Error('WALLET_ALREADY_RESERVED');
      if (state.bridgeIntents.filter(isBridgePending).length > 1) throw new Error('BRIDGE_ALREADY_RESERVED');
      if (new Set(state.intents.map(i => i.idempotencyKey)).size !== state.intents.length) throw new Error('DUPLICATE_INTENT_KEY');
      if (new Set(state.telegramDeliveries.map(item => item.fingerprint)).size !== state.telegramDeliveries.length) throw new Error('DUPLICATE_TELEGRAM_NOTIFICATION');
      const hashes = state.intents.flatMap(i => i.hash ? [i.hash.toLowerCase()] : []);
      const bridgeHashes = state.bridgeIntents.flatMap(i => [i.burnHash, i.mintHash].filter((h): h is string => !!h).map(h => h.toLowerCase()));
      if (new Set([...hashes, ...bridgeHashes]).size !== hashes.length + bridgeHashes.length) throw new Error('TRANSACTION_ALREADY_USED');
      if (finance(state) !== before) state.financialVersion++;
      state.version++;
      this.db.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  // Invoked within change(): archive inserts and live-ledger removal commit together.
  archiveModelRequests(records: ModelRequestRecord[]) {
    if(!this.db.isTransaction)throw new Error('ARCHIVE_REQUIRES_TRANSACTION');
    const insert=this.db.prepare('INSERT INTO model_request_archive (id,run_id,body) VALUES (?,?,?)');
    for(const record of records)insert.run(record.id,record.runId,JSON.stringify(record));
  }
  archivedModelRunUsage(runId: string) {
    return this.db.prepare(`SELECT COUNT(*) AS requests,
      COALESCE(SUM(COALESCE(json_extract(body,'$.usage.inputTokens')+json_extract(body,'$.usage.outputTokens'),json_extract(body,'$.reservedTokens'))),0) AS tokens,
      COALESCE(SUM(COALESCE(json_extract(body,'$.estimatedCostNanoUsd'),json_extract(body,'$.reservedCostNanoUsd'),0)),0) AS cost
      FROM model_request_archive WHERE run_id=?`).get(runId) as {requests:number;tokens:number;cost:number};
  }
  modelArchive(after=0,limit=100) {
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('INVALID_ARCHIVE_PAGE');
    const rows=this.db.prepare('SELECT seq,body FROM model_request_archive WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit) as {seq:number;body:string}[];
    const count=(this.db.prepare('SELECT COUNT(*) AS count FROM model_request_archive').get() as {count:number}).count;
    return {count,records:rows.map(row=>JSON.parse(row.body) as ModelRequestRecord),nextCursor:rows.at(-1)?.seq??after};
  }
  close() { this.db.close(); }
}
export function event(state: State, type: string, detail: string) {
  state.events.push({ id: randomUUID(), at: new Date().toISOString(), type, detail });
}
