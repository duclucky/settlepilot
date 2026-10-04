import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { State, TelegramDelivery, TelegramNotificationKind, TelegramSeverity } from './domain.ts';
import { Store } from './store.ts';

const HIGH_WINDOW_MS = 24 * 60 * 60_000;
const INTERVAL_MS: Record<TelegramSeverity, number> = { NORMAL: Number.POSITIVE_INFINITY, MEDIUM: 6 * 60 * 60_000, HIGH: 30 * 60_000 };
const TelegramResponse = z.object({ ok: z.literal(true), result: z.object({ message_id: z.number().int() }).passthrough() }).passthrough();
const incidentKey=(parts:unknown[])=>`incident:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;

function severity(deadlineAt: string | undefined, now: number): TelegramSeverity {
  return deadlineAt && Date.parse(deadlineAt) - now <= HIGH_WINDOW_MS ? 'HIGH' : 'MEDIUM';
}

function earlier(...values: (string | undefined)[]) {
  return values.filter((value): value is string => !!value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function syncDeliveries(state: State, now: number) {
  const nowIso = new Date(now).toISOString();
  const firstSync = !state.telegramNotificationsStartedAt;
  if (firstSync) state.telegramNotificationsStartedAt = nowIso;
  const startedAt = Date.parse(state.telegramNotificationsStartedAt!);
  for (const delivery of state.telegramDeliveries.filter(item => item.repeat && item.status === 'ACTIVE')) delivery.status = 'RESOLVED';

  const upsert = (fingerprint: string, kind: TelegramNotificationKind, subjectId: string, level: TelegramSeverity, repeat: boolean, deadlineAt?: string, aliases:string[]=[]) => {
    let delivery = state.telegramDeliveries.find(item => item.fingerprint === fingerprint);
    // Reuse historical delivery timing when upgrading legacy request-ID keys.
    // Older duplicate rows remain resolved audit history; none are resent.
    const legacy=state.telegramDeliveries.filter(item=>aliases.includes(item.fingerprint));
    const latest=legacy.filter(item=>item.lastSentAt).sort((a,b)=>Date.parse(b.lastSentAt!)-Date.parse(a.lastSentAt!))[0];
    if(!delivery&&legacy.length){delivery=latest??legacy[0];delivery.fingerprint=fingerprint;}
    if(delivery&&latest&&(!delivery.lastSentAt||Date.parse(latest.lastSentAt!)>Date.parse(delivery.lastSentAt))){delivery.lastSentAt=latest.lastSentAt;delivery.lastSentSeverity=latest.lastSentSeverity;}
    if(delivery){
      const retry=legacy.map(d=>d.nextAttemptAt).filter((t):t is string=>!!t).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
      if(retry&&(!delivery.nextAttemptAt||Date.parse(retry)>Date.parse(delivery.nextAttemptAt)))delivery.nextAttemptAt=retry;
    }
    if (!delivery) {
      delivery = { id: randomUUID(), fingerprint, kind, subjectId, severity: level, status: 'ACTIVE', repeat, createdAt: nowIso, deadlineAt, sendCount: 0, failureCount: 0 };
      state.telegramDeliveries.push(delivery);
    } else if (delivery.status !== 'DELIVERED') {
      delivery.status = 'ACTIVE'; delivery.severity = level; delivery.deadlineAt = deadlineAt; delivery.kind=kind;delivery.subjectId=subjectId;
    }
  };

  for (const revenue of state.revenues.filter(item => !item.simulated && Date.parse(item.createdAt) >= startedAt)) upsert(`revenue:${revenue.id}`, 'REVENUE_VERIFIED', revenue.id, 'NORMAL', false);
  for (const intent of state.intents.filter(item => item.status === 'SETTLED' && item.settledAt && Date.parse(item.settledAt) >= startedAt)) upsert(`payment:${intent.id}`, 'PAYMENT_SETTLED', intent.id, 'NORMAL', false);
  for (const bridge of state.bridgeIntents.filter(item => item.status === 'SETTLED' && item.settledAt && Date.parse(item.settledAt) >= startedAt)) upsert(`bridge:${bridge.id}`, 'BRIDGE_SETTLED', bridge.id, 'NORMAL', false);

  for (const notification of state.agentNotifications.filter(item => item.status === 'OPEN')) {
    for(const issue of notification.issues){
      const obligation = state.obligations.find(item => item.id === issue.obligationId);
      const key=(n:typeof notification)=>incidentKey(['OWNER',issue.obligationId,issue.reason,n.obligationVersion??obligation?.version,n.policyVersion??state.policy.version]);
      const aliases=state.agentNotifications.filter(n=>n.issues.some(i=>i.obligationId===issue.obligationId&&i.reason===issue.reason)&&key(n)===key(notification)).map(n=>`agent:${n.id}`);
      const deadlineAt=obligation?.due,level=notification.type==='POLICY_ESCALATION'?'HIGH':severity(deadlineAt,now);
      upsert(key(notification),'OWNER_ACTION_REQUIRED',issue.obligationId,level,true,deadlineAt,aliases);
    }
  }
  for (const request of state.evidenceRequests.filter(item => item.status === 'OPEN')) {
    const obligation = state.obligations.find(item => item.id === request.obligationId);
    const deadlineAt = earlier(obligation?.due, request.expiresAt);
    const aliases=state.evidenceRequests.filter(r=>r.obligationId===request.obligationId&&r.obligationVersion===request.obligationVersion).map(r=>`evidence:${r.id}`);
    upsert(incidentKey(['ACCEPTANCE',request.obligationId,request.obligationVersion]), 'OWNER_ACTION_REQUIRED', request.obligationId, severity(deadlineAt, now), true, deadlineAt,aliases);
  }
  for(const request of state.autonomy?.requests.filter(r=>r.status==='OPEN')??[]) {
    // Unknown financial outcomes already have a single dedicated incident below.
    if(request.legacyId===`unknown:${request.scope}`)continue;
    if(request.legacyId && (state.evidenceRequests.some(r=>r.id===request.legacyId)||state.agentNotifications.some(n=>n.id===request.legacyId)))continue;
    const deadlineAt=earlier(state.obligations.find(o=>o.id===request.scope)?.due,new Date(request.expiresAt).toISOString());
    const key=(r:typeof request)=>incidentKey(['ACTION',r.kind,r.scope,r.action.reason,r.obligationVersion,r.policyVersion,r.legacyId?.startsWith('job:')?r.legacyId:undefined]);
    const aliases=state.autonomy!.requests.filter(r=>key(r)===key(request)).map(r=>`action:${r.id}`);
    upsert(key(request),'OWNER_ACTION_REQUIRED',request.scope,severity(deadlineAt,now),true,deadlineAt,aliases);
  }
  for(const [type,operations]of [['payment',state.intents],['bridge',state.bridgeIntents]] as const){
    for(const operation of operations.filter(i=>i.status==='EXECUTION_UNKNOWN')){
      const aliases=[`${type}-unknown:${operation.id}`,...(state.autonomy?.requests.filter(r=>r.legacyId===`unknown:${operation.id}`).map(r=>`action:${r.id}`)??[])];
      upsert(incidentKey(['UNKNOWN',type,operation.id]),'OPERATION_UNCERTAIN',operation.id,'HIGH',true,undefined,aliases);
    }
  }
}

function messageFor(delivery: TelegramDelivery) {
  if (delivery.kind === 'AUDIT_STARTED') return 'SettlePilot · NORMAL\nAn Agent audit started on the local PC. Open SettlePilot on your PC to review progress.';
  if (delivery.kind === 'AUDIT_COMPLETED') return 'SettlePilot · NORMAL\nAn Agent audit completed. Open SettlePilot on your PC to review the results.';
  if (delivery.kind === 'AUDIT_ATTENTION') return 'SettlePilot · HIGH\nAn Agent audit needs local review. Open SettlePilot on your PC now. Actions cannot be completed in Telegram.';
  if (delivery.severity === 'HIGH') {
    const detail = delivery.kind === 'OPERATION_UNCERTAIN' ? 'An operation needs urgent local review.' : 'An unresolved local action is approaching its deadline.';
    return `SettlePilot · HIGH\n${detail} Open the local SettlePilot app on your PC now. Actions cannot be completed in Telegram.`;
  }
  if (delivery.severity === 'MEDIUM') return 'SettlePilot · MEDIUM\nThe Agent needs your decision. Open the local SettlePilot app on your PC. Actions cannot be completed in Telegram.';
  const detail = delivery.kind === 'PAYMENT_SETTLED' ? 'A payment completed successfully.' : delivery.kind === 'BRIDGE_SETTLED' ? 'Crosschain funding completed successfully.' : 'Incoming funds were verified.';
  return `SettlePilot · NORMAL\n${detail} Open the local SettlePilot app on your PC to review.`;
}

function due(delivery: TelegramDelivery, now: number) {
  if (delivery.status !== 'ACTIVE') return false;
  if (delivery.nextAttemptAt && Date.parse(delivery.nextAttemptAt) > now) return false;
  if (!delivery.lastSentAt || delivery.severity==='HIGH'&&delivery.lastSentSeverity!=='HIGH') return true;
  return delivery.severity !== 'NORMAL' && now - Date.parse(delivery.lastSentAt) >= INTERVAL_MS[delivery.severity];
}

interface TelegramOptions { token: string; chatId: string; transport?: typeof fetch }

export async function sendTelegramMessage(transport: typeof fetch, token: string, chatId: string, message: string, silent: boolean) {
  const response = await transport(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ chat_id: chatId, text: message, disable_notification: silent, protect_content: true }),
  });
  if (!response.ok) throw new Error('TELEGRAM_REQUEST_FAILED');
  return String(TelegramResponse.parse(await response.json()).result.message_id);
}

export class TelegramNotificationDispatcher {
  private transport: typeof fetch;
  private sending=false;
  constructor(private store: Store, private options: TelegramOptions) { this.transport = options.transport ?? fetch; }
  async tick(now = Date.now()) {
    if(this.sending)return;
    this.sending=true;
    try{
      this.store.change(state => syncDeliveries(state, now));
      const candidates = this.store.read().telegramDeliveries.filter(item => due(item, now)).slice(0, 10);
      for (const candidate of candidates) {
        try {
          const messageId = await sendTelegramMessage(this.transport, this.options.token, this.options.chatId, messageFor(candidate), candidate.severity === 'NORMAL');
          this.store.change(state => {
            const item = state.telegramDeliveries.find(delivery => delivery.id === candidate.id); if (!item || item.status !== 'ACTIVE') return;
            item.lastSentAt = new Date(now).toISOString(); item.lastSentSeverity = item.severity; item.sendCount++; item.failureCount = 0; item.nextAttemptAt = undefined; item.telegramMessageId = messageId;
            if (!item.repeat) item.status = 'DELIVERED';
          });
        } catch {
          this.store.change(state => {
            const item = state.telegramDeliveries.find(delivery => delivery.id === candidate.id); if (!item || item.status !== 'ACTIVE') return;
            item.failureCount++; const delay = Math.min(30 * 60_000, 60_000 * 2 ** Math.min(item.failureCount, 5));
            item.nextAttemptAt = new Date(now + delay).toISOString();
          });
        }
      }
      }finally{this.sending=false;}
  }
}

export function telegramDispatcherFromEnv(store: Store, env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch) {
  if (env.TELEGRAM_NOTIFICATIONS_ENABLED !== 'true') return undefined;
  const token = z.string().regex(/^\d{5,}:[A-Za-z0-9_-]{20,}$/).parse(env.TELEGRAM_BOT_TOKEN);
  const chatId = z.string().regex(/^(?:-?\d+|@[A-Za-z0-9_]{5,})$/).parse(env.TELEGRAM_CHAT_ID);
  return new TelegramNotificationDispatcher(store, { token, chatId, transport });
}
