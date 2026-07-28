#!/usr/bin/env node
/**
 * Migrate sve-engine card data from cardNo keys to card-name keys.
 *
 * - Re-keys cards.json / card-defs by exact card name (collapses reprints)
 * - Converts evolvesTo / evolvesFrom / tokenCardNo / filter.cardNo refs to names
 * - Keeps a canonical `cardNo` field on each card for art/printing metadata
 */
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "..", "packages", "sve-engine", "data");
const CARDS_PATH = path.join(DATA, "cards.json");
const DEFS_DIR = path.join(DATA, "card-defs");

function richness(card) {
  let score = 0;
  if (card.cardText) score += String(card.cardText).length;
  if (card.cost != null && card.cost > 0) score += 10;
  if (card.attack != null) score += 5;
  if (card.defense != null) score += 5;
  if (card.keywords?.length) score += card.keywords.length * 3;
  if (card.abilities?.length) score += 50;
  if (card.traits?.length) score += 2;
  if (/^[A-Z0-9]+-(\d+|T\d+)EN$/i.test(card.cardNo || "")) score += 3;
  return score;
}

function isCardNo(s) {
  return typeof s === "string" && /^[A-Z0-9]+-[A-Z0-9]+EN$/i.test(s);
}

function buildMaps(oldCards) {
  /** cardNo -> name */
  const noToName = {};
  /** name -> best card object */
  const byName = {};
  /** name -> all cardNos */
  const printingsByName = {};

  for (const card of Object.values(oldCards)) {
    const name = card.name;
    const no = card.cardNo;
    if (!name || !no) continue;
    noToName[no] = name;
    if (!printingsByName[name]) printingsByName[name] = [];
    printingsByName[name].push(no);
    const prev = byName[name];
    if (!prev || richness(card) > richness(prev)) {
      byName[name] = { ...card };
    }
  }
  return { noToName, byName, printingsByName };
}

function resolveName(ref, noToName) {
  if (!ref || typeof ref !== "string") return ref;
  if (noToName[ref]) return noToName[ref];
  return ref; // already a name, or unknown
}

function rewriteValue(value, noToName, parentKey) {
  if (Array.isArray(value)) {
    return value.map((v) => rewriteValue(v, noToName, parentKey));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Rename DSL fields that historically held cardNos
      if (k === "tokenCardNo") {
        out.tokenName = resolveName(v, noToName);
        continue;
      }
      // Any nested DeckFilter-style { cardNo: "BP…" } → { name: "…" }
      if (
        k === "cardNo" &&
        typeof v === "string" &&
        isCardNo(v) &&
        (parentKey === "filter" ||
          parentKey === "banishFromCemetery" ||
          parentKey === "banishFromExArea" ||
          parentKey === "buryFromField" ||
          parentKey === "namedFollowerOnField")
      ) {
        if (parentKey === "namedFollowerOnField") {
          // handled below after loop
          out.cardNo = v;
        } else {
          out.name = resolveName(v, noToName);
        }
        continue;
      }
      if (
        (k === "evolvesTo" || k === "evolvesFrom" || k === "reprintOf") &&
        typeof v === "string"
      ) {
        out[k] = resolveName(v, noToName);
        continue;
      }
      if (k === "relatedCardNos" && Array.isArray(v)) {
        out.relatedCardNames = v.map((x) => resolveName(x, noToName));
        continue;
      }
      out[k] = rewriteValue(v, noToName, k);
    }
    // namedFollowerOnField condition: { type, cardNo } → byName + identityName
    if (out.type === "namedFollowerOnField" && out.cardNo) {
      out.type = "namedFollowerOnFieldByName";
      out.identityName = resolveName(out.cardNo, noToName);
      delete out.cardNo;
    }
    return out;
  }
  return value;
}

function migrateCardsJson(oldCards, noToName, byName, printingsByName) {
  const out = {};
  for (const [name, card] of Object.entries(byName)) {
    const entry = rewriteValue(card, noToName, null);
    entry.name = name;
    // Keep canonical printing code for art
    entry.cardNo = card.cardNo;
    entry.printings = [...new Set(printingsByName[name] || [card.cardNo])].sort();
    // Drop scrape-only type field alias if present; keep printingType from type
    if (entry.type && !entry.printingType) {
      entry.printingType = entry.type;
    }
    delete entry.type;
    out[name] = entry;
  }
  return out;
}

function migrateDefsFile(filePath, noToName, nameByOldKey) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const out = {};
  for (const [key, overlay] of Object.entries(raw)) {
    const name = noToName[key] || nameByOldKey[key] || overlay.name || key;
    if (!name) {
      console.warn(`Skipping def without name: ${key} in ${path.basename(filePath)}`);
      continue;
    }
    const rewritten = rewriteValue(overlay, noToName, null);
    // Prefer first write; if collision, merge abilities from later (overrides win by load order)
    if (out[name] && rewritten.abilities && out[name].abilities) {
      // keep existing unless rewritten has abilities (file order handled by caller)
    }
    out[name] = { ...out[name], ...rewritten, name };
    // Drop redundant cardNo key inside overlay if it was the old key
    if (out[name].cardNo && isCardNo(out[name].cardNo)) {
      // keep as printing hint only if useful; defs don't need it
      delete out[name].cardNo;
    }
  }
  return out;
}

function main() {
  const oldCards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8"));
  const { noToName, byName, printingsByName } = buildMaps(oldCards);

  const newCards = migrateCardsJson(oldCards, noToName, byName, printingsByName);
  fs.writeFileSync(CARDS_PATH, JSON.stringify(newCards, null, 2) + "\n");
  console.log(
    `cards.json: ${Object.keys(oldCards).length} printings -> ${Object.keys(newCards).length} names`,
  );

  // Backup map for debugging
  fs.writeFileSync(
    path.join(DATA, "cardno-to-name.json"),
    JSON.stringify(noToName, null, 2) + "\n",
  );

  for (const file of fs.readdirSync(DEFS_DIR).filter((f) => f.endsWith(".json"))) {
    const fp = path.join(DEFS_DIR, file);
    const migrated = migrateDefsFile(fp, noToName, {});
    fs.writeFileSync(fp, JSON.stringify(migrated, null, 2) + "\n");
    console.log(`${file}: ${Object.keys(migrated).length} name-keyed defs`);
  }

  // mvp-cards.json is an array
  const mvpPath = path.join(DATA, "mvp-cards.json");
  if (fs.existsSync(mvpPath)) {
    const arr = JSON.parse(fs.readFileSync(mvpPath, "utf8"));
    const migrated = arr.map((c) => rewriteValue(c, noToName, null));
    fs.writeFileSync(mvpPath, JSON.stringify(migrated, null, 2) + "\n");
    console.log(`mvp-cards.json: ${migrated.length} entries rewritten`);
  }

  console.log("Done.");
}

main();
