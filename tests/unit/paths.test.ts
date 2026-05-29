import { describe, expect, it } from "vitest";
import { ensureSafeBasename, safeJoinUnderRoot } from "../../src/utils/paths.js";

describe("paths", () => {
  it("rejects path traversal", () => {
    expect(() => safeJoinUnderRoot("/tmp/root", "../escape.glb")).toThrow();
    expect(() => safeJoinUnderRoot("/tmp/root", "/etc/passwd")).toThrow();
  });

  it("accepts a safe filename", () => {
    expect(safeJoinUnderRoot("/tmp/root", "scene.glb")).toBe("/tmp/root/scene.glb");
  });

  it("rejects unsafe basenames", () => {
    expect(() => ensureSafeBasename("../x")).toThrow();
    expect(() => ensureSafeBasename("a/b")).toThrow();
    expect(ensureSafeBasename("scene_v1.glb")).toBe("scene_v1.glb");
  });
});
