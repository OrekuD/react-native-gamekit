export interface CoverageTrio {
  readonly hit: number;
  readonly total: number;
  readonly percent: number;
}
export interface FileCoverage {
  readonly lines: CoverageTrio;
  readonly branches: CoverageTrio | null;
  readonly functions: CoverageTrio | null;
}
export function parseLcov(text: string): Map<string, FileCoverage>;
export function checkGate(
  coverage: Map<string, FileCoverage>,
  tracked: ReadonlyArray<{ readonly path: string; readonly min: number }>,
): { readonly ok: boolean; readonly lines: string[] };
