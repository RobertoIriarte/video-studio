import { ProjectRepository, SettingsRepository, UserRepository } from './repositories.js';
import { CatalogRepository } from './catalog.js';
import { JobRepository } from './jobs.js';

// Este módulo se compila con los tipos Worker nativos, no se importa en el cliente.
export function createRepositories(db: D1Database) {
  const projects = new ProjectRepository(db);
  return { users: new UserRepository(db), projects, settings: new SettingsRepository(db), catalog: new CatalogRepository(db), jobs: new JobRepository(db) };
}
