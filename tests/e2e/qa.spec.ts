import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.use({baseURL:'http://127.0.0.1:4174',storageState:process.env.VIDEO_STUDIO_E2E_MEDIA_STATE});
test('F6-03 · QA explícito habilita render, advertencias e histórico accesibles',async({page})=>{
  const id='00000000-0000-4000-8000-00000000a540';const headers={origin:'http://127.0.0.1:4174','idempotency-key':crypto.randomUUID()};
  const saved=await page.request.post(`/api/v1/projects/${id}/manifests`,{headers,data:{expectedRevision:1}});expect(saved.status()).toBe(201);const candidate=await saved.json() as {versionId:string;revision:number};expect((await page.request.post(`/api/v1/projects/${id}/manifests/${candidate.versionId}/activate`,{headers:{...headers,'idempotency-key':crypto.randomUUID()},data:{expectedRevision:candidate.revision,acknowledgeImpact:true}})).status()).toBe(200);
  await page.goto(`/projects/${id}/render`);await expect(page.getByRole('button',{name:'Solicitar render local'})).toBeDisabled();
  await page.goto(`/projects/${id}/qa`);await page.getByRole('button',{name:'Analizar snapshot'}).click();await page.getByRole('button',{name:'Confirmar QA'}).click();await expect(page.getByRole('heading',{name:'Informe v1 · Antes del render'})).toBeVisible();await expect(page.getByText('Pendiente de revisión editorial',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Aprobar QA editorial'})).toBeDisabled();
  await page.getByRole('checkbox',{name:'He revisado contenido',exact:false}).check();await page.getByRole('button',{name:'Aprobar QA editorial'}).click();await page.getByRole('button',{name:'Confirmar QA'}).click();await expect(page.getByRole('status').filter({hasText:'QA aprobado para este snapshot.'})).toBeVisible();
  await page.reload();await expect(page.getByText('QA aprobado para este snapshot.')).toBeVisible();expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto(`/projects/${id}/render`);await expect(page.getByRole('button',{name:'Solicitar render local'})).toBeEnabled();
});
