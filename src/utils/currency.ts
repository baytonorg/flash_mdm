export function parseMajorInputToMinorUnits(input: string): number {
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}
