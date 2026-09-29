/** Preserve valid zero while preventing blank numeric editor values from becoming zero. */
export function parseNumericConditionValue(raw: string): number {
  if (!raw.trim() || !Number.isFinite(Number(raw))) throw new TypeError('Enter a numeric condition value.');
  return Number(raw);
}
