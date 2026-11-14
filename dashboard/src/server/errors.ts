/** Every API error is sent as { "error": { "code", "message", "details"? } }. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: string[],
    /** Extra top-level response fields sent next to "error" (for example an ingest result). */
    public extra?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: string[] }
}

export function errorBody(code: string, message: string, details?: string[]): ErrorBody {
  return { error: details && details.length ? { code, message, details } : { code, message } }
}
