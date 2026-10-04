import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {syncDirectory,parseCsv} from '../src/sources/local-export.ts';
test('a truncated export cannot block a valid file or advance its revision; replay remains idempotent',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tameion-export-'));const store=new Store(':memory:',fixture());
  store.change(s=>{s.autonomy!.sourceDirectory=root;s.autonomy!.sourceAuthority=true;});
  const packet={sourceId:'books',parties:[{id:'vendor',name:'Studio',address:fixture().policy.allowlist[0]}],records:[{externalId:'one',revision:1,kind:'OBLIGATION',partyId:'vendor',title:'Delivery',amount:'0.123456',due:new Date().toISOString(),acceptance:'ACCEPTED'}]};
  try{
    await writeFile(join(root,'valid.json'),JSON.stringify(packet));await writeFile(join(root,'incomplete.json'),'{"records":[');
    await assert.rejects(syncDirectory(store),/SOURCE_RECORDS_QUARANTINED/);assert.equal(store.read().autonomy!.records.length,1);
    await assert.rejects(syncDirectory(store));assert.equal(store.read().autonomy!.records.length,1);assert.equal(store.read().autonomy!.jobs.length,1);
    assert.throws(()=>parseCsv('externalId,revision\n"incomplete,1'),/INCOMPLETE_CSV/);
    assert.throws(()=>parseCsv('active,revision\nperhaps,1'),/INVALID_CSV_BOOLEAN/);
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});
