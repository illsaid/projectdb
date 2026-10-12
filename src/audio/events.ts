/**
 * Walks an endless, strictly time-ordered event sequence on the audio clock. Each `pull` fires the
 * events that fall before `until` exactly once; events already in the past are skipped but still
 * counted, so the sequence (and anything derived from an event's index) never depends on when
 * or how often the scheduler is called. Live playback and offline rendering therefore agree.
 */
export class EventScheduler {
  private cursor = 0;

  constructor(private timeOf: (index: number) => number) {}

  pull(now: number, until: number, fire: (time: number, index: number) => void) {
    for (;;) {
      const time = this.timeOf(this.cursor);
      if (time >= until) return;
      if (time >= now) fire(time, this.cursor);
      this.cursor++;
    }
  }
}
