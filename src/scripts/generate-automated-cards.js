/**
 * Build src/decks/automatedCards.json from engine card-defs (+ cards.json abilities).
 * Cards with a non-empty abilities array are treated as automated.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DEFS_DIR = path.join(ROOT, "packages", "sve-engine", "data", "card-defs");
const CARDS_JSON = path.join(ROOT, "packages", "sve-engine", "data", "cards.json");
const OUT = path.join(ROOT, "src", "decks", "automatedCards.json");

const names = new Set();

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (ent.name.endsWith(".json")) {
      const chunk = JSON.parse(fs.readFileSync(full, "utf8"));
      for (const [name, def] of Object.entries(chunk)) {
        if (Array.isArray(def.abilities) && def.abilities.length > 0) names.add(name);
      }
    }
  }
}

walk(DEFS_DIR);
if (fs.existsSync(CARDS_JSON)) {
  const cards = JSON.parse(fs.readFileSync(CARDS_JSON, "utf8"));
  for (const [name, def] of Object.entries(cards)) {
    if (Array.isArray(def.abilities) && def.abilities.length > 0) names.add(name);
  }
}

const sorted = [...names].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n");
console.log(`[automated-cards] wrote ${sorted.length} names → ${path.relative(ROOT, OUT)}`);
