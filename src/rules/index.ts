/**
 * rules/index.ts
 *
 * Entry point for the university rule-set module.
 * Exports the config schema, validator, and the bundled university configs.
 *
 * Per spec §14: "rules/ holds one config file per university plus a schema and validator."
 */
export type { UniversityConfig } from './schema';
export { validateConfig } from './validator';
