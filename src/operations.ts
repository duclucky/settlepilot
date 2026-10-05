import type { Runtime } from './config.ts';
import { AgentScheduler } from './scheduler.ts';
import { decisionKey } from './scheduler-core.ts';
import { IndependentWorkers } from './worker-health.ts';
import { syncDirectory } from './sources/local-export.ts';
import { observeChain, rpcObserver } from './chain-observer.ts';
import { matchReceipts } from './receipt-matching.ts';
import { refreshCrosschainBalances } from './treasury.ts';
import { syncActionRequests } from './action-requests.ts';
import type { TelegramNotificationService } from './telegram-settings.ts';

export class AutonomousOperations {
  readonly scheduler:AgentScheduler;
  readonly workers:IndependentWorkers;
  constructor(readonly runtime:Runtime,private telegram?:TelegramNotificationService) {
    this.scheduler=new AgentScheduler(runtime);this.workers=new IndependentWorkers(runtime.store);
  }
  async tick() {
    const {store,engine,bridge,arc,sources}=this.runtime;
    const tasks:Promise<unknown>[]=[
      ...(store.read().autonomy!.sourceDirectory?[this.workers.run('business-source',async()=>{await syncDirectory(store);store.change(s=>matchReceipts(s));})]:[]),
      this.workers.run('payment-reconciliation',async()=>{
        const before=store.read().intents.filter(i=>i.status==='SETTLED').length;
        await engine.reconcile();if(store.read().intents.filter(i=>i.status==='SETTLED').length!==before)this.scheduler.wake('PAYMENT_SETTLED');
      }),
      ...(bridge?[this.workers.run('bridge-reconciliation',async()=>{if(await bridge.reconcile())this.scheduler.wake('BRIDGE_SETTLED');})]:[]),
      this.workers.run('treasury',async()=>{
        const before=decisionKey(store.read());const snapshot=await engine.gateway.snapshot();store.change(s=>{s.snapshot=snapshot;});
        if(before!==decisionKey(store.read()))this.scheduler.wake('MATERIAL_BALANCE_CHANGED');
      }),
      ...(sources?[this.workers.run('multichain-treasury',async()=>{
        const before=decisionKey(store.read());
        await refreshCrosschainBalances(store,sources,this.runtime.bridgeEnabled);
        if(before!==decisionKey(store.read()))this.scheduler.wake('MATERIAL_BALANCE_CHANGED');
      })]:[]),
    ];
    if(arc)tasks.push(this.workers.run('chain:ARC-TESTNET',()=>observeChain(store,'ARC-TESTNET',rpcObserver('ARC-TESTNET',arc.client,store.read().policy.sender))));
    if(sources)for(const [chain,reader]of sources)if(store.read().bridgePolicy.sourceChains.includes(chain))tasks.push(this.workers.run(`chain:${chain}`,()=>observeChain(store,chain,rpcObserver(chain,reader.client,store.read().policy.sender))));
    if(this.telegram?.settings().ready)tasks.push(this.workers.run('telegram',()=>this.telegram!.tick()));
    await Promise.allSettled(tasks);
    if(!store.read().autonomy!.sourceDirectory)store.change(s=>{const a=s.autonomy!;let w=a.workers.find(w=>w.name==='business-source');if(!w){w={name:'business-source',status:'NOT_CONNECTED',lastAttempt:Date.now(),failures:0};a.workers.push(w);}w.status='NOT_CONNECTED';});
    for(const name of [...(!bridge?['bridge-reconciliation']:[]),...(!this.telegram?.settings().ready?['telegram']:[])])store.change(s=>{let w=s.autonomy!.workers.find(w=>w.name===name);if(!w){w={name,status:'NOT_CONNECTED',lastAttempt:Date.now(),failures:0};s.autonomy!.workers.push(w);}w.status='NOT_CONNECTED';});
    syncActionRequests(store);
    if(store.read().autonomy!.enabled)await this.scheduler.tick();
    syncActionRequests(store);
  }
}
