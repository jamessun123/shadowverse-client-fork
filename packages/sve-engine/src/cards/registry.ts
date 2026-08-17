import * as fs from "fs";
import * as path from "path";
import { CardDefinition } from "../types";
import { MVP_CARD_DEFS } from "./mvp-cards";

function resolveDataPath(...parts: string[]): string | null {
  const candidates = [
    path.join(__dirname, "..", "..", "data", ...parts),
    path.join(__dirname, "..", "data", ...parts),
    path.join(process.cwd(), "packages", "sve-engine", "data", ...parts),
    path.join(process.cwd(), "data", ...parts),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let scrapedCards: Record<string, CardDefinition & { printings?: string[]; printingType?: string }> =
  {};
const cardsPath = resolveDataPath("cards.json");
const cardDefsDir = resolveDataPath("card-defs");
if (cardsPath) {
  scrapedCards = JSON.parse(fs.readFileSync(cardsPath, "utf8"));
} else {
  console.warn(
    "[sve-engine] cards.json not found — only MVP stubs will load. Checked:",
    [
      path.join(__dirname, "..", "..", "data", "cards.json"),
      path.join(process.cwd(), "packages", "sve-engine", "data", "cards.json"),
    ].join(", "),
  );
}
const handAuthored: Record<string, Partial<CardDefinition>> = {};
if (cardDefsDir) {
  function loadCardDefJsonFiles(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        loadCardDefJsonFiles(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const chunk = JSON.parse(fs.readFileSync(full, "utf8"));
      Object.assign(handAuthored, chunk);
    }
  }
  loadCardDefJsonFiles(cardDefsDir);
}

/** Primary registry: exact card name → definition. */
const registry = new Map<string, CardDefinition>();
/** Optional lookup from printing code → name (for art / legacy callers). */
const cardNoToName = new Map<string, string>();

function toCardDef(raw: Record<string, unknown>, name: string): CardDefinition {
  const printingType =
    (raw.printingType as CardDefinition["printingType"]) ||
    (raw.type as CardDefinition["printingType"]);
  return {
    cardNo: String(raw.cardNo || ""),
    name,
    class: String(raw.class || "neutral"),
    cardType: (raw.cardType as CardDefinition["cardType"]) || "follower",
    printingType,
    specialType:
      printingType === "base"
        ? undefined
        : printingType === "token" || printingType === "evolved"
          ? (printingType as CardDefinition["specialType"])
          : (raw.specialType as CardDefinition["specialType"]),
    cost: raw.cost != null ? Number(raw.cost) : 0,
    attack: raw.attack != null ? Number(raw.attack) : undefined,
    defense: raw.defense != null ? Number(raw.defense) : undefined,
    traits: (raw.traits as string[]) || [],
    keywords: (raw.keywords as CardDefinition["keywords"]) || [],
    cardText: String(raw.cardText || ""),
    evolvesFrom: raw.evolvesFrom as string | undefined,
    evolvesTo: raw.evolvesTo as string | undefined,
    abilities: raw.abilities as CardDefinition["abilities"],
  };
}

function registerCardDef(name: string, def: CardDefinition): void {
  registry.set(name, { ...def, name });
  if (def.cardNo) cardNoToName.set(def.cardNo, name);
  const printings = (def as CardDefinition & { printings?: string[] }).printings;
  if (printings) {
    for (const no of printings) cardNoToName.set(no, name);
  }
}

for (const [name, raw] of Object.entries(scrapedCards)) {
  const printing = toCardDef(raw as unknown as Record<string, unknown>, name);
  const overlay = handAuthored[name] || {};
  const merged: CardDefinition = {
    ...printing,
    ...overlay,
    name,
    cardNo: printing.cardNo,
    abilities: overlay.abilities?.length ? overlay.abilities : printing.abilities,
    keywords: overlay.keywords?.length ? overlay.keywords : printing.keywords,
    evolvesFrom: overlay.evolvesFrom || printing.evolvesFrom,
    evolvesTo: overlay.evolvesTo || printing.evolvesTo,
    evolveCost: overlay.evolveCost ?? printing.evolveCost,
  };
  if (overlay.cost != null && overlay.cost > 0) merged.cost = overlay.cost;
  if (overlay.attack != null) merged.attack = overlay.attack;
  if (overlay.defense != null) merged.defense = overlay.defense;
  if (overlay.printingType) merged.printingType = overlay.printingType;
  // Preserve printings list for art lookup
  (merged as CardDefinition & { printings?: string[] }).printings = (
    raw as { printings?: string[] }
  ).printings;
  registerCardDef(name, merged);
}

for (const def of MVP_CARD_DEFS) {
  const extra = handAuthored[def.name] || {};
  registerCardDef(def.name, {
    ...def,
    ...extra,
    name: def.name,
    abilities: extra.abilities || def.abilities,
  });
}

for (const [name, overlay] of Object.entries(handAuthored)) {
  if (registry.has(name)) continue;
  const stub: CardDefinition = {
    cardNo: "",
    name,
    class: String(overlay.class || "neutral"),
    cardType: (overlay.cardType as CardDefinition["cardType"]) || "follower",
    printingType: overlay.printingType,
    cost: overlay.cost != null ? Number(overlay.cost) : 0,
    attack: overlay.attack,
    defense: overlay.defense,
    traits: overlay.traits || [],
    keywords: overlay.keywords || [],
    cardText: overlay.cardText || "",
    evolvesFrom: overlay.evolvesFrom,
    evolvesTo: overlay.evolvesTo,
    evolveCost: overlay.evolveCost,
    abilities: overlay.abilities,
  };
  registerCardDef(name, { ...stub, ...overlay, name, abilities: overlay.abilities || stub.abilities });
}

/**
 * Look up a card definition by exact card name.
 * Also accepts a legacy printing code (BP07-069EN).
 * Token DSL refs may omit the trailing " TOKEN" suffix (e.g. "Assembly Droid").
 */
export function getCardDef(nameOrCardNo: string): CardDefinition | undefined {
  // Legacy misspelling used in older decks / deck-builder lists.
  if (nameOrCardNo === "Prophetless of Creation") nameOrCardNo = "Prophetess of Creation";
  if (registry.has(nameOrCardNo)) return registry.get(nameOrCardNo);
  const mapped = cardNoToName.get(nameOrCardNo);
  if (mapped) return registry.get(mapped);
  if (nameOrCardNo && !/\s+TOKEN$/i.test(nameOrCardNo)) {
    const asToken = `${nameOrCardNo} TOKEN`;
    if (registry.has(asToken)) return registry.get(asToken);
  }
  return undefined;
}

/**
 * Resolve a summon/token reference to the registry card name.
 * Prefers the "… TOKEN" printing when both a base card and token share a name
 * (e.g. Assault Tentacle).
 */
export function resolveTokenName(nameOrCardNo: string): string {
  if (!nameOrCardNo) return nameOrCardNo;
  const stripped = nameOrCardNo.replace(/\s+TOKEN$/i, "").trim();
  const withToken = `${stripped} TOKEN`;
  if (registry.has(withToken)) return withToken;
  if (registry.has(stripped)) return stripped;
  const mapped = cardNoToName.get(nameOrCardNo) || cardNoToName.get(stripped);
  if (mapped) return mapped;
  return nameOrCardNo;
}

/** Resolve a printing code to its gameplay card name. */
export function getNameForCardNo(cardNo: string): string | undefined {
  return cardNoToName.get(cardNo);
}

/**
 * @deprecated Prefer comparing names directly. Kept for call sites that still
 * pass printing codes; returns the gameplay name for both sides.
 */
export function getGameplayCardNo(nameOrCardNo: string): string {
  return getCardDef(nameOrCardNo)?.name ?? nameOrCardNo;
}

export function getAllCardDefs(): CardDefinition[] {
  return [...registry.values()];
}

export function registerCard(def: CardDefinition): void {
  registerCardDef(def.name, def);
}

export function getCardByName(name: string): CardDefinition | undefined {
  return registry.get(name);
}
