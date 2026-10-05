import { runtime } from './config.ts';
import { createApp } from './app.ts';
import { TelegramNotificationService } from './telegram-settings.ts';
import { LlmSettingsService } from './llm-settings.ts';
import { AutonomousOperations } from './operations.ts';

try {
  const current = runtime(); current.engine.recoverPrepared(); current.bridge?.recoverPrepared();
  const envFile = process.env.TAMEION_ENV_FILE ?? '.env';
  const telegram = new TelegramNotificationService(current.store, { envFile });
  const llm = new LlmSettingsService(current.store, current.engine, { envFile });
  const operations=new AutonomousOperations(current,telegram);
  const port = Number(process.env.PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
  const server = createApp(current, undefined, { telegram, llm, scheduler:operations.scheduler }).listen(port, '127.0.0.1', () => {
    console.log(`Tameion: http://127.0.0.1:${port} · ${current.store.read().mode} · ${current.engine.planner.name}`);
  });
  const timer = setInterval(()=>{void operations.tick().catch(()=>undefined);},5000);
  void telegram.tick().catch(() => undefined);
  let stopping=false;
  const stop = () => { if(stopping)return;stopping=true;clearInterval(timer);server.close();const end=Date.now()+35_000;const drain=setInterval(()=>{if(!operations.workers.active&&!operations.scheduler.active){clearInterval(drain);current.store.close();process.exit(0);}else if(Date.now()>end){clearInterval(drain);process.exit(0);}},100); }; 
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch { console.error('STARTUP_FAILED: kiểm tra cấu hình theo README; không in secret hoặc lỗi provider.'); process.exitCode = 1; }
