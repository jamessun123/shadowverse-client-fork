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

function loadCardDefOverlays(dir, stats) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCardDefOverlays(full, stats);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const chunk = JSON.parse(fs.readFileSync(full, "utf8"));
    for (const card of Object.values(chunk)) {
      if (!card?.cardNo) continue;
      if (!stats[card.cardNo]) {
        upsertStats(stats, card);
        continue;
      }
      // Prefer authored gameplay keywords — scraped cards.json often marks
      // conditional keywords (e.g. "give this Storm") as always-on.
      if (Array.isArray(card.keywords)) {
        stats[card.cardNo].keywords = card.keywords;
      }
    }
  }
}

function main() {
  const cards = JSON.parse(fs.readFileSync(CARDS_DB, "utf8"));
  const stats = {};
  for (const card of Object.values(cards)) {
    upsertStats(stats, card);
  }
  loadCardDefOverlays(CARD_DEFS_DIR, stats);
  fs.writeFileSync(OUTPUT, JSON.stringify(stats));
  console.log(`Wrote ${OUTPUT} (${Object.keys(stats).length} cards)`);
}

main();
