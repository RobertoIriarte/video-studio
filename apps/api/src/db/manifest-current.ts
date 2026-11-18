// GROUP BY in the view preserves the query boundary under D1's expression-depth limit.
export const currentManifestSql = (alias = 'm') => `EXISTS(SELECT 1 FROM current_render_manifests ready WHERE ready.id=${alias}.id)`;
