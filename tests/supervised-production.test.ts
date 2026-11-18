import { beforeAll, afterAll, it } from 'vitest';
import { prepareProductionScenario, disposeProductionScenario, runProductionScenario } from './support/production-scenario.js';
let ready=false;
beforeAll(async()=>{ready=await prepareProductionScenario();},200000);
afterAll(disposeProductionScenario);
for(const inputType of ['SCRIPT','SOURCES'] as const)it(`T24 · ${inputType} supervisado, importar, pausar, corregir escena y reanudar hasta MP4`,async({skip})=>{if(!ready)skip();await runProductionScenario({mode:'SUPERVISED',inputType,recover:true});},240000);
