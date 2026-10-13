import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  it("accepte un chemin interne, avec ou sans paramètres", () => {
    expect(safeRedirectPath("/prospects")).toBe("/prospects");
    expect(safeRedirectPath("/comptes?page=2&tri=nom")).toBe("/comptes?page=2&tri=nom");
  });

  it("utilise le repli pour une valeur absente ou non textuelle", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(42)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
  });

  it.each([
    "https://exemple.com",
    "http://exemple.com/x",
    "//exemple.com",
    "/\\exemple.com",
    "javascript:alert(1)",
    "prospects",
    "/ok\nSet-Cookie: a=b",
  ])("refuse la redirection ouverte %j", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });

  it("utilise le repli fourni", () => {
    expect(safeRedirectPath("https://exemple.com", "/accueil")).toBe("/accueil");
  });
});
