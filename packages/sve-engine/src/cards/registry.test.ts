import { describe, expect, it } from "vitest";
import { getCardDef } from "./registry";

describe("registry reprint resolution", () => {
  it("SDD05 promo reprint inherits Dead to Rights gameplay", () => {
    const def = getCardDef("SDD05-012EN");
    expect(def).toBeDefined();
    expect(def?.cardText).toContain("quick");
    expect(def?.abilities?.length).toBeGreaterThan(0);
  });

  it("keeps promo card number on the resolved definition", () => {
    const def = getCardDef("SDD05-012EN");
    expect(def?.cardNo).toBe("SDD05-012EN");
  });

  it("propagates hand-authored activate abilities from reprint to base printing", () => {
    const base = getCardDef("BP07-069EN");
    expect(base?.abilities?.some((a) => a.timing === "activated")).toBe(true);
  });

  it("propagates hand-authored activate abilities across token printings", () => {
    const legacy = getCardDef("BP07-T01EN");
    expect(legacy?.abilities?.some((a) => a.timing === "activated")).toBe(true);
  });
});
