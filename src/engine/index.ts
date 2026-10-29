/**
 * engine/index.ts
 *
 * Entry point for the pure-TypeScript rules engine.
 *
 * Per spec §14: "engine/ is pure TypeScript with no browser dependencies:
 * grade points, credits, effective-result selection, SGPA, CGPA, classification."
 *
 * This module is the most heavily tested part of the codebase.
 */
export { gradePoints } from './gradePoints';
export { creditFromCode } from './credits';
export { effectiveResult, isGradableResit } from './effectiveResult';
export { calculateSgpa, calculateCgpa, formatSgpa } from './gpa';
export { classify } from './classification';
export type { EffectiveResultInput, EffectiveResult } from './effectiveResult';
export type { GpaInput, GpaResult } from './gpa';
