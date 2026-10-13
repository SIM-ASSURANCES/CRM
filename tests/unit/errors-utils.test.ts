import { describe, expect, it } from "vitest";
import { AppError, errors, toErrorResponse } from "@/lib/errors";
import { initials } from "@/lib/utils";

describe("AppError", () => {
  it("associe chaque code au statut HTTP du cahier des charges (A.4)", () => {
    expect(errors.validation().status).toBe(400);
    expect(errors.unauthenticated().status).toBe(401);
    expect(errors.forbidden().status).toBe(403);
    expect(errors.notFound().status).toBe(404);
    expect(errors.conflict().status).toBe(409);
    expect(errors.rateLimited().status).toBe(429);
  });
});

describe("toErrorResponse", () => {
  it("sérialise une erreur applicative avec son code et son statut", async () => {
    const response = toErrorResponse(errors.forbidden());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("masque les détails d'une erreur inconnue (500 générique)", async () => {
    const response = toErrorResponse(new Error("connexion à postgres://secret échouée"));
    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("secret");
    expect(text).toContain("INTERNAL");
  });

  it("transmet les détails de validation", async () => {
    const response = toErrorResponse(new AppError("VALIDATION", "invalide", { champ: "email" }));
    const body = await response.json();
    expect(body.error.details).toEqual({ champ: "email" });
  });
});

describe("initials", () => {
  it("prend les deux premières initiales", () => {
    expect(initials("Gohore Arnaud")).toBe("GA");
    expect(initials("  marie   claire  dupont ")).toBe("MC");
  });

  it("gère un seul mot et une valeur vide", () => {
    expect(initials("Kassi")).toBe("K");
    expect(initials("   ")).toBe("?");
  });
});
