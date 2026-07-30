import Bug from 'lucide-solid/icons/bug';
import CircleStop from 'lucide-solid/icons/circle-stop';
import Clipboard from 'lucide-solid/icons/clipboard';
import Download from 'lucide-solid/icons/download';
import Flag from 'lucide-solid/icons/flag';
import Radio from 'lucide-solid/icons/radio';
import Trash2 from 'lucide-solid/icons/trash-2';
import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
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
  const [open, setOpen] = createSignal(false);
  const [advanced, setAdvanced] = createSignal(false);
  const [state, setState] = createSignal<TReproductionTraceState>(
    props.trace.state(),
  );
  const [channels, setChannels] = createSignal<readonly TReproductionTraceChannel[]>(
    REPRODUCTION_TRACE_SMART_CHANNELS,
  );
  let releaseTrace: (() => void) | null = null;
  let elapsedTimer: number | null = null;

  onMount(() => {
    releaseTrace = props.trace.subscribe(setState);
    elapsedTimer = window.setInterval(() => {
      if (props.trace.isRecording()) setState(props.trace.state());
    }, 250);
  });
  onCleanup(() => {
    releaseTrace?.();
    if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
  });

  const toggleChannel = (channel: TReproductionTraceChannel) => {
    setChannels((current) => (
      current.includes(channel)
        ? current.filter((entry) => entry !== channel)
        : Object.freeze([...current, channel].sort())
    ));
  };
  const copy = () => {
    void props.trace.copy()
      .then((copied) => {
        if (copied) props.onCopied();
      })
      .catch(props.onError);
  };
  const download = () => {
    try {
      props.trace.download();
    } catch (error) {
      props.onError(error);
    }
  };

  return (
    <>
      <div class="vc-canvas-toolbar-divider" />
      <div class="vc-trace-control">
        <button
          type="button"
          class="vc-toolbar-button vc-trace-button"
          classList={{
            'vc-trace-button--recording': state().status === 'recording',
            'vc-trace-button--marked': state().status === 'marked',
            'vc-toolbar-button--active': open(),
          }}
          aria-label={`Developer trace: ${state().status}`}
          aria-expanded={open()}
          title="Developer reproduction trace"
          onClick={() => setOpen((value) => !value)}
        >
          <span class="vc-toolbar-button__icon">
            <Show when={state().status !== 'recording'} fallback={<Radio size={14} />}>
              <Bug size={14} />
            </Show>
          </span>
        </button>
        <Show when={open()}>
          <section
            class="vc-trace-panel"
            aria-label="Developer reproduction trace"
            on:pointerdown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong>DEV TRACE</strong>
                <span class={`vc-trace-status vc-trace-status--${state().status}`}>
                  {state().status}
                </span>
              </div>
              <time>{formatElapsed(state().elapsedMs)}</time>
            </header>
            <Show when={state().status === 'idle'}>
              <div class="vc-trace-actions">
                <button
                  type="button"
                  disabled={!state().canStart || channels().length === 0}
                  onClick={() => props.trace.start(
                    channels(),
                    advanced() ? 'advanced' : 'smart',
                  )}
                >
                  <Radio size={13} /> Record
                </button>
              </div>
              <div class="vc-trace-mode">
                <button
                  type="button"
                  classList={{ active: !advanced() }}
                  onClick={() => {
                    setAdvanced(false);
                    setChannels(REPRODUCTION_TRACE_SMART_CHANNELS);
                  }}
                >
                  Smart
                </button>
                <button
                  type="button"
                  classList={{ active: advanced() }}
                  onClick={() => setAdvanced(true)}
                >
                  Advanced
                </button>
              </div>
              <p class="vc-trace-mode-description">
                <Show
                  when={!advanced()}
                  fallback="Selected raw technical channels."
                >
                  Causal transitions only. Motion is represented by gesture
                  start and outcome.
                </Show>
              </p>
              <Show when={advanced()}>
                <fieldset class="vc-trace-channels">
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
              <div class="vc-trace-actions">
                <button type="button" onClick={() => props.trace.stop()}>
                  <CircleStop size={13} /> Stop
                </button>
                <button
                  type="button"
                  disabled={!state().canMark}
                  onClick={() => props.trace.mark()}
                >
                  <Flag size={13} /> Mark Failure
                </button>
              </div>
            </Show>
            <Show when={state().status === 'marked'}>
              <div class="vc-trace-actions">
                <button type="button" onClick={() => props.trace.stop()}>
                  <CircleStop size={13} /> Stop now
                </button>
                <span class="vc-trace-tail-note" aria-live="polite">
                  Capturing 5s tail…
                </span>
              </div>
            </Show>
            <Show when={state().status !== 'idle'}>
              <dl class="vc-trace-metrics">
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
                  onClick={() => props.trace.clear()}
                >
                  <Trash2 size={13} /> Clear
                </button>
              </footer>
              <p class="vc-trace-new-hint">
                Clear to record again.
              </p>
            </Show>
          </section>
        </Show>
      </div>
    </>
  );
}
