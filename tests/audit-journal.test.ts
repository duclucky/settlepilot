import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAuditJournal } from '../src/audit/journal.ts';

test('audit journal recovers completed scenarios and ignores an interrupted final line', () => {
  const directory=mkdtempSync(join(tmpdir(),'tameion-audit-journal-'));
  const path=join(directory,'events.jsonl');
  writeFileSync(path,[
    JSON.stringify({type:'SUITE_STARTED',data:{balanceUnits:'274999'}}),
    JSON.stringify({type:'SCENARIO_FINISHED',data:{id:'S01',status:'PASS',outcome:'HOLD'}}),
    JSON.stringify({type:'SCENARIO_ERROR',data:{id:'S02',status:'ERROR',outcome:'SCENARIO_ERROR'}}),
    '{"type":"PROVIDER_RESPONSE"',
  ].join('\n'));
  try {
    assert.deepEqual(readAuditJournal(path),{
      startingBalanceUnits:'274999',
      results:[{id:'S01',status:'PASS',outcome:'HOLD'},{id:'S02',status:'ERROR',outcome:'SCENARIO_ERROR'}],
    });
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
