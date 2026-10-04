import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,CHAIN_ID,display,type PaymentGateway,type Decision} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {CctpBridge} from '../src/cctp.ts';
import {runAdaptive} from '../src/adaptive.ts';
import type {Runtime} from '../src/config.ts';

for(const variant of ['unchanged','arc-changed','source-changed','arc-unavailable'] as const){
  test(`slow model planning refreshes treasury before CCTP: ${variant}`,async()=>{
    const originalNow=Date.now;let now=originalNow(),snapshots=0,sourceReads=0,plans=0,sends=0;
    Date.now=()=>now;
    const s=fixture();s.mode='testnet';s.snapshot.balance='60000';s.policy.reserve='50000';s.policy.gasLimit='10000';
    s.obligations=[{...s.obligations[0],amount:'90000'}];s.bridgePolicy.enabled=true;s.bridgePolicy.sourceChains=['BASE-SEPOLIA'];
    const store=new Store(':memory:',s);
    const gateway:PaymentGateway={mode:'testnet',snapshot:async()=>{
      snapshots++;
      if(variant==='arc-unavailable'&&snapshots>1)throw new Error('ARC_UNAVAILABLE');
      return {balance:variant==='arc-changed'&&snapshots>1?'50000':'60000',chainId:CHAIN_ID,block:String(snapshots),observedAt:new Date(now).toISOString()};
    },estimate:async()=>{throw new Error('NO_PAYOUT_BEFORE_MINT');},submit:async()=>{throw new Error('NO_PAYOUT_BEFORE_MINT');},reconcile:async()=>({status:'pending'})};
    const engine=new Engine(store,gateway,{name:'slow fake LLM',plan:async()=>{
      plans++;now+=45_000;
      return [{obligationId:s.obligations[0].id,action:'FUND_ARC',reason:'Verified source funding is needed',evidenceIds:['e-a'],fundingSourceChain:'BASE-SEPOLIA'}] satisfies Decision[];
    }});
    const sources=new Map([['BASE-SEPOLIA' as const,{snapshot:async()=>{
      sourceReads++;
      return {balance:variant==='source-changed'&&sourceReads>1?'10000000':'11000000',chainId:84532,block:String(sourceReads),observedAt:new Date(now).toISOString()};
    }}]]);
    const bridge=new CctpBridge(store,sources as never,{} as never,async args=>{
      if(args[0]==='wallet')return {data:{wallets:[{type:'agent',blockchain:'BASE-SEPOLIA',address:s.policy.sender}]}};
      if(args[1]==='get-fee')return {data:{fromChain:'BASE-SEPOLIA',toChain:'ARC-TESTNET',fees:[{finalityThreshold:1000,minimumFee:0,forwardFee:{med:0}}]}};
      if(args[1]==='transfer'){sends++;return {data:{fromChain:'BASE-SEPOLIA',toChain:'ARC-TESTNET',amount:display(store.read().bridgeIntents[0].amount),status:'pending',burnTxHash:`0x${'a'.repeat(64)}`}};}
      return {data:{status:'pending'}};
    },{enabled:true,responseTimeoutMs:1});
    const r:Runtime={store,engine,sources:sources as unknown as Runtime['sources'],bridge,bridgeEnabled:true,arc:undefined,sendEnabled:true,useModel:true,walletProvider:'agent'};
    try{
      if(variant==='arc-unavailable'){
        await assert.rejects(runAdaptive(r),/ARC_UNAVAILABLE/);assert.equal(sends,0);assert.equal(store.read().bridgeIntents.length,0);
      }else{
        const result=await runAdaptive(r);assert.ok(result.bridgeId,'approved funding must create a real bridge intent after a slow plan');
        assert.equal(sends,1);assert.equal(store.read().bridgeIntents[0].amount,variant==='arc-changed'?'100000':'90000');
        assert.equal(store.read().bridgeIntents[0].status,'BURN_OBSERVED');assert.equal(store.read().intents.length,0);
        assert.equal(plans,variant==='unchanged'?1:2,'changed financial facts must reach the planner before dispatch');
      }
    }finally{store.close();Date.now=originalNow;}
  });
}
