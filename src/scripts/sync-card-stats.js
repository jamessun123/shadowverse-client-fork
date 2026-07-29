#!/usr/bin/env node
/**
 * Sync packages/sve-engine/data/cards.json (+ card-defs overlays) →
 * src/engine/card-stats.json for the client UI.
 * Run after backfill-reprints.js or scraping.
 */
const fs = require("fs");
const path = require("path");

const CARDS_DB = path.join(__dirname, "..", "..", "packages", "sve-engine", "data", "cards.json");
const CARD_DEFS_DIR = path.join(__dirname, "..", "..", "packages", "sve-engine", "data", "card-defs");
const OUTPUT = path.join(__dirname, "..", "engine", "card-stats.json");

function upsertStats(stats, card) {
  if (!card?.cardNo || !card?.name) return;
  stats[card.cardNo] = {
    attack: card.attack ?? null,
    defense: card.defense ?? null,
    cost: card.cost ?? null,
    keywords: card.keywords || [],
    cardType: card.cardType || card.type || "follower",
    name: card.name,
    reprintOf: card.reprintOf || undefined,
  };
}

function main() {
  const cards = JSON.parse(fs.readFileSync(CARDS_DB, "utf8"));
  const stats = {};
  for (const card of Object.values(cards)) {
    upsertStats(stats, card);
  }
  if (fs.existsSync(CARD_DEFS_DIR)) {
    for (const file of fs.readdirSync(CARD_DEFS_DIR).filter((f) => f.endsWith(".json"))) {
      const chunk = JSON.parse(fs.readFileSync(path.join(CARD_DEFS_DIR, file), "utf8"));
      for (const card of Object.values(chunk)) {
        // Prefer cards.json when both exist; overlay only fills gaps.
        if (card?.cardNo && !stats[card.cardNo]) {
          upsertStats(stats, card);
        }
      }
    }
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(stats));
  console.log(`Wrote ${OUTPUT} (${Object.keys(stats).length} cards)`);
}

main();
