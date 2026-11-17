import { apiErrorSchema, validationIssueSchema } from '@video-studio/contracts';
import { z } from 'zod';

export class ApiFailure extends Error {
  constructor(public readonly status: number, message: string, public readonly fields: string[] = []) { super(message); }
}
export async function api<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...init.headers } });
  } catch { throw new ApiFailure(0, 'Sin conexión. Conserva tus cambios y vuelve a intentar.'); }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(data && typeof data === 'object' && 'error' in data ? { error: data.error } : data);
    const issues = z.array(validationIssueSchema).safeParse(parsed.success ? parsed.data.error.details?.issues : null);
    throw new ApiFailure(response.status, parsed.success ? parsed.data.error.message : 'No se pudo completar la operación.',
      issues.success ? issues.data.map((item) => item.path.join('.')) : []);
  }
  return schema.parse(data);
}
