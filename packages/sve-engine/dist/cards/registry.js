"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCardDef = getCardDef;
exports.resolveTokenName = resolveTokenName;
exports.getNameForCardNo = getNameForCardNo;
exports.getGameplayCardNo = getGameplayCardNo;
exports.getAllCardDefs = getAllCardDefs;
exports.registerCard = registerCard;
exports.getCardByName = getCardByName;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const mvp_cards_1 = require("./mvp-cards");
function resolveDataPath(...parts) {
    const candidates = [
        path.join(__dirname, "..", "..", "data", ...parts),
        path.join(__dirname, "..", "data", ...parts),
        path.join(process.cwd(), "packages", "sve-engine", "data", ...parts),
        path.join(process.cwd(), "data", ...parts),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? null;
}
let scrapedCards = {};
const cardsPath = resolveDataPath("cards.json");
const cardDefsDir = resolveDataPath("card-defs");
if (cardsPath) {
    scrapedCards = JSON.parse(fs.readFileSync(cardsPath, "utf8"));
}
else {
    console.warn("[sve-engine] cards.json not found — only MVP stubs will load. Checked:", [
        path.join(__dirname, "..", "..", "data", "cards.json"),
        path.join(process.cwd(), "packages", "sve-engine", "data", "cards.json"),
    ].join(", "));
}
const handAuthored = {};
if (cardDefsDir) {
    function loadCardDefJsonFiles(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                loadCardDefJsonFiles(full);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith(".json"))
                continue;
            const chunk = JSON.parse(fs.readFileSync(full, "utf8"));
            Object.assign(handAuthored, chunk);
        }
    }
    loadCardDefJsonFiles(cardDefsDir);
}
/** Primary registry: exact card name → definition. */
const registry = new Map();
/** Optional lookup from printing code → name (for art / legacy callers). */
const cardNoToName = new Map();
function toCardDef(raw, name) {
    const printingType = raw.printingType ||
        raw.type;
    return {
        cardNo: String(raw.cardNo || ""),
        name,
        class: String(raw.class || "neutral"),
        cardType: raw.cardType || "follower",
        printingType,
        specialType: printingType === "base"
            ? undefined
            : printingType === "token" || printingType === "evolved"
                ? printingType
                : raw.specialType,
        cost: raw.cost != null ? Number(raw.cost) : 0,
        attack: raw.attack != null ? Number(raw.attack) : undefined,
        defense: raw.defense != null ? Number(raw.defense) : undefined,
        traits: raw.traits || [],
        keywords: raw.keywords || [],
        cardText: String(raw.cardText || ""),
        evolvesFrom: raw.evolvesFrom,
        evolvesTo: raw.evolvesTo,
        abilities: raw.abilities,
    };
}
function registerCardDef(name, def) {
    registry.set(name, { ...def, name });
    if (def.cardNo)
        cardNoToName.set(def.cardNo, name);
    const printings = def.printings;
    if (printings) {
        for (const no of printings)
            cardNoToName.set(no, name);
    }
}
for (const [name, raw] of Object.entries(scrapedCards)) {
    const printing = toCardDef(raw, name);
    const overlay = handAuthored[name] || {};
    const merged = {
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
    if (overlay.cost != null && overlay.cost > 0)
        merged.cost = overlay.cost;
    if (overlay.attack != null)
        merged.attack = overlay.attack;
    if (overlay.defense != null)
        merged.defense = overlay.defense;
    if (overlay.printingType)
        merged.printingType = overlay.printingType;
    // Preserve printings list for art lookup
    merged.printings = raw.printings;
    registerCardDef(name, merged);
}
for (const def of mvp_cards_1.MVP_CARD_DEFS) {
    const extra = handAuthored[def.name] || {};
    registerCardDef(def.name, {
        ...def,
        ...extra,
        name: def.name,
        abilities: extra.abilities || def.abilities,
    });
}
for (const [name, overlay] of Object.entries(handAuthored)) {
    if (registry.has(name))
        continue;
    const stub = {
        cardNo: "",
        name,
        class: String(overlay.class || "neutral"),
        cardType: overlay.cardType || "follower",
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
function getCardDef(nameOrCardNo) {
    // Legacy misspelling used in older decks / deck-builder lists.
    if (nameOrCardNo === "Prophetless of Creation")
        nameOrCardNo = "Prophetess of Creation";
    if (registry.has(nameOrCardNo))
        return registry.get(nameOrCardNo);
    const mapped = cardNoToName.get(nameOrCardNo);
    if (mapped)
        return registry.get(mapped);
    if (nameOrCardNo && !/\s+TOKEN$/i.test(nameOrCardNo)) {
        const asToken = `${nameOrCardNo} TOKEN`;
        if (registry.has(asToken))
            return registry.get(asToken);
    }
    return undefined;
}
/**
 * Resolve a summon/token reference to the registry card name.
 * Prefers the "… TOKEN" printing when both a base card and token share a name
 * (e.g. Assault Tentacle).
 */
function resolveTokenName(nameOrCardNo) {
    if (!nameOrCardNo)
        return nameOrCardNo;
    const stripped = nameOrCardNo.replace(/\s+TOKEN$/i, "").trim();
    const withToken = `${stripped} TOKEN`;
    if (registry.has(withToken))
        return withToken;
    if (registry.has(stripped))
        return stripped;
    const mapped = cardNoToName.get(nameOrCardNo) || cardNoToName.get(stripped);
    if (mapped)
        return mapped;
    return nameOrCardNo;
}
/** Resolve a printing code to its gameplay card name. */
function getNameForCardNo(cardNo) {
    return cardNoToName.get(cardNo);
}
/**
 * @deprecated Prefer comparing names directly. Kept for call sites that still
 * pass printing codes; returns the gameplay name for both sides.
 */
function getGameplayCardNo(nameOrCardNo) {
    return getCardDef(nameOrCardNo)?.name ?? nameOrCardNo;
}
function getAllCardDefs() {
    return [...registry.values()];
}
function registerCard(def) {
    registerCardDef(def.name, def);
}
function getCardByName(name) {
    return registry.get(name);
}
