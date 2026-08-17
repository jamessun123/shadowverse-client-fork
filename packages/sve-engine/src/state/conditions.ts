import { getCardDef } from "../cards/registry";
import { cardIdentityKey, normalizeIdentityName } from "../cards/reprints";
import { Condition, DeckFilter, GameState, PlayerId } from "../types";
import { hasNamedFollowerOnFieldByIdentity } from "./passives";
import {
  findInstance,
  getPlayer,
  isOverflowActive,
  opponentOf,
  resolveCardDefCost,
  resolveCardNo,
} from "./queries";

export function cardMatchesFilter(
  cardNo: string,
  filter: DeckFilter,
  state?: GameState,
): boolean {
  if (filter.anyOf?.length) {
    return filter.anyOf.some((alt) => cardMatchesFilter(cardNo, alt, state));
  }
  const def = getCardDef(cardNo);
  if (!def) return false;
  const filterName = filter.name || filter.cardNo;
  if (filterName) {
    // Exact name match (or legacy printing code → same identity key).
    const filterDef = getCardDef(filterName);
    if (!filterDef) return false;
    if (cardIdentityKey(def) !== cardIdentityKey(filterDef)) return false;
  }
  if (filter.trait && !def.traits?.includes(filter.trait)) return false;
  if (filter.allTraits?.length) {
    for (const t of filter.allTraits) {
      if (!def.traits?.includes(t)) return false;
    }
  }
  if (filter.cardClass && def.class !== filter.cardClass) return false;
  const cost = resolveCardDefCost(cardNo);
  if (filter.maxCost != null && cost > filter.maxCost) return false;
  if (filter.minCost != null && cost < filter.minCost) return false;
  if (filter.cardType && def.cardType !== filter.cardType) return false;
  if (filter.identityName) {
    if (normalizeIdentityName(def.name) !== normalizeIdentityName(filter.identityName)) {
      return false;
    }
  }
  if (filter.identityNameContains) {
    const needle = filter.identityNameContains.toLowerCase();
    if (!normalizeIdentityName(def.name).toLowerCase().includes(needle)) return false;
  }
  if (filter.excludeIdentityName) {
    const excluded = normalizeIdentityName(filter.excludeIdentityName);
    if (normalizeIdentityName(def.name) === excluded) return false;
  }
  if (filter.excludeLastSelectedIdentity) {
    const last = state?.resolutionContext?.lastSelectedCardName;
    if (last && normalizeIdentityName(def.name) === normalizeIdentityName(last)) {
      return false;
    }
  }
  return true;
}

function countTraitInZone(
  state: GameState,
  player: PlayerId,
  zone: "exArea" | "cemetery" | "field" | "hand" | "deck",
  trait: string,
): number {
  return getPlayer(state, player).zones[zone].filter((c) =>
    getCardDef(resolveCardNo(state, c))?.traits?.includes(trait),
  ).length;
}

export function evalCondition(state: GameState, player: PlayerId, condition: Condition): boolean {
  switch (condition.type) {
    case "always":
      return true;
    case "overflow":
      return isOverflowActive(state, player);
    case "combo":
      return getPlayer(state, player).flags.cardsPlayedThisTurn >= condition.count;
    case "spellPlayedThisTurn":
      return (getPlayer(state, player).flags.spellsPlayedThisTurn ?? 0) >= 1;
    case "namedFollowerOnField":
      return getPlayer(state, player).zones.field.some((c) => c.name === condition.name);
    case "namedFollowerOnFieldByName":
      return hasNamedFollowerOnFieldByIdentity(state, player, condition.identityName);
    case "namedFollowerOnFieldContains": {
      const needle = condition.identityNameContains.toLowerCase();
      return getPlayer(state, player).zones.field.some((c) => {
        const def = getCardDef(resolveCardNo(state, c));
        if (!def || def.cardType !== "follower") return false;
        return normalizeIdentityName(def.name).toLowerCase().includes(needle);
      });
    }
    case "selectedTargetHasTraits": {
      const targetId =
        state.resolutionContext?.lastSelectedTargetId ??
        state.resolutionContext?.forcedTargetId;
      if (!targetId || targetId === "leader" || targetId === "selfLeader") return false;
      const found = findInstance(state, targetId);
      if (!found) return false;
      const def = getCardDef(resolveCardNo(state, found.card));
      if (!def?.traits?.length) return false;
      return condition.allTraits.every((t) => def.traits!.includes(t));
    }
    case "sourcePersistentCounterMin": {
      const sourceId = state.resolutionContext?.sourceInstanceId;
      if (!sourceId) return false;
      const found = findInstance(state, sourceId);
      if (!found) return false;
      return (found.card.persistentCounters?.[condition.key] ?? 0) >= condition.count;
    }
    case "lastRevealedIdentityContains": {
      const list = state.revealedCards;
      if (!list?.length) return false;
      const last = list[list.length - 1];
      const needle = condition.identityNameContains.toLowerCase();
      return normalizeIdentityName(last.name).toLowerCase().includes(needle);
    }
    case "notEnteredFromHand": {
      const sourceId = state.resolutionContext?.sourceInstanceId;
      if (!sourceId) return false;
      const found = findInstance(state, sourceId);
      return found?.card.enteredFromHand === false;
    }
    case "enteredFromCemetery": {
      const sourceId = state.resolutionContext?.sourceInstanceId;
      if (!sourceId) return false;
      const found = findInstance(state, sourceId);
      return found?.card.enteredFromCemetery === true;
    }
    case "opponentCemeteryMin": {
      const opp = opponentOf(player);
      return getPlayer(state, opp).zones.cemetery.length >= condition.count;
    }
    case "exAreaTraitMin":
      return countTraitInZone(state, player, "exArea", condition.trait) >= condition.count;
    case "exAreaNamedMin": {
      const target = normalizeIdentityName(condition.identityName);
      const count = getPlayer(state, player).zones.exArea.filter((c) => {
        const def = getCardDef(resolveCardNo(state, c));
        return def && normalizeIdentityName(def.name) === target;
      }).length;
      return count >= condition.count;
    }
    case "ownCemeteryTraitMin":
      return countTraitInZone(state, player, "cemetery", condition.trait) >= condition.count;
    case "ownDeckTraitMin":
      return countTraitInZone(state, player, "deck", condition.trait) >= condition.count;
    case "fieldTraitMin": {
      // Card text usually means followers (e.g. Mono: "5 Machina followers").
      const count = getPlayer(state, player).zones.field.filter((c) => {
        const def = getCardDef(resolveCardNo(state, c));
        return def?.cardType === "follower" && def.traits?.includes(condition.trait);
      }).length;
      return count >= condition.count;
    }
    case "handTraitMin":
      return countTraitInZone(state, player, "hand", condition.trait) >= condition.count;
    case "ownCemeteryClassMin":
      return getPlayer(state, player).zones.cemetery.filter(
        (c) => getCardDef(c.name)?.class === condition.cardClass,
      ).length >= condition.count;
    case "ownDeckClassMin":
      return getPlayer(state, player).zones.deck.filter(
        (c) => getCardDef(c.name)?.class === condition.cardClass,
      ).length >= condition.count;
    case "fieldFollowerMinCost": {
      let matches = 0;
      for (const card of getPlayer(state, player).zones.field) {
        const def = getCardDef(resolveCardNo(state, card));
        if (!def?.traits?.includes(condition.trait)) continue;
        if (resolveCardDefCost(card.name) >= condition.minCost) matches += 1;
      }
      return matches >= condition.count;
    }
    case "buriedExactCost":
      return (state.resolutionContext?.buriedCosts ?? []).some((c) => c === condition.cost);
    case "buriedAtLeastCost":
      return (state.resolutionContext?.buriedCosts ?? []).some((c) => c >= condition.cost);
    case "discardedCardType": {
      const cardNo = state.resolutionContext?.lastDiscardedCardName;
      if (!cardNo) return false;
      return getCardDef(cardNo)?.cardType === condition.cardType;
    }
    case "handMin":
      return getPlayer(state, player).zones.hand.length >= condition.count;
    case "ownCemeteryMin":
      return getPlayer(state, player).zones.cemetery.length >= condition.count;
    case "cemeteryDistinctCostRange": {
      const costs = new Set(
        getPlayer(state, player).zones.cemetery.map((c) => resolveCardDefCost(c.name)),
      );
      for (let cost = condition.from; cost <= condition.to; cost++) {
        if (!costs.has(cost)) return false;
      }
      return true;
    }
    case "fieldTraitMax":
      return countTraitInZone(state, player, "field", condition.trait) <= condition.count;
    case "fieldCardTraitMin":
      return countTraitInZone(state, player, "field", condition.trait) >= condition.count;
    case "leaderDefMax":
      return getPlayer(state, player).leaderDef <= condition.count;
    case "lastSelectedCostMax": {
      const targetId =
        state.resolutionContext?.lastSelectedTargetId ??
        state.resolutionContext?.forcedTargetId;
      if (!targetId || targetId === "leader" || targetId === "selfLeader") return false;
      const found = findInstance(state, targetId);
      if (!found) return false;
      return resolveCardDefCost(resolveCardNo(state, found.card)) <= condition.count;
    }
    case "unionBurstActivatedMin": {
      const flags = getPlayer(state, player).flags;
      const ids = flags.unionBurstSourceIdsThisTurn ?? [];
      if (condition.excludeSource) {
        const excludeId =
          state.resolutionContext?.resolvingUnionBurstSourceId ??
          state.resolutionContext?.pendingUnionBurst?.sourceInstanceId ??
          state.resolutionContext?.sourceInstanceId;
        // Prefer instance-id list so the resolving card can be filtered out even if
        // it was already recorded (early-record paths).
        if (ids.length > 0) {
          const otherCount = excludeId
            ? ids.filter((id) => id !== excludeId).length
            : ids.length;
          return otherCount >= condition.count;
        }
        // Numeric fallback (no id list yet): deferred activations aren't in the
        // count; if somehow already counted, drop one while resolving.
        const n = flags.unionBurstsActivatedThisTurn ?? 0;
        if (state.resolutionContext?.pendingUnionBurst) return n >= condition.count;
        if (excludeId && n > 0) return Math.max(0, n - 1) >= condition.count;
        return n >= condition.count;
      }
      const count = ids.length > 0 ? ids.length : (flags.unionBurstsActivatedThisTurn ?? 0);
      return count >= condition.count;
    }
    case "maxPpMin":
      return getPlayer(state, player).maxPp >= condition.count;
    case "maxPpEquals":
      return getPlayer(state, player).maxPp === condition.count;
    case "fieldFollowerMin": {
      const count = getPlayer(state, player).zones.field.filter((c) => {
        const def = getCardDef(resolveCardNo(state, c));
        return def?.cardType === "follower";
      }).length;
      return count >= condition.count;
    }
    case "fieldFollowerMinCostAny": {
      return getPlayer(state, player).zones.field.some((c) => {
        const def = getCardDef(resolveCardNo(state, c));
        if (!def || def.cardType !== "follower") return false;
        return resolveCardDefCost(c.name) >= condition.minCost;
      });
    }
    default:
      return false;
  }
}
