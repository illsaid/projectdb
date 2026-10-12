const WAKE_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const;

/**
 * Opens a live context, or throws a readable error where the modern Web Audio API is missing
 * (Safari before 14.1 only has the prefixed context, without the node constructors the engine uses).
 */
export function createAudioContext(latencyHint: AudioContextLatencyCategory): AudioContext {
  if (typeof AudioContext === 'undefined' || typeof GainNode === 'undefined' || typeof ConstantSourceNode === 'undefined') {
    throw new Error('This browser’s audio support is too old for Driftbox. Update to Safari 14.1 or later, or use Chrome, Edge or Firefox.');
  }
  return new AudioContext({ latencyHint });
}

/**
 * The end of every live signal chain. Audio leaves through a MediaStream played by a hidden
 * <audio> element, which mobile platforms treat as media playback and keep alive with the screen
 * locked; if the element cannot play, it falls back to the context's own speakers. Also resumes
 * the context whenever the page returns or is touched, which covers iOS unlocking and interruptions.
 */
export class AudioOutput {
  readonly master: GainNode;
  private element: HTMLAudioElement | null = null;
  private wanted = true;

  /** Must be constructed inside a user gesture so the element is allowed to start. */
  constructor(readonly ctx: AudioContext) {
    this.master = new GainNode(ctx);
    if (typeof MediaStreamAudioDestinationNode === 'undefined' || typeof document === 'undefined') {
      this.master.connect(ctx.destination);
    } else {
      const stream = new MediaStreamAudioDestinationNode(ctx);
      this.master.connect(stream);
      const element = document.createElement('audio');
      element.hidden = true;
      element.setAttribute('playsinline', '');
      element.srcObject = stream.stream;
      document.body.appendChild(element);
      this.element = element;
      element.play().catch(() => this.useSpeakers());
    }
    document.addEventListener('visibilitychange', this.wake);
    // Safari parks the context in 'interrupted' during calls and Siri, and may leave it suspended after.
    ctx.addEventListener('statechange', this.wake);
    WAKE_EVENTS.forEach((e) => window.addEventListener(e, this.wake, { capture: true, passive: true }));
  }

  get paused() {
    return this.ctx.state !== 'running';
  }

  async setPaused(paused: boolean) {
    this.wanted = !paused;
    if (paused) {
      this.element?.pause();
      await this.ctx.suspend();
    } else {
      await this.ctx.resume();
      await this.element?.play().catch(() => this.useSpeakers());
    }
  }

  /**
   * Schedules a fade to silence ending at audio time `end`. It runs on the audio clock, so it still
   * happens on time when the page is hidden and its timers are throttled.
   */
  scheduleFadeOut(end: number, seconds: number) {
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1, now + 0.5);
    g.setValueAtTime(1, Math.max(now + 0.5, end - seconds));
    g.linearRampToValueAtTime(0, Math.max(now + 0.6, end));
  }

  /** Cancels any scheduled fade and brings the level back to full over half a second. */
  restoreLevel() {
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1, now + 0.5);
  }

  close() {
    document.removeEventListener('visibilitychange', this.wake);
    this.ctx.removeEventListener('statechange', this.wake);
    WAKE_EVENTS.forEach((e) => window.removeEventListener(e, this.wake, { capture: true }));
    this.master.disconnect();
    if (this.element) {
      this.element.pause();
      this.element.srcObject = null;
      this.element.remove();
      this.element = null;
    }
    void this.ctx.close();
  }

  private wake = () => {
    if (!this.wanted || document.visibilityState !== 'visible' || this.ctx.state === 'closed') return;
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    if (this.element?.paused) void this.element.play().catch(() => undefined);
  };

  private useSpeakers() {
    if (!this.element) return;
    this.element.srcObject = null;
    this.element.remove();
    this.element = null;
    this.master.disconnect();
    this.master.connect(this.ctx.destination);
  }
}
