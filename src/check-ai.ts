import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { fixture, money } from './domain.ts';
import { ModelPlanner } from './adapters/model.ts';
import { JevReviewedPlanner } from './adapters/jev.ts';

loadEnvFile('.env');
if (process.env.ALLOW_MODEL_REQUESTS !== 'true' || process.env.JEV_ENABLED !== 'true') throw new Error('AI_PREFLIGHT_NOT_ENABLED');

const state = fixture();
state.obligations = [state.obligations[0]];
state.evidence = state.evidence.filter(e => e.obligationId === state.obligations[0].id);
state.snapshot.balance = money('20');

const planner = new JevReviewedPlanner(
  new ModelPlanner(z.string().min(1).parse(process.env.OPENAI_API_KEY), z.literal('gpt-5.4').parse(process.env.OPENAI_MODEL)),
  z.string().min(1).parse(process.env.JEV_API_KEY),
  z.string().min(1).parse(process.env.JEV_MODEL ?? 'jev-latest'),
  z.coerce.number().min(0.5).max(1).parse(process.env.JEV_MIN_CONFIDENCE ?? '0.8'),
);
const decisions = await planner.plan(state);
console.log(JSON.stringify({ ok: true, planner: planner.name, decisions }, null, 2));
