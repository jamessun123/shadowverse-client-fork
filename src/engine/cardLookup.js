import mvpCards from "./mvp-cards.json";
import cardStats from "./card-stats.json";
import { allCards } from "../decks/AllCards";
import { allCardsEvo } from "../decks/AllCardsEvo";
import { allTokens } from "../decks/AllTokens";
import { getCardNoFromName } from "../decks/getCards";

const byCardNo = new Map();
const byName = new Map();
let fullIndexBuilt = false;

function register(card) {
  if (!card?.cardNo) return;
  byCardNo.set(card.cardNo, card);
  if (card.name) byName.set(card.name, card);
}

for (const card of mvpCards) {
  register(card);
}

for (const [cardNo, stats] of Object.entries(cardStats)) {
  if (!stats) continue;
  register({
    cardNo,
    name: stats.name || cardNo,
    cost: stats.cost,
    attack: stats.attack,
    defense: stats.defense,
    keywords: stats.keywords,
    cardType: stats.cardType,
    reprintOf: stats.reprintOf,
  });
}

// Tokens are often summoned by name; ensure they resolve for art/stats.
for (const name of allTokens) {
  ensureNameRegistered(name);
}

function resolveGameplayCardNo(cardNo) {
  const direct = cardStats[cardNo];
  if (direct?.reprintOf && cardStats[direct.reprintOf]) {
    return direct.reprintOf;
  }
  return cardNo;
}

function ensureNameRegistered(name) {
  if (!name || byName.has(name)) return;
  const cardNo = getCardNoFromName(name);
  if (cardNo) register({ cardNo, name });
}

function ensureFullIndex() {
  if (fullIndexBuilt) return;
  fullIndexBuilt = true;
  for (const name of new Set([...allCards, ...allCardsEvo])) {
    ensureNameRegistered(name);
  }
}

function mergeStats(cardNo, card) {
  const gameplayNo = resolveGameplayCardNo(cardNo);
  const stats = cardStats[cardNo] || cardStats[gameplayNo];
  if (!stats) return card;
  const gameplayStats = gameplayNo !== cardNo ? cardStats[gameplayNo] : null;
  return {
    ...card,
    name: card.name || stats.name || gameplayStats?.name || cardNo,
    cost: stats.cost ?? gameplayStats?.cost ?? card.cost,
    attack: stats.attack ?? gameplayStats?.attack ?? card.attack,
    defense: stats.defense ?? gameplayStats?.defense ?? card.defense,
    keywords: stats.keywords?.length
      ? stats.keywords
      : gameplayStats?.keywords?.length
        ? gameplayStats.keywords
        : card.keywords,
    cardType: stats.cardType ?? gameplayStats?.cardType ?? card.cardType,
  };
}

export function getCardDefClient(nameOrCardNo) {
  ensureNameRegistered(nameOrCardNo);
  const byNameHit = byName.get(nameOrCardNo);
  if (byNameHit) return mergeStats(byNameHit.cardNo, byNameHit);
  const existing = byCardNo.get(nameOrCardNo);
  if (existing) return mergeStats(nameOrCardNo, existing);
  const gameplayNo = resolveGameplayCardNo(nameOrCardNo);
  const gameplay = byCardNo.get(gameplayNo);
  if (gameplay) {
    return mergeStats(nameOrCardNo, {
      ...gameplay,
      cardNo: nameOrCardNo,
      name: cardStats[nameOrCardNo]?.name || gameplay.name,
    });
  }
  const stats = cardStats[nameOrCardNo] || cardStats[gameplayNo];
  if (!stats) return undefined;
  const name = stats.name || getNameByCardNoClient(nameOrCardNo) || nameOrCardNo;
  return mergeStats(nameOrCardNo, { cardNo: nameOrCardNo, name, ...stats });
}

function statValue(...values) {
  for (const v of values) {
    if (v != null && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

export function getCardStatsClient(nameOrCardNo) {
  const def = getCardDefClient(nameOrCardNo);
  const cardNo = def?.cardNo || nameOrCardNo;
  const gameplayNo = resolveGameplayCardNo(cardNo);
  const stats = cardStats[cardNo] || cardStats[gameplayNo] || {};
  let cardType = def?.cardType ?? stats.cardType ?? null;
  // Authored defs / incomplete scrapes may omit cardType while still having stats.
  if (!cardType && (def?.attack != null || stats.attack != null)) {
    cardType = "follower";
  }
  const isFollower = cardType === "follower";
  return {
    // null (not 0) when printed stats are missing — avoids a false "0" ATK/DEF overlay.
    attack: isFollower ? statValue(def?.attack, stats.attack) : null,
    defense: isFollower ? statValue(def?.defense, stats.defense) : null,
    cost: statValue(def?.cost, stats.cost) ?? 0,
    keywords: def?.keywords ?? stats.keywords ?? [],
    cardType,
  };
}

export function getCardByNameClient(name) {
  ensureNameRegistered(name);
  return byName.get(name);
}

export function getNameByCardNoClient(cardNo) {
  if (byCardNo.has(cardNo)) return byCardNo.get(cardNo).name;
  if (cardStats[cardNo]?.name) return cardStats[cardNo].name;
  const gameplayNo = resolveGameplayCardNo(cardNo);
  if (gameplayNo !== cardNo && cardStats[gameplayNo]?.name) {
    return cardStats[gameplayNo].name;
  }
  ensureFullIndex();
  return byCardNo.get(cardNo)?.name ?? null;
}

