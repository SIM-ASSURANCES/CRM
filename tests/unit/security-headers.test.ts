import { afterEach, describe, expect, it, vi } from "vitest";

// Audit de sécurité (phase 8) : les en-têtes servis sur toutes les pages. Un changement de `next.config.ts` qui
// affaiblirait la politique (hôte tiers, iframe, <base> détourné…) fait échouer ce test.

async function loadHeaders(nodeEnv: "production" | "development") {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const { default: config } = await import("../../next.config");
  const rules = await config.headers!();
  const all = rules.find((rule) => rule.source === "/:path*");
  expect(all).toBeDefined();
  return new Map(all!.headers.map((h) => [h.key, h.value]));
}

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("en-têtes de sécurité", () => {
  it("production : politique restrictive, aucun hôte tiers, aucun eval", async () => {
    const headers = await loadHeaders("production");
    const csp = directives(headers.get("Content-Security-Policy")!);

    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);

    const raw = headers.get("Content-Security-Policy")!;
    expect(raw).not.toContain("unsafe-eval");
    expect(raw).not.toMatch(/https?:\/\//);
    expect(raw).not.toContain("*");
  });

  it("développement : unsafe-eval et websocket réservés au développement", async () => {
    const headers = await loadHeaders("development");
    const csp = directives(headers.get("Content-Security-Policy")!);
    expect(csp.get("script-src")).toContain("'unsafe-eval'");
    expect(csp.get("connect-src")).toContain("ws:");
    // Les protections contre le détournement restent actives en développement.
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
  });

  it("anti-clickjacking, anti-sniffing, référent et permissions du navigateur", async () => {
    const headers = await loadHeaders("production");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("HSTS en production seulement", async () => {
    const production = await loadHeaders("production");
    expect(production.get("Strict-Transport-Security")).toContain("max-age=63072000");
    const development = await loadHeaders("development");
    expect(development.has("Strict-Transport-Security")).toBe(false);
  });

  it("ne dévoile pas la technologie du serveur", async () => {
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    expect(config.poweredByHeader).toBe(false);
  });
});
