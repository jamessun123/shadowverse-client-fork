#!/usr/bin/env node
/**
 * Import specific cards from expansion scrapes into name-keyed cards.json,
 * then sync client card-stats. Fixes Vanilla Soldier fallbacks for decks
 * whose cards only lived in card-defs overlays.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = path.join(ROOT, "src", "scripts");
const CARDS_DB = path.join(ROOT, "packages", "sve-engine", "data", "cards.json");
const HOLLOWNESS = path.join(
  ROOT,
  "packages",
  "sve-engine",
  "data",
  "card-defs",
  "hollowness-usurpation.json",
);
const STATS_OUT = path.join(ROOT, "src", "engine", "card-stats.json");

const NAMES = [
  "Deep-Sea Scout",
  "Servant of Usurpation",
  "Avaritia",
  "Ultimate Hollow",
  "Chivalrous Bandit",
  "Storm-Wracked First Mate",
  "Storm-Wracked First Mate Evolved",
  "Gilnelise, Ravenous Craving",
  "Gilnelise, Ravenous Craving Evolved",
  "Octrice, Hollowness Manifest",
  "Adherent of Hollowness",
  "Adherent of Hollowness Evolved",
  "Octrice, Omen of Usurpation",
  "Octrice, Omen of Usurpation Evolved",
  "Tidal Gunner",
  "Returning Slash",
  "Barbaros, Briny Convict",
  "Barbaros, Briny Convict Evolved",
  "Octrice, Hollow Usurpation",
  "Dread Pirate's Flag TOKEN",
  "Gilded Goblet TOKEN",
  "Gilded Boots TOKEN",
  "Gilded Blade TOKEN",
  "Crest: Octrice, Hollowness Manifest TOKEN",
  "Remnant of Hollowness TOKEN",
  "Ravenous Sweetness TOKEN",
];

function parseNum(v) {
  if (v == null || v === "-" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeCardType(raw) {
  const s = String(raw || "follower").toLowerCase();
  if (s.includes("spell")) return "spell";
  if (s.includes("crest")) return "crest";
  if (s.includes("amulet")) return "amulet";
  return "follower";
}

function extractKeywords(text) {
  const keywords = [];
  const t = String(text || "");
  if (/\bfanfare\b/i.test(t) || /\[fanfare\]/i.test(t)) keywords.push("fanfare");
  if (/\blast ?words\b/i.test(t) || /\[lastwords\]/i.test(t)) keywords.push("lastWords");
  if (/\bon evolve\b/i.test(t) || /\[evolve\]/i.test(t)) keywords.push("evolve");
  if (/on evolve/i.test(t)) keywords.push("onEvolve");
  if (/\bquick\b/i.test(t) || /\[quick\]/i.test(t)) keywords.push("quick");
  if (/\brush\b/i.test(t)) keywords.push("rush");
  if (/\bstorm\b/i.test(t)) keywords.push("storm");
  if (/\bward\b/i.test(t)) keywords.push("ward");
  if (/\bbane\b/i.test(t)) keywords.push("bane");
  if (/\baura\b/i.test(t)) keywords.push("aura");
  if (/\bassail\b/i.test(t)) keywords.push("assail");
  if (/\bdrain\b/i.test(t)) keywords.push("drain");
  return [...new Set(keywords)];
}

function toCanonical(raw) {
  const d = raw.details || {};
  const name = raw.name;
  const printingType =
    raw.printingType ||
    raw.type ||
    (/\bTOKEN$/i.test(name) ? "token" : /\bEvolved$/i.test(name) ? "evolved" : "base");
  const cardType = normalizeCardType(raw.cardType || d.cardType);
  const traits =
    raw.traits ||
    (d.trait
      ? String(d.trait)
          .split(/\s*\/\s*/)
          .map((t) => t.trim())
          .filter(Boolean)
      : []);
  const cardText = raw.cardText || d.effect || "";
  const cost = raw.cost != null ? Number(raw.cost) : parseNum(d.cost) ?? 0;
  const attack = raw.attack != null ? Number(raw.attack) : parseNum(d.attack);
  const defense = raw.defense != null ? Number(raw.defense) : parseNum(d.defense);
  const entry = {
    cardNo: raw.cardNo,
    name,
    class: raw.class || "neutral",
    cardType,
    printingType,
    cost: Number.isFinite(cost) ? cost : 0,
    traits,
    keywords: raw.keywords?.length ? raw.keywords : extractKeywords(cardText),
    cardText,
    printings: [raw.cardNo],
  };
  if (printingType === "token" || printingType === "evolved") {
    entry.specialType = printingType;
  }
  if (cardType === "follower") {
    if (attack != null) entry.attack = attack;
    if (defense != null) entry.defense = defense;
  }
  return entry;
}

function loadExpansionCards() {
  const byName = new Map();
  for (const file of fs.readdirSync(SCRIPTS).filter((f) => f.endsWith("-cards.json"))) {
    const cards = JSON.parse(fs.readFileSync(path.join(SCRIPTS, file), "utf8"));
    if (!Array.isArray(cards)) continue;
    for (const card of cards) {
      if (!card?.name || !card?.cardNo) continue;
      const prev = byName.get(card.name);
      // Prefer entries that already have flat cost/stats.
      const score = (card.cost != null ? 10 : 0) + (card.cardText ? 5 : 0);
      const prevScore = prev ? (prev.cost != null ? 10 : 0) + (prev.cardText ? 5 : 0) : -1;
      if (!prev || score >= prevScore) byName.set(card.name, card);
    }
  }
  return byName;
}

function linkEvolves(db) {
  for (const card of Object.values(db)) {
    if (!card?.name) continue;
    if (card.printingType === "base" || card.printingType === "evolved") {
      const evoName = `${card.name.replace(/\s+Evolved$/i, "")} Evolved`;
      const baseName = card.name.replace(/\s+Evolved$/i, "");
      if (card.printingType === "base" && db[evoName]) {
        card.evolvesTo = evoName;
        db[evoName].evolvesFrom = card.name;
      } else if (card.printingType === "evolved" && db[baseName] && baseName !== card.name) {
        card.evolvesFrom = baseName;
        db[baseName].evolvesTo = card.name;
      }
    }
  }
}

function main() {
  const scraped = loadExpansionCards();
  const db = JSON.parse(fs.readFileSync(CARDS_DB, "utf8"));
  const hollowness = JSON.parse(fs.readFileSync(HOLLOWNESS, "utf8"));
  let added = 0;
  let updated = 0;

  for (const name of NAMES) {
    const raw = scraped.get(name);
    if (!raw) {
      console.warn(`Missing from expansion scrapes: ${name}`);
      continue;
    }
    const canonical = toCanonical(raw);
    // Preserve hand-authored evolve links / richer text when already present.
    const prev = db[name];
    if (prev) {
      db[name] = {
        ...canonical,
        ...prev,
        cardNo: canonical.cardNo,
        printings: [...new Set([...(prev.printings || []), canonical.cardNo])],
        cost: prev.cost ?? canonical.cost,
        attack: prev.attack ?? canonical.attack,
        defense: prev.defense ?? canonical.defense,
        traits: prev.traits?.length ? prev.traits : canonical.traits,
        keywords: prev.keywords?.length ? prev.keywords : canonical.keywords,
        cardText: prev.cardText || canonical.cardText,
        cardType: prev.cardType || canonical.cardType,
        printingType: prev.printingType || canonical.printingType,
        class: prev.class || canonical.class,
      };
      updated += 1;
    } else {
      db[name] = canonical;
      added += 1;
    }

    // Keep hollowness-usurpation.json cardNos aligned with textures/scrapes.
    if (hollowness[name]) {
      hollowness[name].cardNo = canonical.cardNo;
    }
  }

  linkEvolves(db);

  fs.writeFileSync(CARDS_DB, JSON.stringify(db, null, 2));
  fs.writeFileSync(HOLLOWNESS, JSON.stringify(hollowness, null, 2));

  const stats = {};
  for (const card of Object.values(db)) {
    if (!card?.cardNo) continue;
    stats[card.cardNo] = {
      attack: card.attack ?? null,
      defense: card.defense ?? null,
      cost: card.cost ?? null,
      keywords: card.keywords || [],
      cardType: card.cardType || "follower",
      name: card.name,
      reprintOf: card.reprintOf || undefined,
    };
  }
  fs.writeFileSync(STATS_OUT, JSON.stringify(stats));

  console.log(`cards.json: +${added} added, ${updated} updated`);
  console.log(`card-stats.json: ${Object.keys(stats).length} entries`);
  console.log("Updated hollowness-usurpation.json cardNos");
}

main();
