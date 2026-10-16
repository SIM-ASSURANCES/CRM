import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, phoneSchema } from "@/lib/phone";

// Numéros ivoiriens (10 chiffres depuis 2021, préfixe +225) et internationaux : un seul format enregistré.

const ok = (raw: string) => {
  const result = normalizePhone(raw);
  return result.ok ? result.value : `REFUS:${result.reason}`;
};

describe("normalisation des numéros ivoiriens", () => {
  it("ramène toutes les écritures usuelles au même format", () => {
    for (const raw of [
      "0102030405",
      "01 02 03 04 05",
      "01.02.03.04.05",
      "01-02-03-04-05",
      "01 02 03 04 05 ",
      "(+225) 01 02 03 04 05",
      "+225 01 02 03 04 05",
      "+2250102030405",
      "00225 01 02 03 04 05",
      "002250102030405",
      "225 01 02 03 04 05",
      "2250102030405",
      "+225 (0)1 02 03 04 05",
      "01 02 03 04 05",
    ]) {
      expect(ok(raw), raw).toBe("+2250102030405");
    }
  });

  it("accepte mobiles et fixes sans connaître la liste des préfixes d'opérateur", () => {
    for (const national of ["0102030405", "0505050505", "0707353673", "2721234567", "2523456789", "2123456789"]) {
      expect(ok(national)).toBe(national.startsWith("0") ? `+225${national}` : "REFUS:invalid");
    }
  });

  it("signale (sans convertir) un numéro à 8 chiffres antérieur à 2021 : l'opérateur est inconnu", () => {
    expect(ok("07 35 36 73")).toBe("REFUS:legacy");
    expect(ok("+225 07 35 36 73")).toBe("REFUS:legacy");
    const result = normalizePhone("07353673");
    expect(!result.ok && result.message).toContain("01, 05 ou 07");
  });

  it("refuse les numéros vides, trop courts, trop longs ou contenant des lettres", () => {
    expect(ok("")).toBe("REFUS:empty");
    expect(ok("   ")).toBe("REFUS:empty");
    expect(normalizePhone(null)).toMatchObject({ ok: false, reason: "empty" });
    expect(normalizePhone(undefined)).toMatchObject({ ok: false, reason: "empty" });
    for (const raw of ["123", "010203040", "01020304050", "1234567890", "01 02 03 04 0A", "abc", "+225", "+225 01 02", "tel: 0102030405"]) {
      expect(ok(raw), raw).toMatch(/^REFUS:/);
    }
  });

  it("conserve un numéro international d'un autre pays, en « + » et chiffres", () => {
    expect(ok("+221 77 123 45 67")).toBe("+221771234567");
    expect(ok("00221 77 123 45 67")).toBe("+221771234567");
    expect(ok("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(ok("+1234")).toBe("REFUS:invalid");
    expect(ok("+1234567890123456")).toBe("REFUS:invalid");
  });

  it("est idempotent : normaliser un numéro déjà normalisé ne change rien", () => {
    for (const raw of ["01 02 03 04 05", "+221 77 123 45 67", "00225 05 05 05 05 05"]) {
      const first = ok(raw);
      expect(ok(first)).toBe(first);
    }
  });
});

describe("affichage et schéma", () => {
  it("affiche un numéro ivoirien par paires et laisse les autres tels quels", () => {
    expect(formatPhone("+2250102030405")).toBe("+225 01 02 03 04 05");
    expect(formatPhone("+221771234567")).toBe("+221771234567");
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
  });

  it("le schéma renvoie le numéro normalisé, ou le message d'erreur adapté à la cause", () => {
    expect(phoneSchema.parse("07 07 35 36 73")).toBe("+2250707353673");
    const messages = (raw: unknown) => {
      const result = phoneSchema.safeParse(raw);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(messages("07 35 36 73")[0]).toContain("antérieur à 2021");
    expect(messages("123")[0]).toContain("10 chiffres");
    expect(messages("")[0]).toBe("Numéro de téléphone obligatoire.");
    expect(messages(undefined)[0]).toBe("Numéro de téléphone obligatoire.");
  });
});
