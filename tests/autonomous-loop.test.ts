import {test} from 'node:test';
import {autonomousScenarios} from '../src/audit/autonomous-scenarios.ts';
import {runOfflineScenario} from '../src/audit/offline-rehearsal.ts';
for(const [index,scenario] of autonomousScenarios.entries())test(`${scenario.id} ${scenario.name}: ${scenario.predicate}`,{timeout:scenario.timeoutMs},async()=>{await runOfflineScenario(index+1);});
