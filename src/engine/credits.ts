/**
 * engine/credits.ts
 *
 * Extracts GPA credit value from a module code.
 *
 * Per spec §4: "GPA credits equal the last digit of the module code."
 * Space normalization is required: "IIC 2242" → "IIC2242" → last digit 2.
 * Examples: IN3462 → 2, IC3433 → 3, IC3341 → 1, IIC 2242 → 2.
 *
 * If the last digit is 0 or not a digit, returns null (caller prompts manual entry).
 * Per spec assumption A1.
 */

/**
 * Normalises a module code by removing all whitespace, then extracts the
 * last digit as the GPA credit value.
 *
 * @returns The credit value (1–9), or null when manual entry is required.
 */
export function creditFromCode(moduleCode: string): number | null {
  // Normalize: remove spaces (handles "IIC 2242" → "IIC2242")
  const normalized = moduleCode.replace(/\s+/g, '');
  const lastChar = normalized.charAt(normalized.length - 1);

  if (lastChar === undefined) return null;

  const digit = parseInt(lastChar, 10);
  // Return null for 0 (non-usable) or non-digit
  if (isNaN(digit) || digit === 0) return null;

  return digit;
}
