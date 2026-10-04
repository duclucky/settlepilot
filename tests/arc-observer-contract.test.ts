import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,parseAbiItem,type PublicClient} from 'viem';
import {rpcObserver} from '../src/chain-observer.ts';
import {fixture,USDC} from '../src/domain.ts';
test('Arc emitter pairing preserves two equal transfers in one transaction without counting their native twins',async()=>{
  const state=fixture(),sender=state.policy.allowlist[0] as `0x${string}`,wallet=state.policy.sender as `0x${string}`;
  const hash=`0x${'a'.repeat(64)}` as const,blockHash=`0x${'b'.repeat(64)}` as const;
  const transfer=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
  const topics=encodeEventTopics({abi:[transfer],eventName:'Transfer',args:{from:sender,to:wallet}});
  const log=(address:string,units:bigint,logIndex:number)=>({address,topics,data:encodeAbiParameters([{type:'uint256'}],[units]),logIndex,blockHash,transactionHash:hash});
  const logs=[log(USDC,123456n,0),log('0xfffffffffffffffffffffffffffffffffffffffe',123456000000000000n,1),log(USDC,123456n,2),log('0xfffffffffffffffffffffffffffffffffffffffe',123456000000000000n,3)];
  const client={getChainId:async()=>5042002,getLogs:async()=>logs,getTransactionReceipt:async()=>({status:'success',transactionHash:hash,blockNumber:12n,blockHash,logs}),getBlock:async()=>({hash:blockHash})} as unknown as PublicClient;
  const receipts=await rpcObserver('ARC-TESTNET',client,wallet).incoming('12','12');
  assert.equal(receipts.length,2);assert.deepEqual(receipts.map(t=>t.amount),['123456','123456']);assert.equal(new Set(receipts.map(t=>t.id)).size,2);
});
