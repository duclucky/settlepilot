import { decodeEventLog, parseAbiItem, type PublicClient, type Hex } from 'viem';
import { CHAIN_ID, SOURCE_CHAINS, USDC, type Snapshot, type State } from './domain.ts';
import type { Network, ObservedTransfer } from './autonomy-types.ts';
import { Store, event } from './store.ts';
import { enqueue } from './scheduler-core.ts';
import { matchReceipts } from './receipt-matching.ts';

const SYSTEM='0xfffffffffffffffffffffffffffffffffffffffe';
const abi=[parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')];
export interface ObserverReader {
  head():Promise<{number:string;hash:string;balance:string}>;
  blockHash(block:string):Promise<string>;
  incoming(from:string,to:string):Promise<ObservedTransfer[]>;
}
export function rpcObserver(chain:Network,client:PublicClient,wallet:string):ObserverReader {
  const id=chain==='ARC-TESTNET'?CHAIN_ID:SOURCE_CHAINS[chain].chainId;
  const token=chain==='ARC-TESTNET'?USDC:SOURCE_CHAINS[chain].usdc;
  const network=async()=>{if(await client.getChainId()!==id)throw new Error('OBSERVER_WRONG_CHAIN');};
  return {
    async head(){await network();const b=await client.getBlock({blockTag:'finalized'});const balance=await client.readContract({address:token,abi:[parseAbiItem('function balanceOf(address) view returns (uint256)')],functionName:'balanceOf',args:[wallet as Hex],blockNumber:b.number!});return {number:b.number!.toString(),hash:b.hash!,balance:balance.toString()};},
    async blockHash(block){await network();return (await client.getBlock({blockNumber:BigInt(block)})).hash!;},
    async incoming(from,to){
      await network();
      const logs=await client.getLogs({address:chain==='ARC-TESTNET'?[token,SYSTEM as Hex]:token,event:abi[0],args:{to:wallet as Hex},fromBlock:BigInt(from),toBlock:BigInt(to)});
      const result:ObservedTransfer[]=[];
      for(const hash of new Set(logs.map(l=>l.transactionHash).filter((h):h is Hex=>!!h))) {
        const receipt=await client.getTransactionReceipt({hash});
        if(receipt.status!=='success'||receipt.transactionHash!==hash)throw new Error('OBSERVER_UNVERIFIED_RECEIPT');
        if((await client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw new Error('OBSERVER_NONCANONICAL');
        const decoded: Array<{index:number;system:boolean;from:string;amount:bigint}>=[];
        for(const log of receipt.logs) {
          const addr=log.address.toLowerCase();if(addr!==token.toLowerCase()&&!(chain==='ARC-TESTNET'&&addr===SYSTEM))continue;
          try {
            const d=decodeEventLog({abi,data:log.data,topics:log.topics});
            if(d.args.to.toLowerCase()!==wallet.toLowerCase())continue;
            const system=addr===SYSTEM;
            if(system&&d.args.value%1_000_000_000_000n!==0n)throw new Error('UNSUPPORTED_SUBMICRO_TRANSFER');
            decoded.push({index:log.logIndex,system,from:d.args.from.toLowerCase(),amount:system?d.args.value/1_000_000_000_000n:d.args.value});
          } catch(error){if(error instanceof Error&&error.message==='UNSUPPORTED_SUBMICRO_TRANSFER')throw error;}
        }
        const paired=new Set<number>();
        for(const item of decoded.filter(d=>!d.system)) {const twin=decoded.find(d=>d.system&&!paired.has(d.index)&&d.from===item.from&&d.amount===item.amount);if(twin)paired.add(twin.index);}
        for(const item of decoded.filter(d=>!d.system||!paired.has(d.index))) {
          if(item.amount<=0n)continue;
          result.push({id:`${id}:${hash}:${item.index}`,chain,hash,logIndex:item.index,sender:item.from,recipient:wallet.toLowerCase(),amount:item.amount.toString(),block:receipt.blockNumber.toString(),blockHash:receipt.blockHash,status:'VERIFIED',classification:item.from===`0x${'0'.repeat(40)}`?'MINT':item.from===wallet.toLowerCase()?'INTERNAL':'UNMATCHED'});
        }
      }
      return result;
    },
  };
}
export async function observeChain(store:Store,chain:Network,reader:ObserverReader) {
  const head=await reader.head(),saved=store.read().autonomy!.checkpoints.find(c=>c.chain===chain);
  if(!saved){store.change(s=>{s.autonomy!.checkpoints.push({chain,nextBlock:(BigInt(head.number)+1n).toString(),block:head.number,blockHash:head.hash,openingBalance:head.balance});});return;}
  if(saved.block&&saved.blockHash&&await reader.blockHash(saved.block)!==saved.blockHash) {
    store.change(s=>{s.autonomy!.observationPaused=true;for(const t of s.autonomy!.transfers.filter(t=>t.chain===chain))t.status='REORGED';event(s,'CHAIN_CANONICALITY_LOST',chain);});
    throw new Error('CHAIN_CANONICALITY_LOST');
  }
  const from=BigInt(saved.nextBlock);if(from>BigInt(head.number))return;
  const end=(from+499n<BigInt(head.number)?from+499n:BigInt(head.number)).toString();
  const transfers=await reader.incoming(from.toString(),end);const blockHash=await reader.blockHash(end);
  store.change(s=>{
    const cp=s.autonomy!.checkpoints.find(c=>c.chain===chain)!;
    if(cp.nextBlock!==saved.nextBlock)return;
    for(const t of transfers) {
      if(t.chain!==chain||t.recipient.toLowerCase()!==s.policy.sender.toLowerCase()||t.status!=='VERIFIED'||BigInt(t.block)<from||BigInt(t.block)>BigInt(end))throw new Error('INVALID_OBSERVED_TRANSFER');
      if(s.autonomy!.transfers.some(old=>old.id===t.id))continue;
      if(s.bridgeIntents.some(i=>i.mintHash?.toLowerCase()===t.hash.toLowerCase()))t.classification='INTERNAL';
      s.autonomy!.transfers.push(t);enqueue(s,'RECEIPT_VERIFIED',`receipt:${t.id}`);
    }
    if(s.autonomy!.transfers.length>5000)throw new Error('OBSERVER_STORAGE_LIMIT');
    cp.nextBlock=(BigInt(end)+1n).toString();cp.block=end;cp.blockHash=blockHash;
    matchReceipts(s);
  });
}
