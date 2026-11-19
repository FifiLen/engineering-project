/**
 * Deterministyczny generator liczb pseudolosowych dla danych historycznych (ADR 0075): mulberry32 z ziarna, więc
 * ten sam przebieg daje te same dane i te same liczby w raportach. Wszystkie losowania generatora idą przez tę klasę.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Liczba z przedziału [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Liczba całkowita z przedziału [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('Random.pick: pusta lista');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Indeks według wag (wagi nieujemne, suma dodatnia). */
  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    return items[this.weightedIndex(items.map(([, w]) => w))]![0];
  }

  /** Rozkład normalny (Box–Muller). */
  normal(mean: number, sd: number): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Rozkład logarytmicznie normalny z medianą `median` i rozrzutem `sigma` (w skali logarytmu). */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }

  /** Czas do zdarzenia w procesie Poissona o średniej `mean`. */
  exponential(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }
}
