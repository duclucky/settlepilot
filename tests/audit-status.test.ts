import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { readStressAuditStatus } from '../src/audit/status.ts';

test('localhost reads safe live progress from the newest isolated stress database', () => {
  const root=mkdtempSync(join(tmpdir(),'tameion-audit-status-'));
  const id='2026-09-29T02-17-32-871Z', directory=join(root,id); mkdirSync(directory);
  mkdirSync(join(root,'2026-09-29T02-41-36-277Z')); // Interrupted before the database was created.
  const state=fixture(); state.mode='testnet'; state.runs=[{id:'run',createdAt:new Date().toISOString(),source:'AI',status:'DONE',executionStatus:'EXECUTED',decisions:[{obligationId:'S01-A',action:'HOLD',reason:'Insufficient liquidity',evidenceIds:[]}]}];
  state.obligations=[{...state.obligations[0],id:'S01-A'}]; state.telegramDeliveries=[{id:'notice',fingerprint:'audit:start',kind:'AUDIT_STARTED',subjectId:id,severity:'NORMAL',status:'DELIVERED',repeat:false,createdAt:new Date().toISOString(),lastSentAt:new Date().toISOString(),lastSentSeverity:'NORMAL',sendCount:1,failureCount:0}];
  const store=new Store(join(directory,'stress.db'),state); store.close();
  try {
    const status=readStressAuditStatus(root)!;
    assert.deepEqual({id:status.id,status:status.status,evaluated:status.evaluated,total:status.total,currentScenario:status.currentScenario,currentName:status.currentName,latestOutcome:status.latestOutcome,telegramSent:status.telegramSent},{id,status:'RUNNING',evaluated:1,total:50,currentScenario:'S01',currentName:'Single overdue invoice',latestOutcome:'HOLD',telegramSent:1});
    assert.equal(JSON.stringify(status).includes('0x'),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
