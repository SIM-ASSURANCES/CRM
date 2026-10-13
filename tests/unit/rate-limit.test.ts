import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  const options = { limit: 3, windowMs: 60_000 };

  it("autorise jusqu'à la limite puis refuse", () => {
    expect(rateLimit("k", options, 0).ok).toBe(true);
    expect(rateLimit("k", options, 1).ok).toBe(true);
    expect(rateLimit("k", options, 2).ok).toBe(true);
    const blocked = rateLimit("k", options, 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(59_997);
  });

  it("repart à zéro quand la fenêtre est écoulée", () => {
    for (let i = 0; i < 4; i++) rateLimit("k", options, i);
    expect(rateLimit("k", options, 60_001).ok).toBe(true);
  });

  it("isole les clés les unes des autres", () => {
    for (let i = 0; i < 4; i++) rateLimit("a", options, i);
    expect(rateLimit("a", options, 5).ok).toBe(false);
    expect(rateLimit("b", options, 5).ok).toBe(true);
  });

  it("décompte les tentatives restantes", () => {
    expect(rateLimit("k", options, 0).remaining).toBe(2);
    expect(rateLimit("k", options, 1).remaining).toBe(1);
    expect(rateLimit("k", options, 2).remaining).toBe(0);
  });
});
