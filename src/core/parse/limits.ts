// Starting values. Tuned against real timings, see docs/ARCHITECTURE.md section 1.
export const LIMITS = {
  bytes: 5 * 1024 * 1024,
  elements: 20_000,
  depth: 64,
  // Elements after every <use> is expanded. Stops a few hundred nested <use> rendering billions of shapes.
  expanded: 200_000,
  optimiseMs: 10_000,
} as const;

export type PipelineErrorCode = 'too-large' | 'too-many-elements' | 'too-deep' | 'not-svg' | 'timeout';

export class PipelineError extends Error {
  code: PipelineErrorCode;
  constructor(code: PipelineErrorCode, message: string) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
  }
}
