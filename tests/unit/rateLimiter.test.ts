import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/rateLimit/RateLimiter.js";

describe("RateLimiter", () => {
  it("enforces token bucket and concurrency", async () => {
    const rl = new RateLimiter({
      tiny: { capacity: 2, refillPerMinute: 0, maxConcurrent: 2 },
    });
    const r1 = await rl.acquire({ client: "c", tool: "tiny" });
    const r2 = await rl.acquire({ client: "c", tool: "tiny" });
    await expect(rl.acquire({ client: "c", tool: "tiny" })).rejects.toThrow();
    r1();
    r2();
  });
});
