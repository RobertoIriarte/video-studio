import { createApp } from './app.js';
import type { ApiBindings } from './app.js';
import { advanceCoordinator } from './coordinator.js';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_event, env) {
    if (env.APP_ENV !== 'local' || !env.DB) return;
    await advanceCoordinator(env.DB);
  },
} satisfies ExportedHandler<ApiBindings>;
