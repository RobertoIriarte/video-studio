import { createApp } from './app.js';
import type { ApiBindings } from './app.js';

const app = createApp();

export default { fetch: app.fetch } satisfies ExportedHandler<ApiBindings>;
