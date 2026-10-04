import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.ts';
import { sendTelegramMessage, telegramDispatcherFromEnv, type TelegramNotificationDispatcher } from './telegram-notifications.ts';
import { updateLocalEnv } from './local-env.ts';

const BotToken = z.string().regex(/^\d{5,}:[A-Za-z0-9_-]{20,}$/);
const ChatId = z.string().regex(/^(?:-?\d+|@[A-Za-z0-9_]{5,})$/);
const TelegramSettingsInput = z.object({
  enabled: z.boolean(),
  botToken: z.string().trim().max(256).optional(),
  chatId: z.string().trim().max(128),
}).strict();

export type TelegramSettingsView = { enabled: boolean; ready: boolean; tokenConfigured: boolean; chatId: string };
type TelegramSettingsOptions = { envFile?: string; env?: NodeJS.ProcessEnv; transport?: typeof fetch };

export class TelegramNotificationService {
  private readonly env: NodeJS.ProcessEnv;
  private readonly envFile: string;
  private readonly transport: typeof fetch;
  private dispatcher?: TelegramNotificationDispatcher;

  constructor(private store: Store, options: TelegramSettingsOptions = {}) {
    this.env = options.env ?? process.env;
    this.envFile = resolve(options.envFile ?? '.env');
    this.transport = options.transport ?? fetch;
    this.reload();
  }

  settings(): TelegramSettingsView {
    const enabled = this.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true';
    return {
      enabled,
      ready: enabled && !!this.dispatcher,
      tokenConfigured: BotToken.safeParse(this.env.TELEGRAM_BOT_TOKEN).success,
      chatId: this.env.TELEGRAM_CHAT_ID ?? '',
    };
  }

  configure(raw: unknown): TelegramSettingsView {
    const input = TelegramSettingsInput.parse(raw);
    const suppliedToken = input.botToken || undefined;
    if (suppliedToken) BotToken.parse(suppliedToken);
    const token = suppliedToken ?? this.env.TELEGRAM_BOT_TOKEN;
    if (input.enabled) {
      BotToken.parse(token);
      ChatId.parse(input.chatId);
    } else if (input.chatId) ChatId.parse(input.chatId);

    const values: Record<string, string> = {
      TELEGRAM_NOTIFICATIONS_ENABLED: String(input.enabled),
      TELEGRAM_CHAT_ID: input.chatId,
    };
    if (suppliedToken) values.TELEGRAM_BOT_TOKEN = suppliedToken;
    updateLocalEnv(this.envFile, values);

    this.env.TELEGRAM_NOTIFICATIONS_ENABLED = String(input.enabled);
    this.env.TELEGRAM_CHAT_ID = input.chatId;
    if (suppliedToken) this.env.TELEGRAM_BOT_TOKEN = suppliedToken;
    this.reload();
    return this.settings();
  }

  async test() {
    const current = this.settings();
    if (!current.ready) throw new Error('TELEGRAM_NOT_READY');
    await sendTelegramMessage(this.transport, BotToken.parse(this.env.TELEGRAM_BOT_TOKEN), ChatId.parse(this.env.TELEGRAM_CHAT_ID), 'SettlePilot · NORMAL\nNotifications are connected. Actions remain available only in the local SettlePilot app on your PC.', true);
  }

  enqueueAudit(status: 'STARTED' | 'COMPLETED' | 'ATTENTION', auditId: string) {
    const kind = status === 'STARTED' ? 'AUDIT_STARTED' : status === 'COMPLETED' ? 'AUDIT_COMPLETED' : 'AUDIT_ATTENTION';
    const severity = status === 'ATTENTION' ? 'HIGH' : 'NORMAL';
    this.store.change(state => {
      const fingerprint = `audit:${status.toLowerCase()}:${auditId}`;
      if (state.telegramDeliveries.some(item => item.fingerprint === fingerprint)) return;
      state.telegramDeliveries.push({ id: randomUUID(), fingerprint, kind, subjectId: auditId, severity, status: 'ACTIVE', repeat: false, createdAt: new Date().toISOString(), sendCount: 0, failureCount: 0 });
    });
  }

  async tick(now = Date.now()) { await this.dispatcher?.tick(now); }

  private reload() {
    try { this.dispatcher = telegramDispatcherFromEnv(this.store, this.env, this.transport); }
    catch { this.dispatcher = undefined; }
  }
}
