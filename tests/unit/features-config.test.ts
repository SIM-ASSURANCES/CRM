import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "@/components/layout/nav-config";
import {
  FEATURE_KEYS,
  FEATURES,
  featureKeyFromSetting,
  featureSettingKey,
  isFeatureKey,
  isSettingEnabled,
} from "@/features/modules/config";

describe("fonctionnalités activables : configuration", () => {
  it("chaque clé est unique et chaque fonctionnalité a un libellé, une description et au moins un écran", () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURES.length);
    for (const feature of FEATURES) {
      expect(feature.label.length).toBeGreaterThan(0);
      expect(feature.description.length).toBeGreaterThan(0);
      expect(feature.screens.length).toBeGreaterThan(0);
    }
  });

  it("le tableau de bord et toute l'administration ne sont jamais désactivables", () => {
    const screens = FEATURES.flatMap((feature) => [...feature.screens]);
    expect(screens).not.toContain("/");
    expect(screens.filter((screen) => screen.startsWith("/admin"))).toEqual([]);
    const adminItems = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.href.startsWith("/admin") || item.href === "/");
    expect(adminItems.length).toBeGreaterThan(0);
    for (const item of adminItems) expect(item.feature).toBeUndefined();
  });

  it("chaque entrée de menu rattachée à une fonctionnalité en désigne une qui existe", () => {
    const linked = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.feature);
    expect(linked.length).toBeGreaterThan(0);
    for (const item of linked) expect(isFeatureKey(item.feature)).toBe(true);
  });

  it("chaque écran déclaré par une fonctionnalité correspond à une entrée de menu portant cette fonctionnalité", () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    for (const feature of FEATURES) {
      for (const screen of feature.screens) {
        const item = items.find((candidate) => candidate.href === screen);
        expect(item?.feature, `écran ${screen}`).toBe(feature.key);
      }
    }
  });

  it("isFeatureKey refuse tout ce qui n'est pas une clé connue", () => {
    expect(isFeatureKey("taches")).toBe(true);
    for (const value of ["", "Taches", "dashboard", "admin", null, undefined, 3, {}]) expect(isFeatureKey(value)).toBe(false);
  });

  it("la clé de réglage est préfixée et se retrouve à l'identique", () => {
    for (const key of FEATURE_KEYS) {
      expect(featureSettingKey(key)).toBe(`features.${key}`);
      expect(featureKeyFromSetting(featureSettingKey(key))).toBe(key);
    }
    expect(featureKeyFromSetting("features.inconnue")).toBeUndefined();
    expect(featureKeyFromSetting("automations.taches")).toBeUndefined();
  });

  it("seule la valeur explicite { enabled: false } désactive (lecture tolérante)", () => {
    expect(isSettingEnabled({ enabled: false })).toBe(false);
    for (const value of [undefined, null, {}, { enabled: true }, { enabled: "false" }, { enabled: 0 }, "off", false, []]) {
      expect(isSettingEnabled(value)).toBe(true);
    }
  });
});
