/**
 * engine/classification.ts
 *
 * Degree classification from CGPA using the classification bands from spec §4.
 *
 * | Classification        | CGPA          |
 * |-----------------------|---------------|
 * | First Class           | 3.70 and above|
 * | Second Class (Upper)  | 3.30 and above|
 * | Second Class (Lower)  | 3.00 and above|
 * | Pass                  | 2.00 and above|
 *
 * Returns the highest applicable threshold (first match when bands are sorted
 * from highest to lowest minCgpa, as required by the config schema).
 */
import type { ClassificationBand } from '../rules/schema';

/**
 * Returns the classification label for a given CGPA.
 * Returns null when CGPA falls below every band (e.g. < 2.00).
 *
 * @param cgpa - The calculated CGPA value.
 * @param bands - Array of bands sorted highest minCgpa first (per schema).
 */
export function classify(cgpa: number, bands: ClassificationBand[]): string | null {
  for (const band of bands) {
    if (cgpa >= band.minCgpa) {
      return band.label;
    }
  }
  return null;
}
