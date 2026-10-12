import type { FeatureMap } from './features';

type Listener = (features: FeatureMap) => void;

/** Publishes the engine's per-node features once per animation frame while anyone is listening. */
export class FeatureBus {
  private listeners = new Set<Listener>();
  private raf = 0;

  constructor(private compute: () => FeatureMap) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.loop();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) cancelAnimationFrame(this.raf);
    };
  }

  close() {
    this.listeners.clear();
    cancelAnimationFrame(this.raf);
  }

  private loop = () => {
    const features = this.compute();
    for (const l of this.listeners) l(features);
    this.raf = requestAnimationFrame(this.loop);
  };
}
