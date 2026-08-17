"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cardMatchesFilter = cardMatchesFilter;
exports.evalCondition = evalCondition;
const registry_1 = require("../cards/registry");
const reprints_1 = require("../cards/reprints");
const passives_1 = require("./passives");
const queries_1 = require("./queries");
function cardMatchesFilter(cardNo, filter, state) {
    if (filter.anyOf?.length) {
        return filter.anyOf.some((alt) => cardMatchesFilter(cardNo, alt, state));
    }
    const def = (0, registry_1.getCardDef)(cardNo);
    if (!def)
        return false;
    const filterName = filter.name || filter.cardNo;
    if (filterName) {
        // Exact name match (or legacy printing code → same identity key).
        const filterDef = (0, registry_1.getCardDef)(filterName);
        if (!filterDef)
            return false;
        if ((0, reprints_1.cardIdentityKey)(def) !== (0, reprints_1.cardIdentityKey)(filterDef))
            return false;
    }
    if (filter.trait && !def.traits?.includes(filter.trait))
        return false;
    if (filter.allTraits?.length) {
        for (const t of filter.allTraits) {
            if (!def.traits?.includes(t))
                return false;
        }
    }
    if (filter.cardClass && def.class !== filter.cardClass)
        return false;
    const cost = (0, queries_1.resolveCardDefCost)(cardNo);
    if (filter.maxCost != null && cost > filter.maxCost)
        return false;
    if (filter.minCost != null && cost < filter.minCost)
        return false;
    if (filter.cardType && def.cardType !== filter.cardType)
        return false;
    if (filter.identityName) {
        if ((0, reprints_1.normalizeIdentityName)(def.name) !== (0, reprints_1.normalizeIdentityName)(filter.identityName)) {
            return false;
        }
    }
    if (filter.identityNameContains) {
        const needle = filter.identityNameContains.toLowerCase();
        if (!(0, reprints_1.normalizeIdentityName)(def.name).toLowerCase().includes(needle))
            return false;
    }
    if (filter.excludeIdentityName) {
        const excluded = (0, reprints_1.normalizeIdentityName)(filter.excludeIdentityName);
        if ((0, reprints_1.normalizeIdentityName)(def.name) === excluded)
            return false;
    }
    if (filter.excludeLastSelectedIdentity) {
        const last = state?.resolutionContext?.lastSelectedCardName;
        if (last && (0, reprints_1.normalizeIdentityName)(def.name) === (0, reprints_1.normalizeIdentityName)(last)) {
            return false;
        }
    }
    return true;
}
function countTraitInZone(state, player, zone, trait) {
    return (0, queries_1.getPlayer)(state, player).zones[zone].filter((c) => (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, c))?.traits?.includes(trait)).length;
}
function evalCondition(state, player, condition) {
    switch (condition.type) {
        case "always":
            return true;
        case "overflow":
            return (0, queries_1.isOverflowActive)(state, player);
        case "combo":
            return (0, queries_1.getPlayer)(state, player).flags.cardsPlayedThisTurn >= condition.count;
        case "spellPlayedThisTurn":
            return ((0, queries_1.getPlayer)(state, player).flags.spellsPlayedThisTurn ?? 0) >= 1;
        case "namedFollowerOnField":
            return (0, queries_1.getPlayer)(state, player).zones.field.some((c) => c.name === condition.name);
        case "namedFollowerOnFieldByName":
            return (0, passives_1.hasNamedFollowerOnFieldByIdentity)(state, player, condition.identityName);
        case "namedFollowerOnFieldContains": {
            const needle = condition.identityNameContains.toLowerCase();
            return (0, queries_1.getPlayer)(state, player).zones.field.some((c) => {
                const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, c));
                if (!def || def.cardType !== "follower")
                    return false;
                return (0, reprints_1.normalizeIdentityName)(def.name).toLowerCase().includes(needle);
            });
        }
        case "selectedTargetHasTraits": {
            const targetId = state.resolutionContext?.lastSelectedTargetId ??
                state.resolutionContext?.forcedTargetId;
            if (!targetId || targetId === "leader" || targetId === "selfLeader")
                return false;
            const found = (0, queries_1.findInstance)(state, targetId);
            if (!found)
                return false;
            const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, found.card));
            if (!def?.traits?.length)
                return false;
            return condition.allTraits.every((t) => def.traits.includes(t));
        }
        case "sourcePersistentCounterMin": {
            const sourceId = state.resolutionContext?.sourceInstanceId;
            if (!sourceId)
                return false;
            const found = (0, queries_1.findInstance)(state, sourceId);
            if (!found)
                return false;
            return (found.card.persistentCounters?.[condition.key] ?? 0) >= condition.count;
        }
        case "lastRevealedIdentityContains": {
            const list = state.revealedCards;
            if (!list?.length)
                return false;
            const last = list[list.length - 1];
            const needle = condition.identityNameContains.toLowerCase();
            return (0, reprints_1.normalizeIdentityName)(last.name).toLowerCase().includes(needle);
        }
        case "notEnteredFromHand": {
            const sourceId = state.resolutionContext?.sourceInstanceId;
            if (!sourceId)
                return false;
            const found = (0, queries_1.findInstance)(state, sourceId);
            return found?.card.enteredFromHand === false;
        }
        case "enteredFromCemetery": {
            const sourceId = state.resolutionContext?.sourceInstanceId;
            if (!sourceId)
                return false;
            const found = (0, queries_1.findInstance)(state, sourceId);
            return found?.card.enteredFromCemetery === true;
        }
        case "opponentCemeteryMin": {
            const opp = (0, queries_1.opponentOf)(player);
            return (0, queries_1.getPlayer)(state, opp).zones.cemetery.length >= condition.count;
        }
        case "exAreaTraitMin":
            return countTraitInZone(state, player, "exArea", condition.trait) >= condition.count;
        case "exAreaNamedMin": {
            const target = (0, reprints_1.normalizeIdentityName)(condition.identityName);
            const count = (0, queries_1.getPlayer)(state, player).zones.exArea.filter((c) => {
                const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, c));
                return def && (0, reprints_1.normalizeIdentityName)(def.name) === target;
            }).length;
            return count >= condition.count;
        }
        case "ownCemeteryTraitMin":
            return countTraitInZone(state, player, "cemetery", condition.trait) >= condition.count;
        case "ownDeckTraitMin":
            return countTraitInZone(state, player, "deck", condition.trait) >= condition.count;
        case "fieldTraitMin": {
            // Card text usually means followers (e.g. Mono: "5 Machina followers").
            const count = (0, queries_1.getPlayer)(state, player).zones.field.filter((c) => {
                const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, c));
                return def?.cardType === "follower" && def.traits?.includes(condition.trait);
            }).length;
            return count >= condition.count;
        }
        case "handTraitMin":
            return countTraitInZone(state, player, "hand", condition.trait) >= condition.count;
        case "ownCemeteryClassMin":
            return (0, queries_1.getPlayer)(state, player).zones.cemetery.filter((c) => (0, registry_1.getCardDef)(c.name)?.class === condition.cardClass).length >= condition.count;
        case "ownDeckClassMin":
            return (0, queries_1.getPlayer)(state, player).zones.deck.filter((c) => (0, registry_1.getCardDef)(c.name)?.class === condition.cardClass).length >= condition.count;
        case "fieldFollowerMinCost": {
            let matches = 0;
            for (const card of (0, queries_1.getPlayer)(state, player).zones.field) {
                const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, card));
                if (!def?.traits?.includes(condition.trait))
                    continue;
                if ((0, queries_1.resolveCardDefCost)(card.name) >= condition.minCost)
                    matches += 1;
            }
            return matches >= condition.count;
        }
        case "buriedExactCost":
            return (state.resolutionContext?.buriedCosts ?? []).some((c) => c === condition.cost);
        case "buriedAtLeastCost":
            return (state.resolutionContext?.buriedCosts ?? []).some((c) => c >= condition.cost);
        case "discardedCardType": {
            const cardNo = state.resolutionContext?.lastDiscardedCardName;
            if (!cardNo)
                return false;
            return (0, registry_1.getCardDef)(cardNo)?.cardType === condition.cardType;
        }
        case "handMin":
            return (0, queries_1.getPlayer)(state, player).zones.hand.length >= condition.count;
        case "ownCemeteryMin":
            return (0, queries_1.getPlayer)(state, player).zones.cemetery.length >= condition.count;
        case "cemeteryDistinctCostRange": {
            const costs = new Set((0, queries_1.getPlayer)(state, player).zones.cemetery.map((c) => (0, queries_1.resolveCardDefCost)(c.name)));
            for (let cost = condition.from; cost <= condition.to; cost++) {
                if (!costs.has(cost))
                    return false;
            }
            return true;
        }
        case "fieldTraitMax":
            return countTraitInZone(state, player, "field", condition.trait) <= condition.count;
        case "fieldCardTraitMin":
            return countTraitInZone(state, player, "field", condition.trait) >= condition.count;
        case "leaderDefMax":
            return (0, queries_1.getPlayer)(state, player).leaderDef <= condition.count;
        case "lastSelectedCostMax": {
            const targetId = state.resolutionContext?.lastSelectedTargetId ??
                state.resolutionContext?.forcedTargetId;
            if (!targetId || targetId === "leader" || targetId === "selfLeader")
                return false;
            const found = (0, queries_1.findInstance)(state, targetId);
            if (!found)
                return false;
            return (0, queries_1.resolveCardDefCost)((0, queries_1.resolveCardNo)(state, found.card)) <= condition.count;
        }
        case "unionBurstActivatedMin": {
            const flags = (0, queries_1.getPlayer)(state, player).flags;
            const ids = flags.unionBurstSourceIdsThisTurn ?? [];
            if (condition.excludeSource) {
                const excludeId = state.resolutionContext?.resolvingUnionBurstSourceId ??
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
                // Numeric flag only counts completed UBs; a deferred current activation is
                // not included, so do not subtract an extra "self".
                return (flags.unionBurstsActivatedThisTurn ?? 0) >= condition.count;
            }
            const count = ids.length > 0 ? ids.length : (flags.unionBurstsActivatedThisTurn ?? 0);
            return count >= condition.count;
        }
        case "maxPpMin":
            return (0, queries_1.getPlayer)(state, player).maxPp >= condition.count;
        case "maxPpEquals":
            return (0, queries_1.getPlayer)(state, player).maxPp === condition.count;
        case "fieldFollowerMin": {
            const count = (0, queries_1.getPlayer)(state, player).zones.field.filter((c) => {
                const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, c));
                return def?.cardType === "follower";
            }).length;
            return count >= condition.count;
        }
        case "fieldFollowerMinCostAny": {
            return (0, queries_1.getPlayer)(state, player).zones.field.some((c) => {
                const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, c));
                if (!def || def.cardType !== "follower")
                    return false;
                return (0, queries_1.resolveCardDefCost)(c.name) >= condition.minCost;
            });
        }
        default:
            return false;
    }
}
