import { describe, expect, it } from "vitest";
import { PERMISSIONS, can } from "@/lib/auth/permissions";
import { ROLES, toRole } from "@/lib/auth/roles";

describe("permissions", () => {
  it("donne toutes les permissions à l'administrateur", () => {
    for (const permission of PERMISSIONS) {
      expect(can("admin", permission)).toBe(true);
    }
  });

  it("interdit toute écriture au rôle lecture seule / audit", () => {
    expect(can("audit", "prospect:write")).toBe(false);
    expect(can("audit", "user:manage")).toBe(false);
    expect(can("audit", "settings:manage")).toBe(false);
    expect(can("audit", "report:export")).toBe(false);
  });

  it("réserve l'administration des utilisateurs et des paramètres à l'administrateur", () => {
    for (const role of ROLES.filter((r) => r !== "admin")) {
      expect(can(role, "user:manage")).toBe(false);
      expect(can(role, "settings:manage")).toBe(false);
    }
  });

  it("limite la consultation du journal d'audit à l'administrateur et à l'audit", () => {
    expect(can("admin", "audit:read")).toBe(true);
    expect(can("audit", "audit:read")).toBe(true);
    expect(can("commercial", "audit:read")).toBe(false);
    expect(can("manager", "audit:read")).toBe(false);
  });

  it("limite la lecture des comptes et contacts à tous les rôles, et leur écriture aux rôles commerciaux", () => {
    for (const role of ROLES) {
      expect(can(role, "account:read")).toBe(true);
      expect(can(role, "contact:read")).toBe(true);
    }
    expect(can("audit", "account:write")).toBe(false);
    expect(can("audit", "contact:write")).toBe(false);
    for (const role of ["admin", "direction", "manager", "commercial"] as const) {
      expect(can(role, "account:write")).toBe(true);
      expect(can(role, "contact:write")).toBe(true);
    }
  });

  it("donne la lecture des opportunités à tous et l'écriture à tous sauf l'audit", () => {
    for (const role of ["admin", "direction", "manager", "commercial", "audit"] as const) {
      expect(can(role, "opportunity:read")).toBe(true);
    }
    expect(can("audit", "opportunity:write")).toBe(false);
    for (const role of ["admin", "direction", "manager", "commercial"] as const) {
      expect(can(role, "opportunity:write")).toBe(true);
    }
  });

  it("donne la lecture des activités et tâches à tous, l'écriture à tous sauf l'audit", () => {
    for (const role of ["admin", "direction", "manager", "commercial", "audit"] as const) {
      expect(can(role, "activity:read")).toBe(true);
      expect(can(role, "task:read")).toBe(true);
    }
    expect(can("audit", "activity:write")).toBe(false);
    expect(can("audit", "task:write")).toBe(false);
    for (const role of ["admin", "direction", "manager", "commercial"] as const) {
      expect(can(role, "activity:write")).toBe(true);
      expect(can(role, "task:write")).toBe(true);
    }
  });

  it("réserve l'import de données à l'administrateur", () => {
    expect(can("admin", "import:run")).toBe(true);
    for (const role of ["direction", "manager", "commercial", "audit"] as const) {
      expect(can(role, "import:run")).toBe(false);
    }
  });

  it("autorise l'audit et l'administrateur à consulter et exporter le journal, et personne d'autre", () => {
    for (const role of ["admin", "audit"] as const) {
      expect(can(role, "audit:read")).toBe(true);
      expect(can(role, "audit:export")).toBe(true);
    }
    for (const role of ["direction", "manager", "commercial"] as const) {
      expect(can(role, "audit:read")).toBe(false);
      expect(can(role, "audit:export")).toBe(false);
    }
  });

  it("réserve la fusion de doublons à la direction et à l'administrateur (CDC 3.2)", () => {
    expect(can("admin", "account:merge")).toBe(true);
    expect(can("direction", "account:merge")).toBe(true);
    expect(can("manager", "account:merge")).toBe(false);
    expect(can("commercial", "account:merge")).toBe(false);
    expect(can("audit", "account:merge")).toBe(false);
  });

  it("réserve le changement de propriétaire d'un compte aux managers, à la direction et à l'administrateur", () => {
    expect(can("manager", "account:assign")).toBe(true);
    expect(can("direction", "account:assign")).toBe(true);
    expect(can("admin", "account:assign")).toBe(true);
    expect(can("commercial", "account:assign")).toBe(false);
    expect(can("audit", "account:assign")).toBe(false);
  });

  it("autorise le commercial à saisir des prospects mais pas à exporter", () => {
    expect(can("commercial", "prospect:write")).toBe(true);
    expect(can("commercial", "report:export")).toBe(false);
    expect(can("manager", "report:export")).toBe(true);
  });

  it("donne l'accès au tableau de bord à tous les rôles", () => {
    for (const role of ROLES) {
      expect(can(role, "dashboard:read")).toBe(true);
    }
  });
});

describe("toRole", () => {
  it("conserve un rôle connu", () => {
    expect(toRole("manager")).toBe("manager");
  });

  it("ramène un rôle inconnu, vide ou absent au moins privilégié", () => {
    expect(toRole("superuser")).toBe("audit");
    expect(toRole("")).toBe("audit");
    expect(toRole(null)).toBe("audit");
    expect(toRole(undefined)).toBe("audit");
  });
});
