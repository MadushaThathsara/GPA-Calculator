/**
 * engine/gradePoints.ts
 *
 * Looks up the grade-point value for a letter grade using a university config.
 * Per spec §4, Table 1.
 */
import type { Grade, GradeScale } from '../rules/schema';

/**
 * Returns the grade-point value for the given grade.
 * @throws if the grade is not present in the scale.
 */
export function gradePoints(grade: Grade, scale: GradeScale): number {
  const points = scale[grade];
  // TypeScript ensures Grade is a valid key, but explicit check for safety
  if (points === undefined) {
    throw new Error(`Unknown grade "${grade}" not found in grade scale`);
  }
  return points;
}
