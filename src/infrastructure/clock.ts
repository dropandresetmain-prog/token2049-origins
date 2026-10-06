export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Test clock; time only moves when told to. */
export class ManualClock implements Clock {
  constructor(private t: number = Date.parse('2026-10-06T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(iso: string): void {
    this.t = Date.parse(iso);
  }
}

export const iso = (d: Date): string => d.toISOString();
