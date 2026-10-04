import type { Intent, PaymentGateway } from '../domain.ts';
import type { Store } from '../store.ts';
export class SimulationGateway implements PaymentGateway {
  mode = 'simulation' as const;
  constructor(private store: Store) {}
  async snapshot() { return { ...this.store.read().snapshot, observedAt: new Date().toISOString() }; }
  async estimate() { return '0'; }
  async submit(intent: Intent) { return { providerId: `simulation:${intent.id}` }; }
  async reconcile(intent: Intent) {
    // A simulation has no chain hash or receipt. Never synthesize one.
    return { status: intent.providerId?.startsWith('simulation:') ? 'simulated' as const : 'pending' as const };
  }
}
