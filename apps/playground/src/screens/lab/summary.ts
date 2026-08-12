/**
 * Deterministic counter aggregation for the Performance Lab.
 *
 * Pure and platform-neutral: percentiles are computed from recorded samples
 * so the lab can aggregate on either runtime and transfer summaries at most
 * once per second without losing data.
 */

export interface SeriesSnapshot {
  readonly count: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  // Nearest-rank percentile: the value at the rounded-up rank.
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

/** A named series of recorded samples with running statistics. */
export class CounterSeries {
  readonly #samples: number[] = [];

  record(value: number): void {
    this.#samples.push(value);
  }

  get count(): number {
    return this.#samples.length;
  }

  snapshot(): SeriesSnapshot {
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const count = sorted.length;
    if (count === 0) {
      return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    }
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
      count,
      mean: sum / count,
      min: sorted[0] ?? 0,
      max: sorted[count - 1] ?? 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }

  reset(): void {
    this.#samples.length = 0;
  }
}

/** Named counter and duration series, plus simple event counters. */
export class PerfSummary {
  readonly #series = new Map<string, CounterSeries>();
  readonly #counters = new Map<string, number>();

  /** Record a duration or value sample into a named series. */
  record(name: string, value: number): void {
    let series = this.#series.get(name);
    if (series === undefined) {
      series = new CounterSeries();
      this.#series.set(name, series);
    }
    series.record(value);
  }

  /** Increment a named event counter. */
  count(name: string, amount = 1): void {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + amount);
  }

  getCounter(name: string): number {
    return this.#counters.get(name) ?? 0;
  }

  /** Read every named series, sorted by name for stable output. */
  seriesSnapshot(): ReadonlyMap<string, SeriesSnapshot> {
    const result = new Map<string, SeriesSnapshot>();
    for (const name of [...this.#series.keys()].sort()) {
      result.set(name, this.#series.get(name)!.snapshot());
    }
    return result;
  }

  reset(): void {
    this.#series.clear();
    this.#counters.clear();
  }
}
