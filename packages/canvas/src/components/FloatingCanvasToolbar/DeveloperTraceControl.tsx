import {
  For,
  Show,
  createSignal,
  onSettled,
  untrack,
} from 'solid-js';
import {
  BugIcon as Bug,
  CircleStopIcon as CircleStop,
  ClipboardIcon as Clipboard,
  DownloadIcon as Download,
  FlagIcon as Flag,
  RadioIcon as Radio,
  Trash2Icon as Trash2,
} from '../icons';
import {
  REPRODUCTION_TRACE_CHANNELS,
  REPRODUCTION_TRACE_SMART_CHANNELS,
} from '../../debug-trace/CONSTANTS';
import type {
  TReproductionTraceChannel,
  TReproductionTraceOwner,
  TReproductionTraceState,
} from '../../debug-trace/typed';

type TDeveloperTraceControlProps = Readonly<{
  trace: TReproductionTraceOwner;
  onError(error: unknown): void;
  onCopied(): void;
}>;

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  return bytes < 1_024
    ? `${bytes} B`
    : `${(bytes / 1_024).toFixed(1)} KiB`;
}

export function DeveloperTraceControl(props: TDeveloperTraceControlProps) {
  let controlRef!: HTMLDivElement;
  const trace = untrack(() => props.trace);
  const [open, setOpen] = createSignal(false);
  const [advanced, setAdvanced] = createSignal(false);
  // The trace owner is fixed for one mounted control; later updates arrive
  // through its subscription instead of through a live prop seed.
  const [state, setState] = createSignal<TReproductionTraceState>(
    trace.state(),
  );
  const [channels, setChannels] = createSignal<readonly TReproductionTraceChannel[]>(
    REPRODUCTION_TRACE_SMART_CHANNELS,
  );
  onSettled(() => {
    const releaseTrace = trace.subscribe(setState);
    const timerWindow = controlRef.ownerDocument.defaultView;
    const elapsedTimer = timerWindow?.setInterval(() => {
      if (trace.isRecording()) setState(trace.state());
    }, 250) ?? null;
    return () => {
      releaseTrace();
      if (elapsedTimer !== null) timerWindow?.clearInterval(elapsedTimer);
    };
  });

  const toggleChannel = (channel: TReproductionTraceChannel) => {
    setChannels((current) => (
      current.includes(channel)
        ? current.filter((entry) => entry !== channel)
        : Object.freeze([...current, channel].sort())
    ));
  };
  const copy = () => {
    void trace.copy()
      .then((copied) => {
        if (copied) props.onCopied();
      })
      .catch(props.onError);
  };
  const download = () => {
    try {
      trace.download();
    } catch (error) {
      props.onError(error);
    }
  };

  return (
    <>
      <div class="omnidraw-canvas-toolbar-divider" />
      <div ref={controlRef} class="omnidraw-trace-control">
        <button
          type="button"
          class={[
            'omnidraw-toolbar-button',
            'omnidraw-trace-button',
            {
              'omnidraw-trace-button--recording': state().status === 'recording',
              'omnidraw-trace-button--marked': state().status === 'marked',
              'omnidraw-toolbar-button--active': open(),
            },
          ]}
          aria-label={`Developer trace: ${state().status}`}
          aria-expanded={open() ? 'true' : 'false'}
          title="Developer reproduction trace"
          onClick={() => setOpen((value) => !value)}
        >
          <span class="omnidraw-toolbar-button__icon">
            <Show when={state().status !== 'recording'} fallback={<Radio size={14} />}>
              <Bug size={14} />
            </Show>
          </span>
        </button>
        <Show when={open()}>
          <section
            class="omnidraw-trace-panel"
            aria-label="Developer reproduction trace"
          >
            <header>
              <div>
                <strong>DEV TRACE</strong>
                <span class={`omnidraw-trace-status omnidraw-trace-status--${state().status}`}>
                  {state().status}
                </span>
              </div>
              <time>{formatElapsed(state().elapsedMs)}</time>
            </header>
            <Show when={state().status === 'idle'}>
              <div class="omnidraw-trace-actions">
                <button
                  type="button"
                  disabled={!state().canStart || channels().length === 0}
                  onClick={() => trace.start(
                    channels(),
                    advanced() ? 'advanced' : 'smart',
                  )}
                >
                  <Radio size={13} /> Record
                </button>
              </div>
              <div class="omnidraw-trace-mode">
                <button
                  type="button"
                  class={{ active: !advanced() }}
                  onClick={() => {
                    setAdvanced(false);
                    setChannels(REPRODUCTION_TRACE_SMART_CHANNELS);
                  }}
                >
                  Smart
                </button>
                <button
                  type="button"
                  class={{ active: advanced() }}
                  onClick={() => setAdvanced(true)}
                >
                  Advanced
                </button>
              </div>
              <p class="omnidraw-trace-mode-description">
                <Show
                  when={!advanced()}
                  fallback="Selected raw technical channels."
                >
                  Causal transitions only. Motion is represented by gesture
                  start and outcome.
                </Show>
              </p>
              <Show when={advanced()}>
                <fieldset class="omnidraw-trace-channels">
                  <legend>Technical channels</legend>
                  <For each={REPRODUCTION_TRACE_CHANNELS}>
                    {(channel) => (
                      <label>
                        <input
                          type="checkbox"
                          checked={channels().includes(channel)}
                          onChange={() => toggleChannel(channel)}
                        />
                        <span>{channel}</span>
                      </label>
                    )}
                  </For>
                </fieldset>
              </Show>
            </Show>
            <Show when={state().status === 'recording'}>
              <div class="omnidraw-trace-actions">
                <button type="button" onClick={() => trace.stop()}>
                  <CircleStop size={13} /> Stop
                </button>
                <button
                  type="button"
                  disabled={!state().canMark}
                  onClick={() => trace.mark()}
                >
                  <Flag size={13} /> Mark Failure
                </button>
              </div>
            </Show>
            <Show when={state().status === 'marked'}>
              <div class="omnidraw-trace-actions">
                <button type="button" onClick={() => trace.stop()}>
                  <CircleStop size={13} /> Stop now
                </button>
                <span class="omnidraw-trace-tail-note" aria-live="polite">
                  Capturing 5s tail…
                </span>
              </div>
            </Show>
            <Show when={state().status !== 'idle'}>
              <dl class="omnidraw-trace-metrics">
                <div><dd>{state().retainedEvents}</dd><dt>events</dt></div>
                <div><dd>{state().omittedEvents}</dd><dt>dropped</dt></div>
                <div><dd>{formatBytes(state().estimatedBytes)}</dd><dt>raw</dt></div>
              </dl>
            </Show>
            <Show when={state().status === 'stopped'}>
              <footer>
                <button
                  type="button"
                  disabled={!state().canExport}
                  onClick={copy}
                >
                  <Clipboard size={13} /> Copy for Agent
                </button>
                <button
                  type="button"
                  disabled={!state().canExport}
                  onClick={download}
                >
                  <Download size={13} /> JSONL
                </button>
                <button
                  type="button"
                  disabled={!state().canClear}
                  onClick={() => trace.clear()}
                >
                  <Trash2 size={13} /> Clear
                </button>
              </footer>
              <p class="omnidraw-trace-new-hint">
                Clear to record again.
              </p>
            </Show>
          </section>
        </Show>
      </div>
    </>
  );
}
