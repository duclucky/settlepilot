import { readFileSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { Address, Units, CHAIN_ID, fixture, SOURCE_CHAINS, SOURCE_CHAIN_NAMES, type SourceChain, type State, type Intent } from './domain.ts';
import { evaluate } from './policy.ts';
import { Store } from './store.ts';
import { Engine } from './engine.ts';
import { RulesPlanner, DisabledPlanner } from './planner.ts';
import { ModelPlanner } from './adapters/model.ts';
import { JevReviewedPlanner } from './adapters/jev.ts';
import { SimulationGateway } from './adapters/simulation.ts';
import { CircleGateway } from './adapters/circle.ts';
import { AgentWalletGateway, circleCli } from './adapters/agent-wallet.ts';
import { ArcReader } from './adapters/arc.ts';
import { EvmSourceReader } from './adapters/crosschain.ts';
import { CctpBridge } from './cctp.ts';
import { AgentWorkspace } from './agent-workspace.ts';

const BridgePolicySchema = z.object({ version: z.number().int().positive(), enabled: z.boolean(), sourceChains: z.array(z.enum(SOURCE_CHAIN_NAMES)).min(1).max(SOURCE_CHAIN_NAMES.length), maxAmount: Units, maxFee: Units }).strict();
const PolicySchema = z.object({
  version: z.number().int().positive(), chainId: z.literal(CHAIN_ID), sender: Address,
  allowlist: z.array(Address).max(100), reserve: Units, gasLimit: Units,
  perObligation: Units, totalBudget: Units, authorityExpiresAt: z.iso.datetime(), enabled: z.boolean(),
  bridge: BridgePolicySchema.optional(),
}).strict();
export function authorizeSubmission(s: State, intent: Intent) {
  const i = s.intents.find(i => i.id === intent.id), o = s.obligations.find(o => o.id === intent.obligationId);
  return !!i && !!o && i.status === 'SUBMITTING' && i.submissionStateVersion === s.financialVersion && s.policy.version === intent.policyVersion && o.version === intent.obligationVersion && s.policy.sender === intent.sender && o.recipient === intent.recipient && o.amount === intent.amount && evaluate({ ...s, intents: s.intents.filter(other => other.id !== i.id) }, o) === 'ALLOW';
}
export function runtime() {
  const envFile = process.env.TAMEION_ENV_FILE ?? '.env';
  if (existsSync(envFile)) loadEnvFile(envFile);
  const mode = z.enum(['simulation', 'testnet']).parse(process.env.TAMEION_MODE ?? 'simulation');
  let initial: State = fixture();
  let arc: ArcReader | undefined;
  let sources: Map<SourceChain, EvmSourceReader> | undefined;
  const sendEnabled = process.env.SEND_ENABLED === 'true';
  const walletProvider = mode === 'simulation' ? 'simulation' : z.enum(['circle', 'agent']).parse(process.env.WALLET_PROVIDER ?? 'circle');
  if (mode === 'testnet') {
    const configured = PolicySchema.parse(JSON.parse(readFileSync(process.env.POLICY_FILE ?? 'data/policy.json', 'utf8')));
    const { bridge, ...policy } = configured;
    initial = { ...initial, mode, paused: false, policy, bridgePolicy: bridge ?? initial.bridgePolicy, obligations: [], evidence: [], snapshot: { balance: '0', chainId: CHAIN_ID, block: '0', observedAt: new Date(0).toISOString() } };
    arc = new ArcReader(process.env.ARC_TESTNET_RPC_URL);
    const envNames: Record<SourceChain, string> = { 'ETH-SEPOLIA': 'ETH_SEPOLIA_RPC_URL', 'AVAX-FUJI': 'AVAX_FUJI_RPC_URL', 'OP-SEPOLIA': 'OP_SEPOLIA_RPC_URL', 'ARB-SEPOLIA': 'ARB_SEPOLIA_RPC_URL', 'BASE-SEPOLIA': 'BASE_SEPOLIA_RPC_URL', 'MATIC-AMOY': 'MATIC_AMOY_RPC_URL', 'UNI-SEPOLIA': 'UNI_SEPOLIA_RPC_URL' };
    sources = new Map(initial.bridgePolicy.sourceChains.map(chain => [chain, new EvmSourceReader(chain, process.env[envNames[chain]] ?? SOURCE_CHAINS[chain].rpc)]));
  }
  const store = new Store(process.env.DATABASE_PATH ?? `data/${mode}.db`, initial);
  if (store.read().policy.sender !== initial.policy.sender) throw new Error('SAVED_WALLET_CONFIG_MISMATCH');
  if (mode === 'testnet' && JSON.stringify(store.read().bridgePolicy) !== JSON.stringify(initial.bridgePolicy)) throw new Error('SAVED_BRIDGE_POLICY_MISMATCH');
  store.bindWallet(`${walletProvider}:${initial.policy.sender}`);
  let engine: Engine;
  const authorize = (intent: Intent) => engine?.planner.financialEnabled !== false && (!engine?.executionGuard || engine.executionGuard()) && authorizeSubmission(store.read(), intent);
  const gateway = mode === 'simulation' ? new SimulationGateway(store) : walletProvider === 'agent' ? new AgentWalletGateway(initial.policy.sender, arc!, circleCli(z.string().min(1).parse(process.env.CIRCLE_CLI_ENTRYPOINT)), { store, sendEnabled, authorize }) : new CircleGateway({
    apiKey: process.env.CIRCLE_API_KEY ?? '', entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? '',
    walletId: z.string().uuid().parse(process.env.CIRCLE_WALLET_ID), sender: initial.policy.sender, sendEnabled,
    authorize,
  }, arc!);
  const useModel = process.env.ALLOW_MODEL_REQUESTS === 'true';
  const jevEnabled = process.env.JEV_ENABLED === 'true';
  if (jevEnabled && !useModel) throw new Error('JEV_REQUIRES_MODEL');
  const modelEndpoint = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1/responses';
  const modelUrl = new URL(modelEndpoint);
  const modelLoopback = ['localhost', '127.0.0.1', '::1'].includes(modelUrl.hostname);
  if (useModel && modelUrl.protocol !== 'https:' && !(modelUrl.protocol === 'http:' && modelLoopback)) throw new Error('INSECURE_LLM_ENDPOINT');
  const modelKey = process.env.OPENAI_API_KEY ?? '';
  if (useModel && !modelLoopback && !modelKey) throw new Error('LLM_KEY_REQUIRED');
  const basePlanner = useModel ? new ModelPlanner(modelKey, z.string().min(1).parse(process.env.OPENAI_MODEL), fetch, new AgentWorkspace(store), modelEndpoint) : mode === 'testnet' ? new DisabledPlanner() : new RulesPlanner();
  const jevEndpoint = process.env.JEV_BASE_URL ?? 'https://api.typesafe.ai/v1/systemone';
  const jevUrl = new URL(jevEndpoint);
  const jevLoopback = ['localhost', '127.0.0.1', '::1'].includes(jevUrl.hostname);
  if (jevEnabled && jevUrl.protocol !== 'https:' && !(jevUrl.protocol === 'http:' && jevLoopback)) throw new Error('INSECURE_LLM_ENDPOINT');
  const planner = jevEnabled ? new JevReviewedPlanner(
    basePlanner,
    z.string().min(1).parse(process.env.JEV_API_KEY),
    z.string().min(1).parse(process.env.JEV_MODEL ?? 'jev-latest'),
    z.coerce.number().min(0.5).max(1).parse(process.env.JEV_MIN_CONFIDENCE ?? '0.8'),
    fetch,
    jevEndpoint,
  ) : basePlanner;
  engine = new Engine(store, gateway, planner, mode === 'simulation' || sendEnabled);
  const bridgeEnabled = process.env.BRIDGE_ENABLED === 'true';
  const bridge = mode === 'testnet' && walletProvider === 'agent' ? new CctpBridge(store, sources!, arc!, circleCli(z.string().min(1).parse(process.env.CIRCLE_CLI_ENTRYPOINT)), { enabled: bridgeEnabled, decisionEnabled: () => engine.planner.financialEnabled !== false }) : undefined;
  return { store, engine, arc, sources, bridge, bridgeEnabled, sendEnabled, useModel, walletProvider };
}
export type Runtime = ReturnType<typeof runtime>;
