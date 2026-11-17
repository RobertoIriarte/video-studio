import { z } from 'zod';
import { projectCreateSchema, projectDetailSchema, projectInputSchema, projectPatchSchema, uuidSchema } from '@video-studio/contracts';
import type { ProjectDetail, ProjectPatch } from '@video-studio/contracts';
import type { Database } from './connection.js';
import { ProjectRepository } from './repositories.js';

export class ProjectConflict extends Error {}
export class ProjectCrudRepository {
  constructor(private readonly db: Database) {}

  async receipt(owner: string, operation: string, hash: string) {
    const row = await this.db.prepare('SELECT payload_hash,response_json,http_status FROM project_operations WHERE owner_id = ? AND operation_id = ?')
      .bind(uuidSchema.parse(owner), uuidSchema.parse(operation)).first<{ payload_hash: string; response_json: string; http_status: number }>();
    if (!row) return null;
    if (row.payload_hash !== hash) throw new ProjectConflict();
    return { body: projectDetailSchema.parse(JSON.parse(row.response_json) as unknown), status: row.http_status as 200 | 201 };
  }

  async get(owner: string, id: string): Promise<ProjectDetail | null> {
    const stored = await new ProjectRepository(this.db).get(owner, id);
    if (!stored) return null;
    const row = await this.db.prepare('SELECT wizard_step FROM projects WHERE owner_id = ? AND id = ?').bind(owner, id).first<{ wizard_step: number }>();
    return projectDetailSchema.parse({ ...stored.project, inputText: stored.inputText, wizardStep: row?.wizard_step });
  }

  async create(owner: string, raw: unknown, operation: string, hash: string) {
    uuidSchema.parse(owner); uuidSchema.parse(operation);
    const previous = await this.receipt(owner, operation, hash);
    if (previous) return previous;
    const input = projectCreateSchema.parse(raw);
    const id = crypto.randomUUID(); const now = new Date().toISOString(); const s = input.settings;
    const body = projectDetailSchema.parse({ ...input, id, status: 'DRAFT', revision: 1, createdAt: now, updatedAt: now });
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO projects (id,owner_id,title,input_type,input_text,mode,status,revision,created_at,updated_at,wizard_step)
          VALUES (?,?,?,?,?,?,'DRAFT',1,?,?,?)`).bind(id, owner, input.title, input.inputType, input.inputText, s.mode, now, now, input.wizardStep),
        this.db.prepare(`INSERT INTO project_settings (project_id,language,audience,objective,target_duration_ms,style,modality,
          checkpoint_policy_json,provider_policy_json,budget_currency,max_cost_micros) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(id, s.language, s.audience, s.objective, s.targetDurationMs, s.style, s.modality, JSON.stringify(s.checkpoints), JSON.stringify(s.providerPolicy), s.budget.currency, s.budget.maxMicros),
        this.db.prepare('INSERT INTO project_operations VALUES (?,?,?,?,201)').bind(owner, operation, hash, JSON.stringify(body)),
      ]);
    } catch (error) {
      const replay = await this.receipt(owner, operation, hash);
      if (replay) return replay;
      throw error;
    }
    return { body, status: 201 as const };
  }

  async update(owner: string, id: string, raw: ProjectPatch, archive?: { operation: string; hash: string }): Promise<ProjectDetail | null> {
    const patch = archive ? raw : projectPatchSchema.parse(raw);
    const current = await this.get(owner, id);
    if (!current) return null;
    if (current.revision !== patch.expectedRevision || current.status !== 'DRAFT') throw new ProjectConflict();
    const input = projectInputSchema.parse({ title: patch.title ?? current.title, inputType: patch.inputType ?? current.inputType,
      inputText: patch.inputText ?? current.inputText, settings: patch.settings ?? current.settings });
    const token = crypto.randomUUID(); const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString(); const s = input.settings;
    const body = projectDetailSchema.parse({ ...current, ...input, status: archive ? 'ARCHIVED' : 'DRAFT',
      revision: current.revision + 1, wizardStep: patch.wizardStep ?? current.wizardStep, updatedAt: now });
    const statements = [
      this.db.prepare(`UPDATE projects SET title=?,input_type=?,input_text=?,mode=?,status=?,revision=revision+1,updated_at=?,
        wizard_step=?,mutation_token=?,archived_at=? WHERE id=? AND owner_id=? AND revision=? AND status='DRAFT' AND archived_at IS NULL AND active_script_version_id IS NULL`)
        .bind(body.title, body.inputType, body.inputText, s.mode, body.status, now, body.wizardStep, token, archive ? now : null, id, owner, patch.expectedRevision),
      this.db.prepare(`UPDATE project_settings SET language=?,audience=?,objective=?,target_duration_ms=?,style=?,modality=?,
        checkpoint_policy_json=?,provider_policy_json=?,budget_currency=?,max_cost_micros=?,revision=revision+1
        WHERE project_id=? AND EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=? AND mutation_token=?)`)
        .bind(s.language, s.audience, s.objective, s.targetDurationMs, s.style, s.modality, JSON.stringify(s.checkpoints), JSON.stringify(s.providerPolicy), s.budget.currency, s.budget.maxMicros, id, id, owner, token),
    ];
    if (archive) statements.push(this.db.prepare(`INSERT INTO project_operations SELECT ?,?,?,?,200
      WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=? AND mutation_token=?)`)
      .bind(owner, archive.operation, archive.hash, JSON.stringify(body), id, owner, token));
    let results: unknown;
    try { results = await this.db.batch(statements); }
    catch (error) {
      if (archive) { const replay = await this.receipt(owner, archive.operation, archive.hash); if (replay) return replay.body; }
      throw error;
    }
    const first = z.array(z.object({ meta: z.object({ changes: z.number() }) })).parse(results)[0];
    if (first?.meta.changes !== 1) throw new ProjectConflict();
    return body;
  }
}
