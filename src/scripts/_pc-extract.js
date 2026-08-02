const fs = require("fs");
const path = require("path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "CP04-cards.json"), "utf8"));

const names = [
  "Grace","Croce","Yui","Wyrm","Sheffy","Tomo","Muimi","Lind","Pecorine",
  "Someday We'll Meet Again in the Future","Christina","Saren","Homare","Lailael",
  "Kurumi","Ameth","Inori","Illya","Suzume","Eris","Riri","Kaya","Aurora Healing",
  "Call of the Guild","Infinite Break - Code: Null","Kyoka","Chloe","Chieru",
  "The Shared Illusion of Truth and Existence","Dark Eclipse","Cheru Cheru\u2606Carnival",
  "Karyl","Yuni","Yuki","Maho","Kokkoro",
  "Yui evolved","Sheffy Evolved","Tomo Evolved","Pecorine Evolved","Saren Evolved",
  "Ameth Evolved","Illya Evolved","Inori Evolved","Kaya Evolved","Kyoka Evolved",
  "Karyl Evolved","Yuki Evolved","Maho Evolved","Kokkoro Evolved",
  "Ames Amulet","Princess Sword","Holy Castle Sword","Avalon","Ice Drachen",
  "Proof of Bonds","Dark Axe Nachtfang","Glorious Feather",
];

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const wanted = new Map();
for (const n of names) wanted.set(norm(n), n);

const found = [];
const foundKeys = new Set();

// Pass 1: exact normalized name match
for (const card of data) {
  const nn = norm(card.name || "");
  if (wanted.has(nn) && !foundKeys.has(wanted.get(nn))) {
    found.push(card);
    foundKeys.add(wanted.get(nn));
  }
}

// Pass 2: suffix variants (TOKEN / Evolved) for anything still missing
for (const card of data) {
  const nn = norm(card.name || "");
  for (const [wn, orig] of wanted.entries()) {
    if (foundKeys.has(orig)) continue;
    if (nn === wn + "token" || nn === wn + "evolved") {
      found.push(card);
      foundKeys.add(orig);
      break;
    }
  }
}

const missing = names.filter((n) => !foundKeys.has(n));

const out = found.map((c) => ({
  cardNo: c.cardNo,
  name: c.name,
  cardType: c.cardType,
  specialType: c.specialType,
  class: c.class,
  traits: c.traits,
  cost: c.cost,
  attack: c.attack,
  defense: c.defense,
  cardText: c.cardText,
  rarity: c.rarity,
}));

fs.writeFileSync(path.join(__dirname, "_pc-dump.json"), JSON.stringify({ out, missing }, null, 2));
console.log("Found:", out.length, "Missing:", missing.length);
console.log("Missing list:", JSON.stringify(missing, null, 2));
