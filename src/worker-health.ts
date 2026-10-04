import { enqueue } from './scheduler-core.ts';
import { Store } from './store.ts';

export class IndependentWorkers {
  private running=new Set<string>();
  constructor(private store:Store,private clock=()=>Date.now()){}
  async run(name:string,task:()=>Promise<unknown>,timeoutMs=30_000) {
    const saved=this.store.read().autonomy!.workers.find(w=>w.name===name);
    if(this.running.has(name)||(saved?.retryAt??0)>this.clock())return;
    this.running.add(name);
    this.store.change(s=>{let w=s.autonomy!.workers.find(w=>w.name===name);if(!w){w={name,status:'HEALTHY',lastAttempt:this.clock(),failures:0};s.autonomy!.workers.push(w);}w.lastAttempt=this.clock();});
    let timer:ReturnType<typeof setTimeout> | undefined;
    const operation=Promise.resolve().then(task);operation.finally(()=>this.running.delete(name)).catch(()=>undefined);
    try {
      await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WORKER_TIMEOUT')),timeoutMs);})]);
      this.store.change(s=>{const w=s.autonomy!.workers.find(w=>w.name===name)!;if(w.status==='DEGRADED')enqueue(s,'WORKER_RECOVERED',`recovery:${name}:${w.lastAttempt}`,this.clock());w.status='HEALTHY';w.lastSuccess=this.clock();w.failures=0;w.error=undefined;w.retryAt=undefined;});
    } catch {
      this.store.change(s=>{const w=s.autonomy!.workers.find(w=>w.name===name)!;w.status='DEGRADED';w.error='SOURCE_OR_PROVIDER_UNAVAILABLE';w.failures++;w.retryAt=this.clock()+Math.min(300_000,5_000*2**Math.min(w.failures-1,6));});
    } finally {if(timer)clearTimeout(timer);}
  }
  get active(){return this.running.size;}
}
