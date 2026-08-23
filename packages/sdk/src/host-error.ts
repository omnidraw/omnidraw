import type { TWidgetHostDiagnostic } from './contracts/types';

/** Stable SDK-owned error for browser-host setup and mount failures. */
export class WidgetHostError extends Error {
  readonly code: string;
  readonly diagnostic: TWidgetHostDiagnostic;

  constructor(diagnostic: TWidgetHostDiagnostic, options?: ErrorOptions) {
    super(diagnostic.message, options);
    this.name = 'WidgetHostError';
    this.code = diagnostic.code;
    this.diagnostic = diagnostic;
  }
}
