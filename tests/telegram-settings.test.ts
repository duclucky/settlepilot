import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { fixture } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { RulesPlanner } from '../src/planner.ts';
import { SimulationGateway } from '../src/adapters/simulation.ts';
import { TelegramNotificationService } from '../src/telegram-settings.ts';

const token = '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF';

test('Telegram settings update the ignored local env atomically without exposing or deleting secrets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tameion-telegram-'));
  const envFile = join(directory, '.env');
  writeFileSync(envFile, `OPENAI_API_KEY=keep-this\nTELEGRAM_NOTIFICATIONS_ENABLED=false\nTELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_CHAT_ID=111\n`);
  const store = new Store(':memory:', fixture());
  const env: NodeJS.ProcessEnv = { TELEGRAM_NOTIFICATIONS_ENABLED: 'false', TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: '111' };
  try {
    const service = new TelegramNotificationService(store, { envFile, env, transport: async () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }) });
    assert.deepEqual(service.settings(), { enabled: false, ready: false, tokenConfigured: true, chatId: '111' });
    assert.equal(JSON.stringify(service.settings()).includes(token), false);

    const result = service.configure({ enabled: true, chatId: '-100987654' });
    assert.deepEqual(result, { enabled: true, ready: true, tokenConfigured: true, chatId: '-100987654' });
    const saved = readFileSync(envFile, 'utf8');
    assert.match(saved, /OPENAI_API_KEY=keep-this/);
    assert.match(saved, new RegExp(`TELEGRAM_BOT_TOKEN=${token}`));
    assert.match(saved, /TELEGRAM_CHAT_ID=-100987654/);
    assert.equal(env.TELEGRAM_NOTIFICATIONS_ENABLED, 'true');
    assert.equal(env.TELEGRAM_CHAT_ID, '-100987654');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Telegram settings API is authenticated, validates input, applies live, and never returns the bot token', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tameion-telegram-api-'));
  const envFile = join(directory, '.env');
  writeFileSync(envFile, 'UNCHANGED=yes\n');
  const store = new Store(':memory:', fixture());
  const engine = new Engine(store, new SimulationGateway(store), new RulesPlanner());
  const env: NodeJS.ProcessEnv = {};
  const sent: string[] = [];
  const telegram = new TelegramNotificationService(store, {
    envFile,
    env,
    transport: async (url, init) => {
      sent.push(`${url}\n${String(init?.body)}`);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 8 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const runtime = { store, engine, arc: undefined, sources: undefined, bridge: undefined, bridgeEnabled: false, sendEnabled: false, useModel: false, walletProvider: 'simulation' } as const;
  const server = createApp(runtime, 'test-session', { telegram }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/telegram-settings`;
  const headers = { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base)).status, 401);
    const invalid = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ enabled: true, botToken: 'bad', chatId: 'chat' }) });
    assert.equal(invalid.status, 400);
    const saved = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ enabled: true, botToken: token, chatId: '987654' }) });
    assert.equal(saved.status, 200);
    const body = await saved.json() as Record<string, unknown>;
    assert.deepEqual(body, { enabled: true, ready: true, tokenConfigured: true, chatId: '987654' });
    assert.equal(JSON.stringify(body).includes(token), false);

    const tested = await fetch(`${base}/test`, { method: 'POST', headers, body: '{}' });
    assert.equal(tested.status, 200);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Notifications are connected/);
    assert.doesNotMatch(sent[0], /UNCHANGED/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('audit lifecycle notifications are generic, durable and sent by the isolated runner service', async () => {
  const store = new Store(':memory:', fixture());
  const messages: string[] = [];
  const service = new TelegramNotificationService(store, {
    env: { TELEGRAM_NOTIFICATIONS_ENABLED: 'true', TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: '987654' },
    transport: async (_url, init) => { messages.push(String(init?.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); },
  });
  try {
    service.enqueueAudit('STARTED', 'private-audit-id');
    await service.tick();
    service.enqueueAudit('COMPLETED', 'private-audit-id');
    await service.tick();
    assert.equal(messages.length, 2);
    assert.match(messages[0], /audit started/);
    assert.match(messages[1], /audit completed/);
    assert.equal(messages.join('').includes('private-audit-id'), false);
  } finally { store.close(); }
});
