#!/usr/bin/env node

/**
 * Import Google Sheets HTML exports (waffle tables) into *-cards.json
 * matching the format used by generatecardfiles.js / buildcarddata.cjs.
 *
 * Usage:
 *   node src/scripts/import-sheet-html.js "<path-to.html>" [--set-name "Display Name"]
 *   node src/scripts/import-sheet-html.js --all
 *
 * Also copies/converts cell images from the sibling resources/ folder into
 * public/textures/<cardNo>.png when present.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PARENT = path.join(ROOT, "..");
const TEXTURES = path.join(ROOT, "public", "textures");
const SCRIPTS = __dirname;

const CLASS_MAP = {
  forestcraft: "forest",
  swordcraft: "sword",
  runecraft: "rune",
  dragoncraft: "dragon",
  abysscraft: "abyss",
  shadowcraft: "abyss",
  bloodcraft: "abyss",
  havencraft: "haven",
  portalcraft: "portal",
  neutral: "neutral",
};

const RARITY_MAP = {
  L: "Legendary",
  G: "Gold",
  S: "Silver",
  B: "Bronze",
  BR: "Bronze",
  Legendary: "Legendary",
  Gold: "Gold",
  Silver: "Silver",
  Bronze: "Bronze",
  Token: "Token",
  TOKEN: "Token",
  PR: "Promo",
  Promo: "Promo",
  U: "Ultimate",
  Ultimate: "Ultimate",
  SL: "Legendary",
};

const SET_FILES = [
  {
    file: "BP18_ Neometropolis.html",
    expansion: "BP18",
    setName: "Neometropolis",
  },
  {
    file: "BP19_ Eightfold Retribution.html",
    expansion: "BP19",
    setName: "Eightfold Retribution",
  },
  {
    file: "BP20_ Omens and Heirs.html",
    expansion: "BP20",
    setName: "Omens and Heirs",
  },
  {
    file: "BP21_ Academy Royale.html",
    expansion: "BP21",
    setName: "Academy Royale",
  },
  {
    file: "CP04_ Princess Connect! Re_Dive.html",
    expansion: "CP04",
    setName: 'Crossover Set "Princess Connect! Re:Dive"',
  },
];

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .trim();
}

function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function parseTable(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const matrix = rows.map((rowHtml) => {
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (m) => m[1],
    );
    return cells;
  });
  return matrix;
}

function cellText(cellHtml) {
  return stripHtml(cellHtml || "");
}

function cellImageSrc(cellHtml) {
  const m = (cellHtml || "").match(/src="(resources\/[^"]+)"/i);
  return m ? m[1].replace(/\\/g, "/") : null;
}

function normalizeCardNo(raw, expansion) {
  let no = (raw || "").trim().toUpperCase();
  if (!no) return "";
  // Already has language suffix
  if (/EN$/i.test(no)) return no;
  // BP19-001 / BP19-T01 / BP19-U01 / BP19-SP01
  if (/^[A-Z]+\d*[A-Z]?-\S+$/i.test(no)) return `${no}EN`;
  // Fallback: prefix expansion if bare number
  if (/^\d+$/.test(no)) return `${expansion}-${no.padStart(3, "0")}EN`;
  return `${no}EN`;
}

function classifyType(name, cardNo, cardTypeRaw) {
  const ct = (cardTypeRaw || "").toLowerCase();
  if (ct.includes("token") || /-T\d+/i.test(cardNo)) return "token";
  if (ct.includes("evolved") || /\(evolved\)/i.test(name) || / evolved$/i.test(name))
    return "evolved";
  if (ct.includes("advanced") || /\(advanced\)/i.test(name) || / advanced$/i.test(name))
    return "evolved";
  return "base";
}

function normalizeName(name, type) {
  let n = decodeEntities(name || "").replace(/\s+/g, " ").trim();
  // Sheet uses "(Evolved)"; deckbuilder uses " Evolved"
  n = n.replace(/\s*\(Evolved\)\s*$/i, " Evolved");
  n = n.replace(/\s*\(Advanced\)\s*$/i, " ADVANCED");
  if (type === "token" && !/ TOKEN$/i.test(n)) {
    n = `${n.replace(/\s+TOKEN$/i, "")} TOKEN`;
  }
  return n;
}

function parseStats(statsRaw) {
  const s = (statsRaw || "").trim();
  if (!s || s === "-" || s === "—") return { attack: "", defense: "" };
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return { attack: m[1], defense: m[2] };
  return { attack: "", defense: "" };
}

function normalizeCost(costRaw, type) {
  const c = (costRaw || "").trim();
  if (!c || c === "-" || c === "—") return type === "evolved" ? "-" : "";
  return c;
}

function normalizeRarity(raw) {
  const r = (raw || "").trim();
  if (!r) return "";
  return RARITY_MAP[r] || RARITY_MAP[r.toUpperCase()] || r;
}

function isAltArt(cardNo) {
  return /-(U|SP|SL)\d+/i.test(cardNo);
}

function convertImageToPng(srcPath, destPath) {
  // Prefer sharp if available; otherwise copy jpg and note conversion needed.
  try {
    const sharp = require("sharp");
    return sharp(srcPath)
      .png()
      .toFile(destPath)
      .then(() => true)
      .catch(() => false);
  } catch {
    // sharp not installed – try magick / copy as-is with wrong ext won't work
    // for the app (expects png). Fall back to copying bytes if already png.
    if (/\.png$/i.test(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      return Promise.resolve(true);
    }
    // Try using PowerShell/.NET or ffmpeg later; for now skip
    return Promise.resolve(false);
  }
}

async function importFile(htmlPath, expansion, setName, opts = {}) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const matrix = parseTable(html);
  if (matrix.length < 11) {
    throw new Error(`Expected ~12 rows, got ${matrix.length} in ${htmlPath}`);
  }

  // Row 0 is column letters; data rows start at 1
  const labelOf = (row) => cellText(matrix[row][1] || "").toLowerCase();
  const rowIndex = {};
  for (let r = 1; r < matrix.length; r++) {
    const label = labelOf(r);
    if (label.includes("card image")) rowIndex.images = r;
    else if (label.includes("english name") || label === "name") rowIndex.name = r;
    else if (label.includes("card number") || label === "card no") rowIndex.number = r;
    else if (label === "class") rowIndex.class = r;
    else if (label.includes("card type")) rowIndex.cardType = r;
    else if (label === "cost") rowIndex.cost = r;
    else if (label === "stats") rowIndex.stats = r;
    else if (label === "trait") rowIndex.trait = r;
    else if (label === "rarity") rowIndex.rarity = r;
    else if (label.includes("card text") || label === "effect") rowIndex.text = r;
    else if (label === "notes") rowIndex.notes = r;
  }

  const required = ["name", "number", "class", "cardType"];
  for (const k of required) {
    if (rowIndex[k] == null) throw new Error(`Missing row "${k}" in ${htmlPath}`);
  }

  const colCount = Math.max(...matrix.map((r) => r.length));
  const cards = [];
  const seenNames = new Set();
  let imageOk = 0;
  let imageFail = 0;

  // Data columns start after: row-header (0), label (1), freezebar (2)
  for (let c = 3; c < colCount; c++) {
    const rawNo = cellText(matrix[rowIndex.number][c] || "");
    if (!rawNo) continue;

    const cardNo = normalizeCardNo(rawNo, expansion);
    const rawName = cellText(matrix[rowIndex.name][c] || "");
    if (!rawName) continue;

    const cardTypeRaw = cellText(matrix[rowIndex.cardType]?.[c] || "");
    const type = classifyType(rawName, cardNo, cardTypeRaw);
    const name = normalizeName(rawName, type);

    // Skip U/SP alt arts when the base name already exists (same as scrapecards.js)
    if (isAltArt(cardNo) && seenNames.has(name)) {
      continue;
    }

    const classRaw = cellText(matrix[rowIndex.class][c] || "");
    const cls = CLASS_MAP[classRaw.toLowerCase()] || classRaw.toLowerCase();
    const costRaw = cellText(matrix[rowIndex.cost]?.[c] || "");
    const stats = parseStats(cellText(matrix[rowIndex.stats]?.[c] || ""));
    const trait = cellText(matrix[rowIndex.trait]?.[c] || "");
    const rarity = normalizeRarity(cellText(matrix[rowIndex.rarity]?.[c] || ""));
    const effect = cellText(matrix[rowIndex.text]?.[c] || "");

    const card = {
      cardNo,
      name,
      type,
      class: cls || "neutral",
      details: {
        format: "Any",
        class: classRaw || "",
        cardType: cardTypeRaw || "",
        trait: trait || "-",
        rarity: rarity || (type === "token" ? "Token" : ""),
        cardSet: setName,
        cost: normalizeCost(costRaw, type),
        attack: stats.attack || (type === "evolved" || type === "base" ? "" : ""),
        defense: stats.defense || "",
        effect: effect || "",
      },
      imgSrc: "",
    };

    // Flat fields too (BP17-style) for engine consumers
    card.cardType = (cardTypeRaw || "follower").toLowerCase().includes("spell")
      ? "spell"
      : (cardTypeRaw || "").toLowerCase().includes("amulet")
        ? "amulet"
        : (cardTypeRaw || "").toLowerCase().includes("leader")
          ? "leader"
          : "follower";
    if (type === "evolved") card.specialType = "evolved";
    if (type === "token") card.specialType = "token";
    card.traits = trait
      ? trait
          .split("/")
          .map((t) => t.trim())
          .filter((t) => t && t !== "-")
      : [];
    card.cost =
      card.details.cost && card.details.cost !== "-"
        ? parseInt(card.details.cost, 10)
        : null;
    card.attack = stats.attack ? parseInt(stats.attack, 10) : null;
    card.defense = stats.defense ? parseInt(stats.defense, 10) : null;
    card.cardText = effect;
    card.rarity = rarity;
    card.format = "Any";

    cards.push(card);
    seenNames.add(name);

    // Images from resources/
    if (!opts.skipImages && rowIndex.images != null) {
      const rel = cellImageSrc(matrix[rowIndex.images][c] || "");
      if (rel) {
        const srcAbs = path.join(PARENT, rel);
        const destAbs = path.join(TEXTURES, `${cardNo}.png`);
        if (fs.existsSync(srcAbs)) {
          fs.mkdirSync(TEXTURES, { recursive: true });
          if (!fs.existsSync(destAbs) || opts.forceImages) {
            const ok = await convertImageToPng(srcAbs, destAbs);
            if (ok) imageOk++;
            else imageFail++;
          } else {
            imageOk++;
          }
        } else {
          imageFail++;
        }
      }
    }
  }

  const outJson = path.join(SCRIPTS, `${expansion}-cards.json`);
  fs.writeFileSync(outJson, JSON.stringify(cards, null, 2) + "\n");

  const base = cards.filter((c) => c.type === "base").length;
  const evo = cards.filter((c) => c.type === "evolved").length;
  const tok = cards.filter((c) => c.type === "token").length;
  console.log(
    `${expansion}: ${cards.length} cards (base=${base}, evo=${evo}, token=${tok}) -> ${outJson}`,
  );
  if (!opts.skipImages) {
    console.log(`  images: ${imageOk} ok, ${imageFail} missing/failed`);
  }
  return cards;
}

async function main() {
  const argv = process.argv.slice(2);
  const skipImages = argv.includes("--skip-images");
  const forceImages = argv.includes("--force-images");

  let jobs = [];
  if (argv.includes("--all")) {
    jobs = SET_FILES.map((s) => ({
      htmlPath: path.join(PARENT, s.file),
      expansion: s.expansion,
      setName: s.setName,
    }));
  } else if (argv[0] && !argv[0].startsWith("--")) {
    const htmlPath = path.resolve(argv[0]);
    const nameIdx = argv.indexOf("--set-name");
    const setName = nameIdx !== -1 ? argv[nameIdx + 1] : path.basename(htmlPath, ".html");
    const base = path.basename(htmlPath);
    const known = SET_FILES.find((s) => s.file === base);
    const expansion =
      (argv.includes("--expansion") && argv[argv.indexOf("--expansion") + 1]) ||
      known?.expansion ||
      base.split(/[_\s]/)[0];
    jobs = [
      {
        htmlPath,
        expansion,
        setName: known?.setName || setName,
      },
    ];
  } else {
    console.error(
      'Usage: node src/scripts/import-sheet-html.js --all\n' +
        '   or: node src/scripts/import-sheet-html.js "<html>" --expansion BP18 --set-name "Neometropolis"',
    );
    process.exit(1);
  }

  for (const job of jobs) {
    if (!fs.existsSync(job.htmlPath)) {
      console.error(`Missing HTML: ${job.htmlPath}`);
      process.exit(1);
    }
    await importFile(job.htmlPath, job.expansion, job.setName, {
      skipImages,
      forceImages,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
