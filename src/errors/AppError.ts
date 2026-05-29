import { type ErrorCode, RETRYABLE_CODES } from "./errorCodes.js";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE_CODES.has(code);
  }

  toPayload() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}
