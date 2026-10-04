import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLiquidity } from '../src/liquidity-analysis.ts';
import { fixture, money, type SourceChain } from '../src/domain.ts';
import { emptyAutonomy } from '../src/autonomy-types.ts';

test('deadline analysis counts reserve once, gas per obligation and never treats invoices as spendable cash',()=>{
  const s=fixture(),now=Date.now();s.snapshot.observedAt=new Date(now).toISOString();
  s.obligations[0].due=new Date(now-1).toISOString();s.obligations[2].due=new Date(now+1000).toISOString();
  s.autonomy=emptyAutonomy();s.autonomy.records=[{sourceId:'books',externalId:'revenue',revision:1,hash:'test',kind:'RECEIVABLE',partyId:'buyer',title:'Expected',amount:money('100'),due:new Date(now).toISOString(),acceptance:'UNKNOWN',evidence:'',active:true,authoritative:true,importedAt:new Date(now).toISOString()}];
  const original=JSON.stringify(s),result=analyzeLiquidity(s,now);
  assert.equal(result.horizons[0].principalUnits,money('4'));
  assert.equal(result.horizons[1].principalUnits,money('6'));
  assert.equal(result.horizons[1].gasCeilingUnits,money('2'));
  assert.equal(result.horizons[1].arcShortfallUnits,money('7'));
  assert.equal(result.horizons[1].acceptedCount,1);
  assert.equal(result.expectedReceipts[0].outstandingUnits,money('100'));
  assert.equal(result.expectedReceiptsIncludedInCash,false);
  assert.equal(JSON.stringify(s),original);
});

test('source capacity is conditional, fee-adjusted and excludes stale, disabled or wrong-chain observations',()=>{
  const s=fixture(),now=Date.now();s.bridgePolicy.enabled=true;s.bridgePolicy.maxAmount=money('2');s.bridgePolicy.maxFee=money('0.1');
  s.crosschainBalances=[['BASE-SEPOLIA',84532,true,0],['AVAX-FUJI',43113,false,0],['OP-SEPOLIA',11155420,true,31000],['ARB-SEPOLIA',1,true,0]].map(([chain,id,enabled,delay])=>({sourceChain:chain as SourceChain,chainId:id as number,fundingEnabled:enabled as boolean,balance:money('10'),status:'VERIFIED',block:'1',observedAt:new Date(now-Number(delay)).toISOString()}));
  let result=analyzeLiquidity(s,now);
  assert.equal(result.conditionalMintOneBridgePerSourceUnits,money('2'));
  assert.equal(result.sources.length,2);
  s.crosschainBalances[0].balance=money('0.09');result=analyzeLiquidity(s,now);
  assert.equal(result.conditionalMintOneBridgePerSourceUnits,'0');
  assert.equal(result.costsAreProviderQuotes,false);
  s.snapshot.observedAt=new Date(now-31000).toISOString();result=analyzeLiquidity(s,now);
  assert.equal(result.arc.afterReserveUnits,null);assert.equal(result.horizons[0].arcShortfallUnits,null);
});

test('settled and archived obligations disappear, but disputed and pending obligations remain liabilities',()=>{
  const s=fixture(),now=Date.now();s.obligations[0].paid=true;s.obligations[1].archived=true;
  s.obligations[2].due=new Date(now).toISOString();
  const result=analyzeLiquidity(s,now);
  assert.equal(result.horizons[3].principalUnits,money('2'));assert.equal(result.obligations[0].policyResult,'NEEDS_EVIDENCE');
});

test('one micro-USDC and large values remain exact with changed reserve and liquidity',()=>{
  const s=fixture();s.obligations=[s.obligations[0]];s.obligations[0].amount='9007199254740993';s.policy.reserve='1';s.policy.gasLimit='1';s.snapshot.balance='9007199254740994';
  assert.equal(analyzeLiquidity(s).obligations[0].gapToPayOnArcUnits,'1');
  s.snapshot.balance='9007199254740995';assert.equal(analyzeLiquidity(s).obligations[0].gapToPayOnArcUnits,'0');
});
