import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { stressScenarios } from './scenarios.ts';
import type { State } from '../domain.ts';
import { readAuditJournal } from './journal.ts';

export interface StressAuditStatus {
  id: string; status: 'RUNNING' | 'COMPLETED' | 'ATTENTION'; evaluated: number; total: number;
  currentScenario?: string; currentName?: string; latestOutcome?: string; verifiedPayouts: number;
  unresolvedIntents: number; telegramSent: number; telegramFailures: number; updatedAt: string;
}

export function readStressAuditStatus(root = resolve('data','stress-50')): StressAuditStatus | undefined {
  if (!existsSync(root)) return undefined;
  const id = readdirSync(root, { withFileTypes: true })
    .filter(item => item.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(item.name) && existsSync(resolve(root,item.name,'stress.db')))
    .map(item => item.name).sort().at(-1);
  if (!id) return undefined;
  const directory = resolve(root,id), database = resolve(directory,'stress.db');
  if (!existsSync(database)) return undefined;
  const db = new DatabaseSync(database, { readOnly: true });
  let state: State;
  try { state = JSON.parse((db.prepare('SELECT body FROM state WHERE id=1').get() as { body:string }).body) as State; }
  finally { db.close(); }
  const latest = state.runs.at(-1);
  const currentScenario = latest?.decisions[0]?.obligationId.split('-')[0] ?? state.obligations[0]?.id.split('-')[0];
  const currentName = stressScenarios.find(item => item.id === currentScenario)?.name;
  const latestOutcome = latest?.status === 'AWAITING_USER' ? 'AWAITING_USER' : latest?.decisions.map(item => item.review ? `${item.action}/JEV_${item.review.verdict}` : item.action).join(',') || latest?.status;
  const summaryPath = resolve(directory,'summary.json');
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath,'utf8')) as { scenarioCount:number; errors:number; failures:number; onchainTransactions:number } : undefined;
  const journalCount = summary ? 0 : readAuditJournal(resolve(directory,'events.jsonl')).results.length;
  const completedRuns = state.runs.filter(run => run.status !== 'RUNNING').length;
  return {
    id, status: summary ? summary.errors || summary.failures ? 'ATTENTION' : 'COMPLETED' : 'RUNNING',
    evaluated: summary?.scenarioCount ?? (journalCount || completedRuns), total: stressScenarios.length,
    currentScenario, currentName, latestOutcome,
    verifiedPayouts: summary?.onchainTransactions ?? state.intents.filter(item => item.status === 'SETTLED').length,
    unresolvedIntents: state.intents.filter(item => ['PREPARED','SUBMITTING','PROVIDER_ACCEPTED','HASH_OBSERVED','EXECUTION_UNKNOWN'].includes(item.status)).length,
    telegramSent: (state.telegramDeliveries ?? []).filter(item => item.sendCount > 0).length,
    telegramFailures: (state.telegramDeliveries ?? []).reduce((sum,item) => sum + item.failureCount,0),
    updatedAt: statSync(database).mtime.toISOString(),
  };
}
