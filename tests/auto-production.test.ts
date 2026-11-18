import { beforeAll, afterAll, it } from 'vitest';
import { prepareProductionScenario, disposeProductionScenario, runProductionScenario } from './support/production-scenario.js';
let ready=false;
beforeAll(async()=>{ready=await prepareProductionScenario();},200000);
afterAll(disposeProductionScenario);
it('T23 · tema nuevo AUTO hasta MP4 real, paquete y exportación, sin créditos',async({skip})=>{if(!ready)skip();await runProductionScenario({mode:'AUTO',inputType:'TOPIC'});},240000);
