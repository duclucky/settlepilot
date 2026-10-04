import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../store.ts';
import {fixture,isPending,isBridgePending,CHAIN_ID} from '../domain.ts';
import {ArcReader} from '../adapters/arc.ts';
import {EvmSourceReader} from '../adapters/crosschain.ts';

export async function verifyAutonomous(directory:string,live=false){
  const root=resolve(directory),manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
  const summary=JSON.parse(readFileSync(resolve(root,'summary.json'),'utf8'));
  const reports=[];
  for(const result of summary.results){
    if(!result.database)continue;
    const path=resolve(root,result.database),rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('AUDIT_PATH_REJECTED');
    const initial=fixture();initial.mode=manifest.mode==='offline'?'simulation':'testnet';
    // CCTP fixtures deliberately exercise testnet coordinator contracts using fake adapters.
    if(result.mode==='OFFLINE_CCTP_FAULT')initial.mode='testnet';
    const store=new Store(path,initial);
    try{
      const s=store.read();const unique=new Set(s.intents.map(i=>i.idempotencyKey)).size===s.intents.length;
      const unresolved=s.intents.filter(isPending).length+s.bridgeIntents.filter(isBridgePending).length;
      let verifiedPayouts=0,verifiedBridges=0,verifiedIncoming=0;
      if(live){
        if(manifest.mode!=='live'||!manifest.startedAt)throw new Error('LIVE_MANIFEST_REQUIRED');
        const arc=new ArcReader(process.env.ARC_TESTNET_RPC_URL);
        for(const intent of s.intents.filter(i=>result.paymentIds?.includes(i.id)&&i.status==='SETTLED'&&i.hash&&Date.parse(i.createdAt)>=Date.parse(manifest.startedAt))){
          const source=s.autonomy!.records.find(r=>`${r.sourceId}-${r.externalId}`===intent.obligationId);
          if(!source||source.amount!==intent.amount||!s.policy.allowlist.includes(intent.recipient)||intent.chainId!==CHAIN_ID)throw new Error('AUDIT_PAYOUT_BINDING_MISMATCH');
          const expected={chainId:CHAIN_ID,sender:intent.sender,recipient:intent.recipient,amount:intent.amount};
          if(intent.agentDispatchAt)await arc.verifyAgentTransfer(intent.hash!,expected);
          else await arc.verify(intent.hash!,expected);
          verifiedPayouts++;
        }
        for(const bridge of s.bridgeIntents.filter(i=>result.bridgeIds?.includes(i.id)&&i.status==='SETTLED'&&i.burnHash&&i.mintHash&&Date.parse(i.createdAt)>=Date.parse(manifest.startedAt))){
          const source=new EvmSourceReader(bridge.sourceChain);
          await source.verifyWalletOutflow(bridge.burnHash!,bridge.sourceWallet,bridge.actualBurn??bridge.totalBurn);
          await arc.verifyCctpMint(bridge.mintHash!,bridge.recipient,bridge.amount);verifiedBridges++;
        }
        for(const receipt of s.autonomy!.transfers.filter(t=>result.incomingIds?.includes(t.id)&&t.status==='VERIFIED'&&t.classification==='CUSTOMER')){
          const client=receipt.chain==='ARC-TESTNET'?arc.client:new EvmSourceReader(receipt.chain).client;
          const block=await client.getBlock({blockNumber:BigInt(receipt.block)});
          if(Number(block.timestamp)*1000<Date.parse(manifest.startedAt))throw new Error('AUDIT_OLD_RECEIPT_REJECTED');
          if(receipt.chain==='ARC-TESTNET')await arc.verify(receipt.hash,{chainId:CHAIN_ID,sender:receipt.sender,recipient:receipt.recipient,amount:receipt.amount});
          else await new EvmSourceReader(receipt.chain).verifyIncoming(receipt.hash,{sender:receipt.sender,recipient:receipt.recipient,amount:receipt.amount});
          verifiedIncoming++;
        }
      }
      if(!unique)throw new Error('AUDIT_DUPLICATE_INTENT');
      reports.push({scenarioId:result.id,uniqueIntents:unique,unresolved,verifiedPayouts,verifiedBridges,verifiedIncoming,proofMode:live?'RPC_READ_ONLY':'OFFLINE_INVARIANTS_ONLY'});
    }finally{store.close();}
  }
  const output={schemaVersion:1,suiteId:manifest.suiteId,mode:manifest.mode,liveReceiptsVerified:live&&reports.some(r=>r.verifiedPayouts>0)&&reports.some(r=>r.verifiedBridges>0)&&reports.some(r=>r.verifiedIncoming>0),reports};
  writeFileSync(resolve(root,'receipt-verification.json'),JSON.stringify(output,null,2),'utf8');return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const directory=process.argv[2];if(!directory||!existsSync(resolve(directory,'manifest.json')))throw new Error('AUDIT_DIRECTORY_REQUIRED');
  const result=await verifyAutonomous(directory,process.argv.includes('--live'));console.log(JSON.stringify({scenarios:result.reports.length,liveReceiptsVerified:result.liveReceiptsVerified}));
}
