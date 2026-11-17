// Subconjunto estructural de D1: evita filtrar tipos globales Worker a tests Node.
// createRepositories comprueba su compatibilidad con el D1Database nativo.
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Database {
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}
