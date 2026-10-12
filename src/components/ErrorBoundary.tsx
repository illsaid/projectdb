import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { AudioWaveform, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';

interface Props {
  /** `recovered` is true after the listener pressed Recover, so the app may restart audio at once. */
  children(recovered: boolean): ReactNode;
}

interface State {
  error: Error | null;
  generation: number;
  recoveredAt: number;
}

/** A second crash this soon after Recover suggests the drift itself trips the bug. */
const REPEAT_MS = 8000;

/**
 * Catches render crashes anywhere in the app. Recover remounts everything, which rebuilds the
 * audio engine and regenerates the drift from the ID in the address bar; the library lives in
 * IndexedDB, so nothing kept is lost.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, generation: 0, recoveredAt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Driftbox crashed', error, info.componentStack);
  }

  private recover = () => {
    this.setState((s) => ({ error: null, generation: s.generation + 1, recoveredAt: Date.now() }));
  };

  private startFresh = () => {
    history.replaceState(null, '', location.pathname + location.search);
    this.recover();
  };

  render() {
    const { error, generation, recoveredAt } = this.state;
    if (!error) return <Fragment key={generation}>{this.props.children(generation > 0)}</Fragment>;

    const repeated = recoveredAt > 0 && Date.now() - recoveredAt < REPEAT_MS;
    const hasDrift = location.hash.length > 1;
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-ink-950 px-6 text-ink-100">
        <div role="alert" className="animate-fade-up w-full max-w-md rounded-lg border border-ink-700 bg-ink-850 p-6 shadow-2xl">
          <div className="mb-4 flex items-center gap-2 text-amber-400">
            <AudioWaveform size={18} strokeWidth={2.25} />
            <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Driftbox stopped</span>
          </div>
          <h1 className="font-display text-3xl leading-tight text-ink-100">Something went wrong.</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-300">
            {repeated
              ? 'It happened again right after recovering, so this drift may be the cause. Starting fresh opens a new drift instead.'
              : 'Recover restarts the sound and visuals and brings back the drift you were on. Your library is safe.'}
          </p>
          <details className="mt-4 rounded border border-ink-700 bg-ink-900 px-3 py-2 text-[11.5px] text-ink-400">
            <summary className="cursor-pointer select-none text-ink-300 hover:text-ink-200">Details</summary>
            <p className="mt-2 break-words font-mono">{error.message || String(error)}</p>
          </details>
          <div className="mt-6 flex flex-wrap gap-2">
            {(!repeated || !hasDrift) && (
              <button
                type="button"
                onClick={this.recover}
                autoFocus
                className="inline-flex h-9 items-center gap-2 rounded bg-amber-400 px-4 text-[13px] font-semibold text-ink-950 transition-colors hover:bg-amber-300"
              >
                <RotateCcw size={14} strokeWidth={2.5} /> Recover
              </button>
            )}
            {hasDrift && (
              <button
                type="button"
                onClick={this.startFresh}
                autoFocus={repeated}
                className={`inline-flex h-9 items-center gap-2 rounded px-4 text-[13px] font-semibold transition-colors ${
                  repeated ? 'bg-amber-400 text-ink-950 hover:bg-amber-300' : 'border border-ink-600 text-ink-200 hover:border-ink-500 hover:bg-ink-800'
                }`}
              >
                <Sparkles size={14} strokeWidth={2.25} /> Start fresh
              </button>
            )}
            <button
              type="button"
              onClick={() => location.reload()}
              className="inline-flex h-9 items-center gap-2 rounded border border-ink-600 px-4 text-[13px] text-ink-300 transition-colors hover:border-ink-500 hover:bg-ink-800 hover:text-ink-200"
            >
              <RefreshCw size={14} strokeWidth={2.25} /> Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
