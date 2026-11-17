import { z } from 'zod';
import {
  paginationQuerySchema, projectDtoSchema, projectInputSchema, projectSettingsSchema,
  revisionSchema, utcTimestampSchema, uuidSchema,
} from '@video-studio/contracts';
import type { ProjectDto, ProjectInput, ProjectSettings } from '@video-studio/contracts';
import type { Database } from './connection.js';

export class RepositoryDataError extends Error {
  constructor() {
    super('REPOSITORY_DATA_INVALID');
    this.name = 'RepositoryDataError';
  }
}

const userRowSchema = z.object({
  id: uuidSchema, name: z.string(), email: z.email(), emailVerified: z.union([z.literal(0), z.literal(1)]),
  image: z.string().nullable(),
});

export class UserRepository {
  constructor(private readonly db: Database) {}

  // Solo lectura de identidad. Alta, sesión y credenciales pertenecen a Better Auth.
  async getById(id: string) {
    const row = await this.db.prepare('SELECT id,name,email,emailVerified,image FROM "user" WHERE id = ?')
      .bind(uuidSchema.parse(id)).first();
    if (row === null) return null;
    const parsed = userRowSchema.safeParse(row);
    if (!parsed.success) throw new RepositoryDataError();
    return { ...parsed.data, emailVerified: parsed.data.emailVerified === 1 };
  }
}

const rowSchema = z.object({
  id: z.string(), title: z.string(), input_type: z.string(), mode: z.string(),
  status: z.string(), revision: z.number(), created_at: z.string(), updated_at: z.string(),
  language: z.string(), audience: z.string(), objective: z.string(), target_duration_ms: z.number(),
  style: z.string(), style_version: revisionSchema, modality: z.string(),
  checkpoint_policy_json: z.string(), provider_policy_json: z.string(),
  budget_currency: z.string(), max_cost_micros: z.number(), storage_policy_json: z.string(),
  settings_revision: revisionSchema,
});

const projectSelect = (withInput = false) => `SELECT p.id,p.title,p.input_type,${withInput ? 'p.input_text,' : ''}p.mode,p.status,p.revision,p.created_at,p.updated_at,
  s.language,s.audience,s.objective,s.target_duration_ms,s.style,s.style_version,s.modality,
  s.checkpoint_policy_json,s.provider_policy_json,s.budget_currency,s.max_cost_micros,s.storage_policy_json,
  s.revision AS settings_revision
  FROM projects p LEFT JOIN project_settings s ON s.project_id = p.id`;

export type StoredProject = { project: ProjectDto; inputText: string; settingsRevision: number };

function decodeProject(raw: unknown): Omit<StoredProject, 'inputText'> {
  try {
    const row = rowSchema.parse(raw);
    const settings = projectSettingsSchema.parse({
      language: row.language, audience: row.audience, objective: row.objective,
      targetDurationMs: row.target_duration_ms, style: row.style, modality: row.modality, mode: row.mode,
      checkpoints: JSON.parse(row.checkpoint_policy_json) as unknown,
      providerPolicy: JSON.parse(row.provider_policy_json) as unknown,
      budget: { currency: row.budget_currency, maxMicros: row.max_cost_micros },
    });
    z.record(z.string(), z.unknown()).parse(JSON.parse(row.storage_policy_json) as unknown);
    const project = projectDtoSchema.parse({
      id: row.id, title: row.title, inputType: row.input_type, status: row.status, revision: row.revision,
      settings, createdAt: row.created_at, updatedAt: row.updated_at,
    });
    return { project, settingsRevision: row.settings_revision };
  } catch {
    // No propagar payload persistido, stack de Zod ni secretos en un error de lectura.
    throw new RepositoryDataError();
  }
}

export type ProjectCursor = { updatedAt: string; id: string };

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  async page(ownerId: string, options: { limit: number; q?: string | undefined; status?: string | undefined; after?: ProjectCursor | undefined }) {
    const owner = uuidSchema.parse(ownerId); const { limit } = paginationQuerySchema.parse({ limit: options.limit });
    const after = options.after;
    if (after) { uuidSchema.parse(after.id); utcTimestampSchema.parse(after.updatedAt); }
    const q = z.string().max(200).parse(options.q ?? ''); const status = options.status ?? '';
    const result = await this.db.prepare(`${projectSelect()} WHERE p.owner_id=? AND p.archived_at IS NULL
      AND (?='' OR instr(lower(p.title),lower(?))>0) AND (?='' OR p.status=?)
      ${after ? 'AND (p.updated_at < ? OR (p.updated_at = ? AND p.id < ?))' : ''}
      ORDER BY p.updated_at DESC,p.id DESC LIMIT ?`)
      .bind(owner, q, q, status, status, ...(after ? [after.updatedAt, after.updatedAt, after.id] : []), limit + 1).all();
    const items = result.results.slice(0, limit).map((row) => decodeProject(row).project);
    const last = items.at(-1);
    return { items, after: result.results.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null };
  }

  async summary(ownerId: string, projectId: string) {
    const row = await this.db.prepare(`${projectSelect()} WHERE p.owner_id = ? AND p.id = ? AND p.archived_at IS NULL`)
      .bind(uuidSchema.parse(ownerId), uuidSchema.parse(projectId)).first();
    return row ? decodeProject(row).project : null;
  }

  async create(ownerId: string, raw: ProjectInput, context: { id: string; now: string }): Promise<StoredProject> {
    const owner = uuidSchema.parse(ownerId);
    const id = uuidSchema.parse(context.id);
    const now = new Date(utcTimestampSchema.parse(context.now)).toISOString();
    const input = projectInputSchema.parse(raw);
    const settings = input.settings;
    await this.db.batch([
      this.db.prepare(`INSERT INTO projects
        (id,owner_id,title,input_type,input_text,mode,status,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'DRAFT',1,?,?)`)
        .bind(id, owner, input.title, input.inputType, input.inputText, settings.mode, now, now),
      this.db.prepare(`INSERT INTO project_settings
        (project_id,language,audience,objective,target_duration_ms,style,modality,
        checkpoint_policy_json,provider_policy_json,budget_currency,max_cost_micros)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, settings.language, settings.audience, settings.objective, settings.targetDurationMs,
          settings.style, settings.modality, JSON.stringify(settings.checkpoints), JSON.stringify(settings.providerPolicy),
          settings.budget.currency, settings.budget.maxMicros),
    ]);
    return {
      project: projectDtoSchema.parse({ id, title: input.title, inputType: input.inputType, status: 'DRAFT',
        revision: 1, settings, createdAt: now, updatedAt: now }),
      inputText: input.inputText, settingsRevision: 1,
    };
  }

  async get(ownerId: string, projectId: string): Promise<StoredProject | null> {
    const row = await this.db.prepare(`${projectSelect(true)} WHERE p.owner_id = ? AND p.id = ? AND p.archived_at IS NULL`)
      .bind(uuidSchema.parse(ownerId), uuidSchema.parse(projectId)).first();
    if (row === null) return null;
    try {
      const inputText = z.object({ input_text: projectInputSchema.shape.inputText }).parse(row).input_text;
      return { ...decodeProject(row), inputText };
    } catch {
      throw new RepositoryDataError();
    }
  }

  async list(ownerId: string, options: { limit?: number; after?: ProjectCursor } = {}): Promise<ProjectDto[]> {
    const owner = uuidSchema.parse(ownerId);
    const { limit } = paginationQuerySchema.parse({ limit: options.limit });
    const after = options.after ? {
      id: uuidSchema.parse(options.after.id),
      updatedAt: new Date(utcTimestampSchema.parse(options.after.updatedAt)).toISOString(),
    } : undefined;
    const cursorClause = after ? 'AND (p.updated_at < ? OR (p.updated_at = ? AND p.id < ?))' : '';
    const values: unknown[] = after ? [owner, after.updatedAt, after.updatedAt, after.id, limit] : [owner, limit];
    const result = await this.db.prepare(`${projectSelect()} WHERE p.owner_id = ? AND p.archived_at IS NULL
      ${cursorClause} ORDER BY p.updated_at DESC,p.id DESC LIMIT ?`).bind(...values).all();
    return result.results.map((row) => decodeProject(row).project);
  }
}

export class SettingsRepository {
  constructor(private readonly db: Database) {}

  async get(ownerId: string, projectId: string): Promise<{ settings: ProjectSettings; revision: number } | null> {
    const row = await this.db.prepare(`${projectSelect()} WHERE p.owner_id = ? AND p.id = ? AND p.archived_at IS NULL`)
      .bind(uuidSchema.parse(ownerId), uuidSchema.parse(projectId)).first();
    if (row === null) return null;
    const stored = decodeProject(row);
    return { settings: stored.project.settings, revision: stored.settingsRevision };
  }
}
