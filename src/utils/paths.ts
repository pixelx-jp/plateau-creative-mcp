import path from "node:path";
import { AppError } from "../errors/AppError.js";

const SAFE_BASENAME_RE = /^[A-Za-z0-9._-]+$/;

export function safeJoinUnderRoot(rootDir: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(rootDir);
  const joined = path.resolve(resolvedRoot, ...parts);
  if (joined !== resolvedRoot && !joined.startsWith(resolvedRoot + path.sep)) {
    throw new AppError("PATH_SECURITY_ERROR", "Resolved path escapes output directory", {
      root: resolvedRoot,
      attempted: joined,
    });
  }
  return joined;
}

export function ensureSafeBasename(name: string): string {
  if (!SAFE_BASENAME_RE.test(name) || name.length > 128) {
    throw new AppError("PATH_SECURITY_ERROR", "Unsafe output filename", { name });
  }
  return name;
}
