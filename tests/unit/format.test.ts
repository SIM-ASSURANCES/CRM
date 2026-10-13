import { describe, expect, it } from "vitest";
import { formatDate, formatFcfa, formatNumber, formatSignedPercent, toDateInputValue } from "@/lib/format";

// Les séparateurs de milliers sont des espaces insécables : on les normalise pour comparer.
const plain = (value: string) => value.replace(/[  ]/g, " ");

describe("formatFcfa", () => {
  it("formate un montant avec séparateur de milliers et devise", () => {
    expect(plain(formatFcfa(34534725))).toBe("34 534 725 FCFA");
    expect(plain(formatFcfa(0))).toBe("0 FCFA");
  });

  it("arrondit au franc", () => {
    expect(plain(formatFcfa(1999.6))).toBe("2 000 FCFA");
  });
});

describe("formatNumber", () => {
  it("formate un entier", () => {
    expect(plain(formatNumber(1234567))).toBe("1 234 567");
  });
});

describe("formatDate / toDateInputValue", () => {
  it("affiche jj/mm/aaaa en UTC", () => {
    expect(formatDate(new Date("2026-10-13T00:00:00Z"))).toBe("13/10/2026");
    expect(formatDate(new Date("2026-01-05T23:59:00Z"))).toBe("05/01/2026");
  });

  it("produit la valeur d'un champ de date", () => {
    expect(toDateInputValue(new Date("2026-10-13T08:30:00Z"))).toBe("2026-10-13");
  });
});

describe("formatSignedPercent", () => {
  it("affiche le signe", () => {
    expect(formatSignedPercent(15)).toBe("+15 %");
    expect(formatSignedPercent(-4.6)).toBe("−5 %");
  });

  it("n'affiche pas de signe pour un écart nul ou négligeable", () => {
    expect(formatSignedPercent(0)).toBe("0 %");
    expect(formatSignedPercent(0.2)).toBe("0 %");
  });
});
