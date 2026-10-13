export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

/** Mutable clock for deterministic expiry/deadline tests. */
export class TestClock implements Clock {
  constructor(private t: number) {}
  now(): Date {
    return new Date(this.t);
  }
  set(iso: string): void {
    this.t = Date.parse(iso);
  }
  advanceMs(ms: number): void {
    this.t += ms;
  }
}
export const iso = (d: Date): string => d.toISOString();
