import { Buffer } from 'node:buffer';
import process from 'node:process';
import typescript from 'typescript';
import { WIDGET_TYPESCRIPT_MAX_DIAGNOSTIC_LENGTH } from './CONSTANTS';
import { fxTypecheckWidgetSnapshot } from './fx.typecheck-widget-snapshot';
import type {
  TWidgetTypecheckRequestMessage,
  TWidgetTypecheckWorkerMessage,
} from './widget-typecheck-protocol';

function decodeBase64(value: string): Uint8Array {
  if (
    value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new Error('Widget TypeScript worker received invalid source bytes.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new Error('Widget TypeScript worker received non-canonical source bytes.');
  }
  return new Uint8Array(bytes);
}

function boundedMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WIDGET_TYPESCRIPT_MAX_DIAGNOSTIC_LENGTH)
    || 'Widget TypeScript validation failed.';
}

export function runWidgetTypecheckWorker(): void {
  if (typeof process.send !== 'function') {
    throw new Error('Widget TypeScript worker requires a host-owned Bun IPC channel.');
  }
  const send = (message: TWidgetTypecheckWorkerMessage) => process.send!(message);
  let accepted = false;
  process.on('message', (raw: unknown) => {
    const message = raw as TWidgetTypecheckRequestMessage;
    if (accepted || message.type !== 'validate') return;
    accepted = true;
    try {
      const assertCompilerBudget = () => {
        if (Date.now() >= message.limits.deadlineAtMs) {
          throw new Error('Widget TypeScript validation exceeded its deadline.');
        }
        if (process.memoryUsage().rss > message.limits.memoryLimitBytes) {
          throw new Error('Widget TypeScript validation exceeded its memory limit.');
        }
      };
      const diagnostics = fxTypecheckWidgetSnapshot({
        typescript,
        decodeUtf8: (bytes) => Buffer.from(bytes).toString('utf8'),
        assertCompilerBudget,
      }, {
        snapshot: {
          ...message.snapshot,
          files: message.snapshot.files.map((file) => Object.freeze({
            path: file.path,
            bytes: decodeBase64(file.bytesBase64),
          })),
        },
      });
      send({ type: 'result', requestId: message.requestId, diagnostics });
    } catch (error) {
      send({
        type: 'failure',
        requestId: message.requestId,
        message: boundedMessage(error),
      });
    }
  });
  process.on('disconnect', () => process.exit(0));
  send({ type: 'ready' });
}

if (import.meta.main) runWidgetTypecheckWorker();
