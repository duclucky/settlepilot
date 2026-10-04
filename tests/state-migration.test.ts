import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';

test('observation-only refresh preserves authority version while changed liquidity invalidates it', () => {
  const store = new Store(':memory:', fixture());
  const before = store.read().financialVersion;
  store.change(s => { s.snapshot.block = 'next-block'; s.snapshot.observedAt = new Date().toISOString(); });
  assert.equal(store.read().financialVersion, before);
  store.change(s => { s.snapshot.balance = '7000000'; });
  assert.equal(store.read().financialVersion, before + 1);
  store.close();
});
