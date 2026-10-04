import { resolve } from 'node:path';
import { z } from 'zod';
import type { Planner } from './domain.ts';
import { Engine } from './engine.ts';
import { Store } from './store.ts';
import { RulesPlanner } from './planner.ts';
import { ModelPlanner } from './adapters/model.ts';
import { JevReviewedPlanner } from './adapters/jev.ts';
import { AgentWorkspace } from './agent-workspace.ts';
import { updateLocalEnv } from './local-env.ts';

const Secret = z.string().min(8).max(512).refine(value => !/[\r\n]/.test(value));
const Model = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:/-]+$/);
const Endpoint = z.string().trim().url().max(500).transform(value => {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('INSECURE_LLM_ENDPOINT');
  url.hash = '';
  return url.toString().replace(/\/$/, '');
});
const Input = z.object({
  enabled: z.boolean(), llmApiKey: Secret.optional(), llmEndpoint: Endpoint, llmModel: Model,
  jevEnabled: z.boolean(), jevApiKey: Secret.optional(), jevEndpoint: Endpoint, jevModel: Model,
  jevMinimumConfidence: z.number().min(0.5).max(1),
}).strict();

export type LlmSettingsView = {
  enabled: boolean; active: boolean; llmKeyConfigured: boolean; llmEndpoint: string; llmModel: string;
  jevEnabled: boolean; jevKeyConfigured: boolean; jevEndpoint: string; jevModel: string;
  jevMinimumConfidence: number; planner: string;
};
type Options = { envFile?: string; env?: NodeJS.ProcessEnv; transport?: typeof fetch };

export class LlmSettingsService {
  private readonly env: NodeJS.ProcessEnv;
  private readonly envFile: string;
  private readonly transport: typeof fetch;
  constructor(private store: Store, private engine: Engine, options: Options = {}) {
    this.env = options.env ?? process.env;
    this.envFile = resolve(options.envFile ?? '.env');
    this.transport = options.transport ?? fetch;
  }

  settings(): LlmSettingsView {
    const enabled = this.env.ALLOW_MODEL_REQUESTS === 'true';
    const jevEnabled = enabled && this.env.JEV_ENABLED === 'true';
    return {
      enabled, active: enabled && this.engine.planner.name.startsWith('AI ·'),
      llmKeyConfigured: Secret.safeParse(this.env.OPENAI_API_KEY).success,
      llmEndpoint: this.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1/responses',
      llmModel: this.env.OPENAI_MODEL ?? 'gpt-5.4',
      jevEnabled, jevKeyConfigured: Secret.safeParse(this.env.JEV_API_KEY).success,
      jevEndpoint: this.env.JEV_BASE_URL ?? 'https://api.typesafe.ai/v1/systemone',
      jevModel: this.env.JEV_MODEL ?? 'jev-latest',
      jevMinimumConfidence: Number(this.env.JEV_MIN_CONFIDENCE ?? '0.8'), planner: this.engine.planner.name,
    };
  }

  configure(raw: unknown): LlmSettingsView {
    const input = Input.parse(raw);
    if (input.jevEnabled && !input.enabled) throw new Error('JEV_REQUIRES_MODEL');
    const llmKey = input.llmApiKey ?? this.env.OPENAI_API_KEY ?? '';
    const jevKey = input.jevApiKey ?? this.env.JEV_API_KEY ?? '';
    const llmIsLoopback = ['localhost', '127.0.0.1', '::1'].includes(new URL(input.llmEndpoint).hostname);
    if (input.enabled && !llmIsLoopback && !Secret.safeParse(llmKey).success) throw new Error('LLM_KEY_REQUIRED');
    if (input.jevEnabled && !Secret.safeParse(jevKey).success) throw new Error('JEV_KEY_REQUIRED');

    let planner: Planner = new RulesPlanner();
    if (input.enabled) {
      const base = new ModelPlanner(llmKey, input.llmModel, this.transport, new AgentWorkspace(this.store), input.llmEndpoint);
      planner = input.jevEnabled
        ? new JevReviewedPlanner(base, jevKey, input.jevModel, input.jevMinimumConfidence, this.transport, input.jevEndpoint)
        : base;
    }
    const previousPlanner = this.engine.planner;
    this.engine.setPlanner(planner);
    const values: Record<string, string> = {
      ALLOW_MODEL_REQUESTS: String(input.enabled), OPENAI_BASE_URL: input.llmEndpoint, OPENAI_MODEL: input.llmModel,
      JEV_ENABLED: String(input.jevEnabled), JEV_BASE_URL: input.jevEndpoint, JEV_MODEL: input.jevModel,
      JEV_MIN_CONFIDENCE: input.jevMinimumConfidence.toFixed(2),
    };
    if (input.llmApiKey) values.OPENAI_API_KEY = input.llmApiKey;
    if (input.jevApiKey) values.JEV_API_KEY = input.jevApiKey;
    try { updateLocalEnv(this.envFile, values); }
    catch (error) { this.engine.setPlanner(previousPlanner); throw error; }
    Object.assign(this.env, values);
    return this.settings();
  }
}
