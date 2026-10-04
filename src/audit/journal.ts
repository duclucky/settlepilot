import { existsSync, readFileSync } from 'node:fs';

export interface AuditJournalResult {
  id: string;
  status: 'PASS' | 'FAIL' | 'ERROR';
  [key: string]: unknown;
}

export function readAuditJournal(path: string): { results: AuditJournalResult[]; startingBalanceUnits?: string } {
  if (!existsSync(path)) return { results: [] };
  const results = new Map<string, AuditJournalResult>();
  let startingBalanceUnits: string | undefined;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
      if (entry.type === 'SUITE_STARTED' && typeof entry.data?.balanceUnits === 'string') startingBalanceUnits ??= entry.data.balanceUnits;
      if ((entry.type === 'SCENARIO_FINISHED' || entry.type === 'SCENARIO_ERROR') && typeof entry.data?.id === 'string' && ['PASS','FAIL','ERROR'].includes(String(entry.data.status))) {
        results.set(entry.data.id, entry.data as AuditJournalResult);
      }
    } catch { /* A truncated final line is ignored so a killed audit remains resumable. */ }
  }
  return { results: [...results.values()], startingBalanceUnits };
}
