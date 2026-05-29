import { ZodError } from "zod";
import { AppError } from "./AppError.js";

export function mapMcpError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError("INVALID_INPUT", "Input failed schema validation", {
      issues: err.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AppError("INTERNAL_ERROR", message);
}
