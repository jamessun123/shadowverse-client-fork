"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBoxed = void 0;
exports.getPlayer = getPlayer;
exports.isEquippedAttachment = isEquippedAttachment;
exports.fieldOccupancy = fieldOccupancy;
exports.hasFieldSpace = hasFieldSpace;
exports.findInstance = findInstance;
exports.getBaseCardNoForInstance = getBaseCardNoForInstance;
exports.computeEvolvePayment = computeEvolvePayment;
exports.canSuperEvolveNow = canSuperEvolveNow;
exports.resolveCardNo = resolveCardNo;
exports.resolveCardDefCost = resolveCardDefCost;
exports.getExAreaPlayCostReduction = getExAreaPlayCostReduction;
exports.getPassivePlayCostReduction = getPassivePlayCostReduction;
exports.getGrantedPlayCostReduction = getGrantedPlayCostReduction;
exports.consumeGrantedPlayCostReductions = consumeGrantedPlayCostReductions;
exports.getEffectivePlayCost = getEffectivePlayCost;
exports.getEffectiveStats = getEffectiveStats;
exports.isFollowerCard = isFollowerCard;
exports.getEvolveCost = getEvolveCost;
exports.getAvailableEvolveCosts = getAvailableEvolveCosts;
exports.getEffectiveEvolveCost = getEffectiveEvolveCost;
exports.hasKeyword = hasKeyword;
exports.clampDamageToFollower = clampDamageToFollower;
exports.canEvolveFollower = canEvolveFollower;
exports.getActivatedAbilities = getActivatedAbilities;
exports.evolveCardsMatch = evolveCardsMatch;
exports.findMatchingEvolveCard = findMatchingEvolveCard;
exports.getStrikeAbilities = getStrikeAbilities;
exports.opponentOf = opponentOf;
exports.isOverflowActive = isOverflowActive;
exports.canAttackLeader = canAttackLeader;
exports.getWardTargets = getWardTargets;
exports.getLegalAttackTargets = getLegalAttackTargets;
const registry_1 = require("../cards/registry");
const reprints_1 = require("../cards/reprints");
const conditions_1 = require("./conditions");
const passives_1 = require("./passives");
const effect_utils_1 = require("../rules/effect-utils");
function canActivateEffectResolve(state, player, effect, sourceInstanceId) {
    const probe = sourceInstanceId != null
        ? {
            ...state,
            resolutionContext: {
                sourceInstanceId,
                effectStack: state.resolutionContext?.effectStack ?? [],
                resumeAfterChoice: state.resolutionContext?.resumeAfterChoice,
                pendingUnionBurst: state.resolutionContext?.pendingUnionBurst,
                resolvingUnionBurstSourceId: state.resolutionContext?.resolvingUnionBurstSourceId,
            },
        }
        : state;
    switch (effect.op) {
        case "sequence":
            return effect.steps.every((step) => canActivateEffectResolve(probe, player, step, sourceInstanceId));
        case "if": {
            // Treat missing else / noop else as a gate (same as choose-option filtering).
            const elseIsNoop = !effect.else || effect.else.op === "noop";
            if (elseIsNoop) {
                return ((0, conditions_1.evalCondition)(probe, player, effect.condition) &&
                    canActivateEffectResolve(probe, player, effect.then, sourceInstanceId));
            }
            if (!(0, conditions_1.evalCondition)(probe, player, effect.condition)) {
                return canActivateEffectResolve(probe, player, effect.else, sourceInstanceId);
            }
            return canActivateEffectResolve(probe, player, effect.then, sourceInstanceId);
        }
        case "choose":
        case "chooseMultiple":
            return effect.options.some((o) => (!o.additionalPpCost || getPlayer(probe, player).pp >= o.additionalPpCost) &&
                canActivateEffectResolve(probe, player, o.effect, sourceInstanceId));
        case "tutorFromDeck": {
            if (effect.optional)
                return true;
            return getPlayer(probe, player).zones.deck.some((c) => (0, conditions_1.cardMatchesFilter)(c.name, effect.filter, probe));
        }
        case "discardFromHand": {
            const need = effect.count ?? 1;
            return (getPlayer(probe, player).zones.hand.filter((c) => (0, conditions_1.cardMatchesFilter)(c.name, effect.filter)).length >= need);
        }
        default:
            return true;
    }
}
function getPlayer(state, player) {
    return state.players[player];
}
/** Equipment sits on the field zone but does not occupy a board slot. */
function isEquippedAttachment(card) {
    return Boolean(card.equippedToInstanceId);
}
/** Board occupants only (followers/amulets that are not attached equipment). */
function fieldOccupancy(field) {
    return field.filter((c) => !isEquippedAttachment(c)).length;
}
function hasFieldSpace(field, fieldLimit) {
    return fieldOccupancy(field) < fieldLimit;
}
function findInstance(state, instanceId) {
    for (const pid of [0, 1]) {
        const zones = state.players[pid].zones;
        for (const [zoneName, cards] of Object.entries(zones)) {
            if (zoneName === "evolveZone")
                continue;
            const list = cards;
            const card = list.find((c) => c.instanceId === instanceId);
            if (card)
                return { card, player: pid, zone: zoneName };
        }
    }
    return null;
}
/** Base printing to use for play cost / unevolved stats (evolved printings in hand count as base). */
function getBaseCardNoForInstance(cardNo, linkedEvoInstanceId) {
    if (linkedEvoInstanceId)
        return cardNo;
    const def = (0, registry_1.getCardDef)(cardNo);
    if (!def)
        return cardNo;
    if (def.evolvesTo)
        return cardNo;
    const kind = (0, reprints_1.cardIdentityKey)(def).split("|")[1];
    if (kind === "evolved" && def.evolvesFrom)
        return def.evolvesFrom;
    return cardNo;
}
function parseEvolveCostFromText(cardText) {
    const match = cardText.match(/\[evolve\]\s*\[cost(\d+)\]/i);
    if (match)
        return Number(match[1]);
    return null;
}
function computeEvolvePayment(cost, pp, evoPoints, useEvoPoint) {
    if (cost <= 0)
        return { ok: true, ppCost: 0, epCost: 0 };
    if (!useEvoPoint) {
        return { ok: pp >= cost, ppCost: cost, epCost: 0 };
    }
    const epCost = Math.min(1, evoPoints, cost);
    if (epCost <= 0)
        return { ok: false, ppCost: cost, epCost: 0 };
    const ppCost = cost - epCost;
    return { ok: pp >= ppCost, ppCost, epCost };
}
function canSuperEvolveNow(state, player) {
    const p = state.players[player];
    if (p.superEvoPoints <= 0)
        return false;
    const threshold = player === state.firstPlayer ? 7 : 6;
    return p.turnsPassed >= threshold;
}
/** When evolved, the evolve card's definition applies for stats/keywords/abilities. */
function resolveCardNo(state, card) {
    if (state && card.linkedEvoInstanceId) {
        const evo = findInstance(state, card.linkedEvoInstanceId);
        if (evo)
            return evo.card.name;
    }
    const def = (0, registry_1.getCardDef)(card.name);
    if (def?.evolvesFrom && !def.evolvesTo) {
        return card.name;
    }
    return getBaseCardNoForInstance(card.name, card.linkedEvoInstanceId);
}
var passives_2 = require("./passives");
Object.defineProperty(exports, "isBoxed", { enumerable: true, get: function () { return passives_2.isBoxed; } });
/** Printed play cost; evolved promos with cost 0 inherit from their base form. */
function resolveCardDefCost(cardNo) {
    const def = (0, registry_1.getCardDef)(cardNo);
    if (!def)
        return 0;
    if (def.cost > 0)
        return def.cost;
    if (def.evolvesFrom) {
        const from = (0, registry_1.getCardDef)(def.evolvesFrom);
        if (from && from.cost > 0)
            return from.cost;
    }
    return def.cost;
}
function exAreaReductionFromAbilities(abilities, state, player, cardNo) {
    let reduction = 0;
    for (const ability of abilities ?? []) {
        if (ability.timing !== "passive")
            continue;
        if (ability.condition && !(0, conditions_1.evalCondition)(state, player, ability.condition))
            continue;
        if (ability.filter && !(0, conditions_1.cardMatchesFilter)(cardNo, ability.filter))
            continue;
        if (ability.effect.op === "exAreaPlayCostReduction") {
            reduction += ability.effect.amount;
        }
    }
    return reduction;
}
/** EX-area discount from passives on the card being played and followers on field (e.g. Tetra Evo). */
function getExAreaPlayCostReduction(state, player, cardNo) {
    let reduction = exAreaReductionFromAbilities((0, registry_1.getCardDef)(cardNo)?.abilities, state, player, cardNo);
    for (const source of getPlayer(state, player).zones.field) {
        if ((0, passives_1.isBoxed)(source, state))
            continue;
        reduction += exAreaReductionFromAbilities((0, registry_1.getCardDef)(resolveCardNo(state, source))?.abilities, state, player, cardNo);
    }
    return reduction;
}
function getPassivePlayCostReduction(state, player, cardNo) {
    const def = (0, registry_1.getCardDef)(cardNo);
    let reduction = 0;
    for (const ability of def?.abilities ?? []) {
        if (ability.timing !== "passive")
            continue;
        if (ability.condition && !(0, conditions_1.evalCondition)(state, player, ability.condition))
            continue;
        if (ability.effect.op === "playCostReduction") {
            reduction += ability.effect.amount;
        }
    }
    return reduction;
}
/**
 * Pending "next matching card costs less" grants from activate abilities
 * (stored on field/EX via grantOnCardPlayed + playCostReduction).
 */
function getGrantedPlayCostReduction(state, player, cardNo) {
    let reduction = 0;
    const zones = getPlayer(state, player).zones;
    for (const source of [...zones.field, ...zones.exArea]) {
        if ((0, passives_1.isBoxed)(source, state))
            continue;
        for (const granted of source.grantedOnCardPlayed ?? []) {
            if (granted.effect.op !== "playCostReduction")
                continue;
            if (granted.filter && !(0, conditions_1.cardMatchesFilter)(cardNo, granted.filter))
                continue;
            reduction += granted.effect.amount;
        }
    }
    return reduction;
}
/** Consume pending play-cost grants that matched a card that was just played. */
function consumeGrantedPlayCostReductions(state, player, cardNo) {
    const zones = getPlayer(state, player).zones;
    for (const source of [...zones.field, ...zones.exArea]) {
        if (!source.grantedOnCardPlayed?.length)
            continue;
        source.grantedOnCardPlayed = source.grantedOnCardPlayed.filter((granted) => {
            if (granted.effect.op !== "playCostReduction")
                return true;
            if (granted.filter && !(0, conditions_1.cardMatchesFilter)(cardNo, granted.filter))
                return true;
            return false;
        });
    }
}
function getEffectivePlayCost(card, cardNo, state, player, fromZone) {
    const playNo = getBaseCardNoForInstance(cardNo, card.linkedEvoInstanceId);
    let base = resolveCardDefCost(playNo);
    if (state && player != null) {
        base = Math.max(0, base - getPassivePlayCostReduction(state, player, playNo));
        base = Math.max(0, base - getGrantedPlayCostReduction(state, player, playNo));
        if (fromZone === "exArea") {
            base = Math.max(0, base - getExAreaPlayCostReduction(state, player, cardNo));
        }
    }
    const instanceReduction = (card.playCostReduction ?? 0) + (card.persistentPlayCostReduction ?? 0);
    return Math.max(0, base - instanceReduction);
}
function getEffectiveStats(card, state) {
    const statsNo = state ? resolveCardNo(state, card) : getBaseCardNoForInstance(card.name);
    const cardDef = (0, registry_1.getCardDef)(statsNo);
    // Amulets (and non-followers) have no attack/defense; never treat missing stats as 0 HP.
    if (cardDef?.cardType && cardDef.cardType !== "follower") {
        return { atk: 0, def: 0, cost: cardDef.cost ?? 0, hasCombatStats: false };
    }
    let atk = cardDef?.attack ?? 0;
    let def = cardDef?.defense ?? 0;
    for (const m of card.modifiers) {
        atk += m.atk ?? 0;
        def += m.def ?? 0;
    }
    return { atk, def, cost: cardDef?.cost ?? 0, hasCombatStats: true };
}
function isFollowerCard(card, state) {
    const statsNo = state ? resolveCardNo(state, card) : getBaseCardNoForInstance(card.name);
    return (0, registry_1.getCardDef)(statsNo)?.cardType === "follower";
}
/** PP cost to evolve (separate from a card's play cost). */
function getEvolveCost(evoCardNo, baseCardNo) {
    const base = baseCardNo ? (0, registry_1.getCardDef)(getBaseCardNoForInstance(baseCardNo)) : null;
    if (base?.evolveCost != null)
        return base.evolveCost;
    const parsed = base?.cardText ? parseEvolveCostFromText(base.cardText) : null;
    if (parsed != null)
        return parsed;
    return 2;
}
/**
 * Evolve costs currently available for a field follower.
 * Alternate evolve abilities are independent — any met option unlocks evolving.
 */
function getAvailableEvolveCosts(state, player, fieldCard) {
    if (fieldCard.evolveCostOverride != null)
        return [fieldCard.evolveCostOverride];
    const baseNo = getBaseCardNoForInstance(fieldCard.name, fieldCard.linkedEvoInstanceId);
    const def = (0, registry_1.getCardDef)(baseNo);
    const evolveRules = (def?.abilities ?? []).filter((a) => a.timing === "evolve");
    if (evolveRules.length === 0) {
        return [getEvolveCost("", baseNo)];
    }
    const costs = [];
    for (const rule of evolveRules) {
        if (rule.condition && !(0, conditions_1.evalCondition)(state, player, rule.condition))
            continue;
        costs.push(rule.cost?.pp ?? 0);
    }
    return costs;
}
/** Cheapest currently available evolve PP cost, or null if none are legal. */
function getEffectiveEvolveCost(state, player, fieldCard) {
    const costs = getAvailableEvolveCosts(state, player, fieldCard);
    if (costs.length === 0)
        return null;
    return Math.min(...costs);
}
function hasKeyword(card, keyword, state, player) {
    if (state && (0, passives_1.isBoxed)(card, state))
        return false;
    if (card.grantedKeywords?.includes(keyword))
        return true;
    const def = (0, registry_1.getCardDef)(resolveCardNo(state, card));
    if (def?.keywords.includes(keyword)) {
        // Aura and intimidate apply only while the follower is reserved (not engaged).
        if (keyword === "aura" || keyword === "intimidate") {
            return !card.engaged;
        }
        return true;
    }
    if (state) {
        const pid = player ?? card.controller;
        if ((0, passives_1.getPassiveKeywords)(state, card, pid).includes(keyword))
            return true;
        if ((0, passives_1.getAuraKeywords)(state, card, pid).includes(keyword))
            return true;
    }
    // Evolved followers gain Rush for the turn they are evolved.
    if (keyword === "rush" && card.evolvedThisTurn)
        return true;
    // Equipment passives may grant keywords to the host.
    if (state && card.equippedInstanceIds?.length) {
        for (const eqId of card.equippedInstanceIds) {
            const eq = findInstance(state, eqId);
            if (!eq)
                continue;
            const eqDef = (0, registry_1.getCardDef)(resolveCardNo(state, eq.card));
            for (const ability of eqDef?.abilities ?? []) {
                if (ability.timing !== "passive")
                    continue;
                const eff = ability.effect;
                if (eff.op === "passiveKeywords" && eff.keywords.includes(keyword))
                    return true;
                if (eff.op === "equipPassive" && eff.keywords?.includes(keyword))
                    return true;
            }
        }
    }
    return false;
}
function clampDamageToFollower(state, card, player, amount) {
    let dmg = amount;
    const reduction = (card.damageTakenReduction ?? 0) +
        card.modifiers.reduce((sum, m) => sum + (m.damageTakenReduction ?? 0), 0);
    if (reduction > 0)
        dmg = Math.max(0, dmg - reduction);
    const cap = state ? (0, passives_1.getMaxDamagePerHit)(state, card, player) : null;
    if (cap != null && dmg > cap)
        return cap;
    return dmg;
}
function canEvolveFollower(state, player, fieldInstanceId) {
    const fieldFound = findInstance(state, fieldInstanceId);
    if (!fieldFound || fieldFound.zone !== "field" || fieldFound.player !== player)
        return false;
    if (getPlayer(state, player).flags.evolvedThisTurn)
        return false;
    if (fieldFound.card.linkedEvoInstanceId)
        return false;
    if ((0, passives_1.isBoxed)(fieldFound.card, state))
        return false;
    if (!findMatchingEvolveCard(state, player, fieldInstanceId))
        return false;
    return getEffectiveEvolveCost(state, player, fieldFound.card) != null;
}
function getActivatedAbilities(state, card, player, zone) {
    if (zone === "field" && (0, passives_1.isBoxed)(card, state))
        return [];
    const def = (0, registry_1.getCardDef)(resolveCardNo(state, card));
    const results = [];
    for (const [idx, a] of (def?.abilities ?? []).entries()) {
        if (a.timing !== "activated")
            continue;
        const from = a.activateFrom ?? "field";
        if (from !== zone)
            continue;
        const key = `activated:${idx}`;
        if (a.oncePerTurn && card.abilitiesActivatedThisTurn.includes(key))
            continue;
        if (a.maxPerTurn != null && (card.counters[key] ?? 0) >= a.maxPerTurn)
            continue;
        if (a.condition && !(0, conditions_1.evalCondition)(state, player, a.condition))
            continue;
        if ((0, effect_utils_1.isAdvanceAbility)(def, a) && getPlayer(state, player).flags.evolvedThisTurn)
            continue;
        if ((0, effect_utils_1.isAdvanceAbility)(def, a) && !(0, effect_utils_1.canAdvanceActivate)(state, player, a.effect))
            continue;
        const ppCost = a.cost?.pp ?? 0;
        const p = getPlayer(state, player);
        const canPayPp = computeEvolvePayment(ppCost, p.pp, p.evoPoints, false).ok;
        const canPayEp = computeEvolvePayment(ppCost, p.pp, p.evoPoints, true).ok;
        if (!canPayPp && !canPayEp)
            continue;
        if (a.cost?.banishFromCemetery) {
            const need = a.cost.banishCount ?? 1;
            const have = getPlayer(state, player).zones.cemetery.filter((c) => (0, conditions_1.cardMatchesFilter)(c.name, a.cost.banishFromCemetery)).length;
            if (have < need)
                continue;
        }
        if (a.cost?.banishFromExArea) {
            const need = a.cost.banishCount ?? 1;
            const have = getPlayer(state, player).zones.exArea.filter((c) => (0, conditions_1.cardMatchesFilter)(c.name, a.cost.banishFromExArea)).length;
            if (have < need)
                continue;
        }
        if (a.cost?.buryFromField) {
            const need = a.cost.buryFieldCount ?? 1;
            const have = getPlayer(state, player).zones.field.filter((c) => {
                if (a.cost?.excludeSelfFromBury && c.instanceId === card.instanceId)
                    return false;
                return (0, conditions_1.cardMatchesFilter)(c.name, a.cost.buryFromField);
            }).length;
            if (have < need)
                continue;
        }
        if (a.cost?.engageFromField) {
            const need = a.cost.engageFieldCount ?? 1;
            const have = getPlayer(state, player).zones.field.filter((c) => {
                if (c.engaged)
                    return false;
                if (a.cost?.excludeSelfFromEngage && c.instanceId === card.instanceId)
                    return false;
                return (0, conditions_1.cardMatchesFilter)(c.name, a.cost.engageFromField);
            }).length;
            if (have < need)
                continue;
        }
        if (a.cost?.fuse) {
            const need = a.cost.fuse.count ?? 1;
            const filter = a.cost.fuse.filter;
            const excludeSelf = a.cost.fuse.excludeSelf !== false;
            const zones = getPlayer(state, player).zones;
            let have = 0;
            for (const c of [...zones.hand, ...zones.exArea]) {
                if (excludeSelf && c.instanceId === card.instanceId)
                    continue;
                if ((0, conditions_1.cardMatchesFilter)(c.name, filter))
                    have += 1;
            }
            if (have < need)
                continue;
        }
        if (a.cost?.removePersistentCounter) {
            const need = a.cost.removePersistentCounter.amount ?? 1;
            const have = card.persistentCounters?.[a.cost.removePersistentCounter.key] ?? 0;
            if (have < need)
                continue;
        }
        if (a.cost?.burySelf && zone !== "field")
            continue;
        if (a.cost?.discardSelf && zone !== "hand")
            continue;
        if (zone === "field" && a.cost?.engage && card.engaged)
            continue;
        if (!canActivateEffectResolve(state, player, a.effect, card.instanceId))
            continue;
        results.push({ ability: a, key });
    }
    // Equipment-granted activates usable through the host follower.
    if (zone === "field" && card.equippedInstanceIds?.length) {
        for (const eqId of card.equippedInstanceIds) {
            const eqFound = findInstance(state, eqId);
            if (!eqFound)
                continue;
            const eqDef = (0, registry_1.getCardDef)(resolveCardNo(state, eqFound.card));
            for (const [idx, a] of (eqDef?.abilities ?? []).entries()) {
                if (a.timing !== "activated" || !a.equipHostActivate)
                    continue;
                const key = `equipActivated:${eqId}:${idx}`;
                if (a.oncePerTurn && card.abilitiesActivatedThisTurn.includes(key))
                    continue;
                if (a.maxPerTurn != null && (card.counters[key] ?? 0) >= a.maxPerTurn)
                    continue;
                if (a.condition && !(0, conditions_1.evalCondition)(state, player, a.condition))
                    continue;
                const ppCost = a.cost?.pp ?? 0;
                const p = getPlayer(state, player);
                const canPayPp = computeEvolvePayment(ppCost, p.pp, p.evoPoints, false).ok;
                const canPayEp = computeEvolvePayment(ppCost, p.pp, p.evoPoints, true).ok;
                if (!canPayPp && !canPayEp)
                    continue;
                if (a.cost?.engage && card.engaged)
                    continue;
                if (!canActivateEffectResolve(state, player, a.effect, card.instanceId))
                    continue;
                results.push({ ability: a, key });
            }
        }
    }
    return results;
}
function evolveCardsMatch(fieldCardNo, evoCardNo) {
    const baseDef = (0, registry_1.getCardDef)(fieldCardNo);
    const evoDef = (0, registry_1.getCardDef)(evoCardNo);
    if (baseDef?.evolvesTo === evoCardNo)
        return true;
    if (evoDef?.evolvesFrom === fieldCardNo)
        return true;
    if (baseDef?.evolvesTo && (0, registry_1.getGameplayCardNo)(evoCardNo) === (0, registry_1.getGameplayCardNo)(baseDef.evolvesTo)) {
        return true;
    }
    if (evoDef?.evolvesFrom && (0, registry_1.getGameplayCardNo)(fieldCardNo) === (0, registry_1.getGameplayCardNo)(evoDef.evolvesFrom)) {
        return true;
    }
    return false;
}
function findMatchingEvolveCard(state, player, fieldInstanceId) {
    const fieldFound = findInstance(state, fieldInstanceId);
    if (!fieldFound || fieldFound.zone !== "field")
        return null;
    if (fieldFound.card.linkedEvoInstanceId)
        return null;
    return (state.players[player].zones.evolveDeck.find((evo) => !evo.evolveUsed && evolveCardsMatch(fieldFound.card.name, evo.name)) ?? null);
}
function getStrikeAbilities(state, card) {
    if ((0, passives_1.isBoxed)(card, state))
        return [];
    const results = [];
    const def = (0, registry_1.getCardDef)(resolveCardNo(state, card));
    for (const [idx, a] of (def?.abilities ?? []).entries()) {
        if (a.timing !== "strike")
            continue;
        const key = `strike:${idx}`;
        if (a.oncePerTurn && card.abilitiesActivatedThisTurn.includes(key))
            continue;
        results.push({ ability: a, key });
    }
    // Equipment that grants Strike to the host (e.g. Holy Castle Sword, Avalon).
    if (card.equippedInstanceIds?.length) {
        for (const eqId of card.equippedInstanceIds) {
            const eqFound = findInstance(state, eqId);
            if (!eqFound)
                continue;
            const eqDef = (0, registry_1.getCardDef)(resolveCardNo(state, eqFound.card));
            for (const [idx, a] of (eqDef?.abilities ?? []).entries()) {
                if (a.timing !== "strike")
                    continue;
                const key = `equipStrike:${eqId}:${idx}`;
                if (a.oncePerTurn && card.abilitiesActivatedThisTurn.includes(key))
                    continue;
                results.push({ ability: a, key });
            }
        }
    }
    return results;
}
function opponentOf(player) {
    return player === 0 ? 1 : 0;
}
function isOverflowActive(state, player) {
    return state.players[player].maxPp >= 7;
}
function canAttackLeader(state, attacker, player) {
    if (attacker.onFieldSinceTurnStart)
        return true;
    if (hasKeyword(attacker, "storm", state))
        return true;
    return false;
}
function getWardTargets(state, defender) {
    return state.players[defender].zones.field.filter((c) => isFollowerCard(c, state) && hasKeyword(c, "ward", state) && c.engaged);
}
function getLegalAttackTargets(state, attacker, player) {
    if (attacker.cannotAttack || attacker.modifiers.some((m) => m.cannotAttack)) {
        return [];
    }
    const enemy = opponentOf(player);
    const targets = [];
    const wards = getWardTargets(state, enemy);
    if (wards.length > 0) {
        for (const w of wards) {
            if (!hasKeyword(w, "intimidate", state)) {
                targets.push({ type: "follower", instanceId: w.instanceId });
            }
        }
        return targets;
    }
    for (const f of state.players[enemy].zones.field) {
        const fDef = (0, registry_1.getCardDef)(resolveCardNo(state, f));
        if (fDef?.cardType !== "follower")
            continue;
        if (hasKeyword(f, "intimidate", state))
            continue;
        // Reserved (not engaged) followers require Assail to be attacked.
        if (!f.engaged && !hasKeyword(attacker, "assail", state))
            continue;
        targets.push({ type: "follower", instanceId: f.instanceId });
    }
    if (canAttackLeader(state, attacker, player)) {
        targets.push({ type: "leader", player: enemy });
    }
    return targets;
}
