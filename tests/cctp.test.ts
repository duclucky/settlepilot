import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, money, type Decision } from '../src/domain.ts';
import { CctpBridge, calculateBridgeQuote, fundingDeficit, fundingDeficitForDecisions, selectFundingBalances, validateBridgeStatus } from '../src/cctp.ts';
import { Store } from '../src/store.ts';

test('CCTP V2 quote keeps recipient amount exact and adds protocol plus forwarding fees', () => {
  assert.deepEqual(calculateBridgeQuote(money('4'), 1.3, '22976'), { fee: '23496', totalBurn: '4023496' });
});

test('reconciliation accepts variable forwarding fee only within the bound authority and never resends', async () => {
  const s=fixture(); s.bridgePolicy.enabled=true; s.bridgePolicy.maxFee='100000';
  const burn=`0x${'a'.repeat(64)}`,mint=`0x${'b'.repeat(64)}`;
  s.bridgeIntents=[{id:'existing',sourceChain:'BASE-SEPOLIA',destinationChain:'ARC-TESTNET',sourceWallet:s.policy.sender,recipient:s.policy.sender,amount:'45001',fee:'19135',totalBurn:'64136',policyVersion:s.bridgePolicy.version,idempotencyKey:'existing',status:'EXECUTION_UNKNOWN',createdAt:new Date().toISOString(),burnHash:burn,mintHash:mint}];
  const store=new Store(':memory:',s);let calls=0,burnAmount='';
  const cli=async(args:string[])=>{assert.equal(args[1],'status');calls++;return {data:{status:'complete',cctpVersion:2,sourceDomain:'6',destinationDomain:'26',amount:'64652',mintRecipient:s.policy.sender,burnToken:'0x036cbd53842c5426634e7929541ec2318f3dcf7e',forwardTxHash:mint}};};
  const bridge=new CctpBridge(store,new Map([['BASE-SEPOLIA',{verifyWalletOutflow:async(_h:string,_w:string,a:string)=>{burnAmount=a;}} as never]]),{verifyCctpMint:async()=>{},snapshot:async()=>s.snapshot} as never,cli,{enabled:true});
  assert.equal(await bridge.reconcile(),true);assert.equal(store.read().bridgeIntents[0].status,'SETTLED');
  assert.equal(store.read().bridgeIntents[0].actualFee,'19651');assert.equal(burnAmount,'64652');assert.equal(calls,1);
  store.close();
});

test('legacy bridge cannot use a changed policy to enlarge its fee authority', async () => {
  const s=fixture(); s.bridgePolicy.version=2; s.bridgePolicy.maxFee='100000';
  s.bridgeIntents=[{id:'existing',sourceChain:'BASE-SEPOLIA',destinationChain:'ARC-TESTNET',sourceWallet:s.policy.sender,recipient:s.policy.sender,amount:'45001',fee:'19135',totalBurn:'64136',policyVersion:1,idempotencyKey:'existing',status:'EXECUTION_UNKNOWN',createdAt:new Date().toISOString(),burnHash:`0x${'a'.repeat(64)}`}];
  const store=new Store(':memory:',s);let proofs=0;
  const bridge=new CctpBridge(store,new Map([['BASE-SEPOLIA',{verifyWalletOutflow:async()=>{proofs++;}} as never]]),{} as never,async()=>({data:{status:'complete',cctpVersion:2,sourceDomain:6,destinationDomain:26,amount:'64652',mintRecipient:s.policy.sender,burnToken:'0x036cbd53842c5426634e7929541ec2318f3dcf7e',forwardTxHash:`0x${'b'.repeat(64)}`}}),{enabled:true});
  assert.equal(await bridge.reconcile(),false);assert.equal(proofs,0);assert.equal(store.read().bridgeIntents[0].status,'EXECUTION_UNKNOWN');store.close();
});

test('persisted bridge fee cap survives policy changes and rejects a fee above the original cap', async () => {
  for(const [actualBurn,expected] of [['64652',true],['65002',false]] as const){
    const s=fixture();s.bridgePolicy.version=2;s.bridgePolicy.maxFee='100000';
    s.bridgeIntents=[{id:'existing',sourceChain:'BASE-SEPOLIA',destinationChain:'ARC-TESTNET',sourceWallet:s.policy.sender,recipient:s.policy.sender,amount:'45001',fee:'19135',totalBurn:'64136',feeLimit:'20000',policyVersion:1,idempotencyKey:'existing',status:'EXECUTION_UNKNOWN',createdAt:new Date().toISOString(),burnHash:`0x${'a'.repeat(64)}`}];
    const store=new Store(':memory:',s);let proofs=0;
    const bridge=new CctpBridge(store,new Map([['BASE-SEPOLIA',{verifyWalletOutflow:async()=>{proofs++;}} as never]]),{verifyCctpMint:async()=>{},snapshot:async()=>s.snapshot} as never,async()=>({data:{status:'complete',cctpVersion:2,sourceDomain:6,destinationDomain:26,amount:actualBurn,mintRecipient:s.policy.sender,burnToken:'0x036cbd53842c5426634e7929541ec2318f3dcf7e',forwardTxHash:`0x${'b'.repeat(64)}`}}),{enabled:true});
    assert.equal(await bridge.reconcile(),expected);assert.equal(proofs,expected?1:0);store.close();
  }
});

test('bridge funding covers only eligible Arc shortfall and never counts source funds as Arc funds', () => {
  const state = fixture();
  state.snapshot.balance = money('5');
  state.policy.reserve = money('2');
  state.policy.gasLimit = money('1');
  state.obligations = [state.obligations[0]];
  assert.equal(fundingDeficit(state), money('2'));
  state.obligations[0].accepted = false;
  assert.equal(fundingDeficit(state), '0');
});

test('adaptive funding derives the exact gap only from LLM-selected PAY_NOW obligations', () => {
  const state = fixture();
  state.snapshot.balance = money('3.125'); state.policy.reserve = money('0.75'); state.policy.gasLimit = money('0.125');
  state.policy.perObligation = money('20'); state.policy.totalBudget = money('20');
  state.bridgePolicy.enabled = true;
  state.crosschainBalances.push({ sourceChain: 'MATIC-AMOY', balance: money('8'), chainId: 80002, block: '1', observedAt: new Date().toISOString(), status: 'VERIFIED' });
  state.obligations[0].amount = money('2.345678'); state.obligations[1].amount = money('5.432101');
  const decisions: Decision[] = [
    { obligationId: 'A', action: 'HOLD', reason: 'Defer this accepted item.', evidenceIds: ['e-a'] },
    { obligationId: 'B', action: 'PAY_NOW', reason: 'Selected from the current priorities.', evidenceIds: [] },
    { obligationId: 'C', action: 'REQUEST_EVIDENCE', reason: 'Acceptance is unresolved.', evidenceIds: ['e-c'] },
  ];
  assert.equal(fundingDeficitForDecisions(state, decisions), money('3.182101'));
  state.snapshot.balance = money('20');
  assert.equal(fundingDeficitForDecisions(state, decisions), '0');
});

test('funding source selection adapts to available capacity and chain allowlist', () => {
  const state = fixture(); state.bridgePolicy.enabled = true; state.bridgePolicy.sourceChains = ['OP-SEPOLIA', 'UNI-SEPOLIA'];
  const now = new Date().toISOString();
  state.crosschainBalances = [
    { sourceChain: 'OP-SEPOLIA', balance: money('2.2'), chainId: 11155420, block: '1', observedAt: now, status: 'VERIFIED' },
    { sourceChain: 'UNI-SEPOLIA', balance: money('8.75'), chainId: 1301, block: '2', observedAt: now, status: 'VERIFIED' },
    { sourceChain: 'BASE-SEPOLIA', balance: money('50'), chainId: 84532, block: '3', observedAt: now, status: 'VERIFIED' },
  ];
  assert.deepEqual(selectFundingBalances(state).map(item => item.sourceChain), ['UNI-SEPOLIA', 'OP-SEPOLIA']);
});

test('CCTP status accepts Circle JSON string domains and binds V2 Base domain 6, Arc domain 26 and exact recipient', () => {
  const recipient = fixture().policy.sender;
  const valid = { status: 'complete', cctpVersion: 2, sourceDomain: '6', destinationDomain: '26', mintRecipient: `0x${'0'.repeat(24)}${recipient.slice(2)}`, forwardTxHash: `0x${'a'.repeat(64)}` };
  assert.equal(validateBridgeStatus(valid, recipient, 'BASE-SEPOLIA'), valid.forwardTxHash);
  for (const patch of [{ cctpVersion: 1 }, { sourceDomain: 0 }, { destinationDomain: 0 }, { mintRecipient: `0x${'0'.repeat(64)}` }, { forwardTxHash: undefined }]) {
    assert.throws(() => validateBridgeStatus({ ...valid, ...patch }, recipient, 'BASE-SEPOLIA'));
  }
});

test('multichain CCTP intent dispatches once and settles only after source burn plus Arc mint proofs', async () => {
  const s = fixture(); s.snapshot.balance = money('5'); s.policy.reserve = money('2'); s.policy.gasLimit = money('1'); s.obligations = [s.obligations[0]];
  s.bridgePolicy.enabled = true; s.crosschainReceivables.push({ id: 'r', sourceChain: 'ARB-SEPOLIA', source: `0x${'9'.repeat(40)}`, amount: money('3'), invoice: 'INV-X', cursor: '1', createdAt: new Date().toISOString(), receivedHash: `0x${'1'.repeat(64)}` });
  s.crosschainBalances.push({ sourceChain: 'ARB-SEPOLIA', balance: money('3'), chainId: 421614, block: '2', observedAt: new Date().toISOString(), status: 'VERIFIED' });
  const store = new Store(':memory:', s); const burn = `0x${'a'.repeat(64)}`, mint = `0x${'b'.repeat(64)}`; const calls: string[][] = []; let burnProofs = 0, mintProofs = 0;
  let verifiedBurnAmount = '';
  const source = { snapshot: async () => ({ balance: money('3'), chainId: 421614, block: '2', observedAt: new Date().toISOString() }), verifyWalletOutflow: async (_hash: string, _wallet: string, amount: string) => { burnProofs++; verifiedBurnAmount = amount; } };
  const arc = { snapshot: async () => ({ balance: money('7'), chainId: 5042002, block: '3', observedAt: new Date().toISOString() }), verifyCctpMint: async () => { mintProofs++; } };
  const cli = async (args: string[]) => { calls.push(args);
    if (args[0] === 'wallet') return { data: { wallets: [{ type: 'agent', blockchain: 'ARB-SEPOLIA', address: s.policy.sender }] } };
    if (args[1] === 'get-fee') return { data: { fromChain: 'ARB-SEPOLIA', toChain: 'ARC-TESTNET', fees: [{ finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { med: 22976 } }] } };
    if (args[1] === 'transfer') return { data: { fromChain: 'ARB-SEPOLIA', toChain: 'ARC-TESTNET', amount: '2.000000', status: 'pending', burnTxHash: burn } };
    return { data: { status: 'complete', cctpVersion: 2, sourceDomain: 3, destinationDomain: 26, amount: '2023000', mintRecipient: `0x${'0'.repeat(24)}${s.policy.sender.slice(2)}`, burnToken: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', forwardTxHash: mint } };
  };
  const bridge = new CctpBridge(store, new Map([['ARB-SEPOLIA', source as never]]), arc as never, cli, { enabled: true, responseTimeoutMs: 50 });
  const runId = 'adaptive-plan';
  store.change(state => state.runs.push({ id: runId, createdAt: new Date().toISOString(), source: 'LLM fixture', status: 'DONE', executionStatus: 'PLANNED', financialVersion: state.financialVersion, policyVersion: state.policy.version, decisions: [{ obligationId: 'A', action: 'PAY_NOW', reason: 'Current priority selected by the planner.', evidenceIds: ['e-a'], fundingSourceChain: 'ARB-SEPOLIA' }] }));
  await bridge.fundFromInventory(runId);
  const intent = store.read().bridgeIntents[0];
  assert.equal(intent.status, 'SETTLED'); assert.equal(intent.amount, money('2')); assert.equal(intent.burnHash, burn); assert.equal(intent.mintHash, mint);
  assert.equal(intent.receivableId, undefined); assert.equal(intent.runId, runId);
  assert.equal(intent.actualBurn, '2023000'); assert.equal(intent.actualFee, '23000'); assert.equal(verifiedBurnAmount, '2023000');
  assert.equal(calls.filter(x => x[1] === 'transfer').length, 1); assert.equal(burnProofs, 1); assert.equal(mintProofs, 1);
  assert.equal(await bridge.fund('r'), undefined); assert.equal(calls.filter(x => x[1] === 'transfer').length, 1); store.close();
});

test('inventory funding bridges a safe partial amount when no single chain can cover the full Arc deficit', async () => {
  const s = fixture(); s.snapshot.balance = money('5'); s.policy.reserve = money('2'); s.policy.gasLimit = money('1'); s.obligations = [s.obligations[0]];
  s.bridgePolicy.enabled = true;
  s.crosschainBalances.push({ sourceChain: 'OP-SEPOLIA', balance: money('1'), chainId: 11155420, block: '8', observedAt: new Date().toISOString(), status: 'VERIFIED' });
  const store = new Store(':memory:', s); const burn = `0x${'c'.repeat(64)}`; const transfers: string[][] = [];
  const source = { snapshot: async () => ({ balance: money('1'), chainId: 11155420, block: '8', observedAt: new Date().toISOString() }), verifyWalletOutflow: async () => undefined };
  const arc = { snapshot: async () => s.snapshot, verifyCctpMint: async () => undefined };
  const cli = async (args: string[]) => {
    if (args[0] === 'wallet') return { data: { wallets: [{ type: 'agent', blockchain: 'OP-SEPOLIA', address: s.policy.sender }] } };
    if (args[1] === 'get-fee') return { data: { fromChain: 'OP-SEPOLIA', toChain: 'ARC-TESTNET', fees: [{ finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { med: 22976 } }] } };
    if (args[1] === 'transfer') { transfers.push(args); return { data: { fromChain: 'OP-SEPOLIA', toChain: 'ARC-TESTNET', amount: args[args.indexOf('--amount') + 1], status: 'pending', burnTxHash: burn } }; }
    return { data: { status: 'pending', cctpVersion: 2, sourceDomain: 2, destinationDomain: 26, amount: '0', mintRecipient: s.policy.sender, burnToken: '0x5fd84259d66cd46123540766be93dfe6d43130d7', forwardTxHash: null } };
  };
  const bridge = new CctpBridge(store, new Map([['OP-SEPOLIA', source as never]]), arc as never, cli, { enabled: true, responseTimeoutMs: 50 });
  const runId = 'partial-plan';
  store.change(state => state.runs.push({ id: runId, createdAt: new Date().toISOString(), source: 'LLM fixture', status: 'DONE', executionStatus: 'PLANNED', financialVersion: state.financialVersion, policyVersion: state.policy.version, decisions: [{ obligationId: 'A', action: 'PAY_NOW', reason: 'Fund the current shortfall.', evidenceIds: ['e-a'], fundingSourceChain: 'OP-SEPOLIA' }] }));
  await bridge.fundFromInventory(runId);
  const intent = store.read().bridgeIntents[0];
  assert.ok(BigInt(intent.amount) > 0n && BigInt(intent.amount) < BigInt(money('2')));
  assert.ok(BigInt(intent.totalBurn) <= BigInt(money('1')));
  assert.equal(intent.status, 'BURN_OBSERVED'); assert.equal(transfers.length, 1);
  store.close();
});

test('CCTP executes only the source chain selected by the LLM even when another chain has more balance', async () => {
  const s = fixture(); s.snapshot.balance = money('5'); s.policy.reserve = money('2'); s.policy.gasLimit = money('1'); s.obligations = [s.obligations[0]]; s.bridgePolicy.enabled = true;
  const now = new Date().toISOString();
  s.crosschainBalances = [
    { sourceChain: 'ARB-SEPOLIA', balance: money('3'), chainId: 421614, block: '2', observedAt: now, status: 'VERIFIED' },
    { sourceChain: 'BASE-SEPOLIA', balance: money('20'), chainId: 84532, block: '3', observedAt: now, status: 'VERIFIED' },
  ];
  const store = new Store(':memory:', s); const burn = `0x${'d'.repeat(64)}`; const usedChains: string[] = [];
  const reader = (chainId: number, balance: string) => ({ snapshot: async () => ({ balance, chainId, block: '4', observedAt: new Date().toISOString() }), verifyWalletOutflow: async () => undefined });
  const cli = async (args: string[]) => {
    const chain = args[args.indexOf('--chain') + 1];
    if (args[0] === 'wallet') return { data: { wallets: [{ type: 'agent', blockchain: chain, address: s.policy.sender }] } };
    if (args[1] === 'get-fee') return { data: { fromChain: chain, toChain: 'ARC-TESTNET', fees: [{ finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { med: 22976 } }] } };
    if (args[1] === 'transfer') { usedChains.push(chain); return { data: { fromChain: chain, toChain: 'ARC-TESTNET', amount: args[args.indexOf('--amount') + 1], status: 'pending', burnTxHash: burn } }; }
    return { data: { status: 'pending', cctpVersion: 2, sourceDomain: 3, destinationDomain: 26, amount: '0', mintRecipient: s.policy.sender, burnToken: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', forwardTxHash: null } };
  };
  const bridge = new CctpBridge(store, new Map([
    ['ARB-SEPOLIA', reader(421614, money('3')) as never],
    ['BASE-SEPOLIA', reader(84532, money('20')) as never],
  ]), { snapshot: async () => s.snapshot, verifyCctpMint: async () => undefined } as never, cli, { enabled: true, responseTimeoutMs: 50 });
  const runId = 'llm-source-plan';
  store.change(state => state.runs.push({ id: runId, createdAt: now, source: 'LLM fixture', status: 'DONE', executionStatus: 'PLANNED', financialVersion: state.financialVersion, policyVersion: state.policy.version, decisions: [{ obligationId: 'A', action: 'PAY_NOW', reason: 'Use Arbitrum.', evidenceIds: ['e-a'], fundingSourceChain: 'ARB-SEPOLIA' }] }));
  await bridge.fundFromInventory(runId);
  assert.equal(store.read().bridgeIntents[0].sourceChain, 'ARB-SEPOLIA');
  assert.deepEqual(usedChains, ['ARB-SEPOLIA']);
  store.close();
});

test('failed LLM-selected source is observed as unavailable and backend does not fallback', async () => {
  const s = fixture(); s.snapshot.balance = money('5'); s.policy.reserve = money('2'); s.policy.gasLimit = money('1'); s.obligations = [s.obligations[0]]; s.bridgePolicy.enabled = true;
  const now = new Date().toISOString();
  s.crosschainBalances = [
    { sourceChain: 'ARB-SEPOLIA', balance: money('3'), chainId: 421614, block: '2', observedAt: now, status: 'VERIFIED' },
    { sourceChain: 'BASE-SEPOLIA', balance: money('20'), chainId: 84532, block: '3', observedAt: now, status: 'VERIFIED' },
  ];
  const store = new Store(':memory:', s); let transfers = 0;
  const cli = async (args: string[]) => {
    if (args[0] === 'wallet') return { data: { wallets: [{ type: 'agent', blockchain: 'ARB-SEPOLIA', address: s.policy.sender }] } };
    if (args[1] === 'transfer') transfers++;
    throw new Error('SOURCE_FAILED');
  };
  const bridge = new CctpBridge(store, new Map([
    ['ARB-SEPOLIA', { snapshot: async () => { throw new Error('RPC_DOWN'); } } as never],
    ['BASE-SEPOLIA', { snapshot: async () => ({ balance: money('20'), chainId: 84532, block: '4', observedAt: now }) } as never],
  ]), {} as never, cli, { enabled: true });
  const runId = 'failed-source-plan';
  store.change(state => state.runs.push({ id: runId, createdAt: now, source: 'LLM fixture', status: 'DONE', executionStatus: 'PLANNED', financialVersion: state.financialVersion, policyVersion: state.policy.version, decisions: [{ obligationId: 'A', action: 'PAY_NOW', reason: 'Use Arbitrum.', evidenceIds: ['e-a'], fundingSourceChain: 'ARB-SEPOLIA' }] }));
  assert.equal(await bridge.fundFromInventory(runId), undefined);
  assert.equal(transfers, 0);
  assert.equal(store.read().crosschainBalances.find(item => item.sourceChain === 'ARB-SEPOLIA')?.status, 'UNAVAILABLE');
  assert.equal(store.read().crosschainBalances.find(item => item.sourceChain === 'BASE-SEPOLIA')?.status, 'VERIFIED');
  store.close();
});
