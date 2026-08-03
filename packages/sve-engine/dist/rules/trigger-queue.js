"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueOnCardPlayed = queueOnCardPlayed;
exports.queueOnCardFused = queueOnCardFused;
exports.queueOnDiscard = queueOnDiscard;
exports.queueLastWords = queueLastWords;
exports.queueFanfare = queueFanfare;
exports.queueStartOfEndAbilities = queueStartOfEndAbilities;
exports.queueStartOfMainAbilities = queueStartOfMainAbilities;
exports.queueOnOpponentDeckToCemetery = queueOnOpponentDeckToCemetery;
exports.queueAllyFollowerEnterTriggers = queueAllyFollowerEnterTriggers;
exports.queueCemeteryOnAllyFollowerEnter = queueCemeteryOnAllyFollowerEnter;
exports.queueOnAbilityDamageTaken = queueOnAbilityDamageTaken;
exports.queueOnAbilityDamageDealt = queueOnAbilityDamageDealt;
exports.onCardEntersExAreaTriggers = onCardEntersExAreaTriggers;
exports.queueOnUnionBurstActivated = queueOnUnionBurstActivated;
const registry_1 = require("../cards/registry");
const trigger_labels_1 = require("./trigger-labels");
const conditions_1 = require("../state/conditions");
const passives_1 = require("../state/passives");
const queries_1 = require("../state/queries");
const passives_2 = require("../state/passives");
function pushTrigger(state, instanceId, player, cardNo, ability, timing, idPrefix, abilityKey, forcedTargetId) {
    state.pendingTriggers.push({
        id: `${idPrefix}_${instanceId}_${state.pendingTriggers.length}`,
        controller: player,
        sourceInstanceId: instanceId,
        ability,
        timing,
        label: ability.label ?? (0, trigger_labels_1.describeAbility)(cardNo, ability),
        abilityKey,
        forcedTargetId,
    });
}
function canFireLimitedTrigger(fieldCard, key, opts) {
    if (opts.oncePerTurn && fieldCard.abilitiesActivatedThisTurn.includes(key))
        return false;
    if (opts.maxPerTurn != null && (fieldCard.counters[key] ?? 0) >= opts.maxPerTurn)
        return false;
    return true;
}
function queueOnCardPlayedForCard(state, playedNo, player, fieldCard, idPrefix, matchTimings = ["onCardPlayed", "onCardPlayedOrFused"], queuedTiming = "onCardPlayed", 
/** Instance that was just played — never lets that card watch its own play. */
playedInstanceId) {
    if ((0, passives_1.isBoxed)(fieldCard, state))
        return;
    // Defensive: a card's own on-play watchers are not active for its own play.
    if (playedInstanceId && fieldCard.instanceId === playedInstanceId)
        return;
    const cardNo = (0, queries_1.resolveCardNo)(state, fieldCard);
    const def = (0, registry_1.getCardDef)(cardNo);
    for (const [idx, ability] of (def?.abilities ?? []).entries()) {
        if (!matchTimings.includes(ability.timing))
            continue;
        if (ability.filter && !(0, conditions_1.cardMatchesFilter)(playedNo, ability.filter, state))
            continue;
        const key = `${queuedTiming}:${idx}`;
        if (!canFireLimitedTrigger(fieldCard, key, ability))
            continue;
        pushTrigger(state, fieldCard.instanceId, player, cardNo, ability, queuedTiming, idPrefix, key);
    }
    // Passive grantOnCardPlayed is the hand-authored form of a persistent on-play trigger.
    // Fuse does not consume/fire these grants — only actual plays do.
    if (queuedTiming === "onCardPlayed") {
        for (const [idx, ability] of (def?.abilities ?? []).entries()) {
            if (ability.timing !== "passive" || ability.effect.op !== "grantOnCardPlayed")
                continue;
            const granted = ability.effect;
            if (granted.filter && !(0, conditions_1.cardMatchesFilter)(playedNo, granted.filter))
                continue;
            const key = `onCardPlayed:${idx}`;
            if (!canFireLimitedTrigger(fieldCard, key, {
                oncePerTurn: granted.oncePerTurn,
                maxPerTurn: granted.maxPerTurn,
            })) {
                continue;
            }
            const pseudoAbility = {
                timing: "onCardPlayed",
                effect: granted.effect,
                label: granted.label,
                oncePerTurn: granted.oncePerTurn,
                maxPerTurn: granted.maxPerTurn,
            };
            pushTrigger(state, fieldCard.instanceId, player, cardNo, pseudoAbility, "onCardPlayed", idPrefix, key);
        }
        for (const [gIdx, granted] of (fieldCard.grantedOnCardPlayed ?? []).entries()) {
            // playCostReduction grants discount the play cost up front and are consumed on play.
            if (granted.effect.op === "playCostReduction")
                continue;
            if (granted.filter && !(0, conditions_1.cardMatchesFilter)(playedNo, granted.filter))
                continue;
            const key = `grantedOnCardPlayed:${gIdx}`;
            if (!canFireLimitedTrigger(fieldCard, key, granted))
                continue;
            const pseudoAbility = {
                timing: "onCardPlayed",
                effect: granted.effect,
                label: granted.label,
                oncePerTurn: granted.oncePerTurn,
                maxPerTurn: granted.maxPerTurn,
            };
            pushTrigger(state, fieldCard.instanceId, player, cardNo, pseudoAbility, "onCardPlayed", `g${idPrefix}`, key);
        }
    }
}
function queueOnCardPlayed(state, playedInstanceId, player) {
    const played = (0, queries_1.findInstance)(state, playedInstanceId);
    if (!played)
        return;
    const playedNo = (0, queries_1.resolveCardNo)(state, played.card);
    const zones = (0, queries_1.getPlayer)(state, player).zones;
    for (const fieldCard of zones.field) {
        queueOnCardPlayedForCard(state, playedNo, player, fieldCard, "ocp", undefined, undefined, playedInstanceId);
    }
    // Crests live in EX and can watch plays; amulets/spells waiting in EX do not.
    for (const exCard of zones.exArea) {
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, exCard));
        if (def?.cardType !== "crest")
            continue;
        queueOnCardPlayedForCard(state, playedNo, player, exCard, "ocpx", undefined, undefined, playedInstanceId);
    }
}
/** Queue watchers for a card that was fused into the EX area. */
function queueOnCardFused(state, fusedInstanceId, player) {
    const fused = (0, queries_1.findInstance)(state, fusedInstanceId);
    if (!fused)
        return;
    const fusedNo = (0, queries_1.resolveCardNo)(state, fused.card);
    const zones = (0, queries_1.getPlayer)(state, player).zones;
    for (const fieldCard of zones.field) {
        queueOnCardPlayedForCard(state, fusedNo, player, fieldCard, "ocf", ["onCardFused", "onCardPlayedOrFused"], "onCardFused", fusedInstanceId);
    }
    for (const exCard of zones.exArea) {
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, exCard));
        if (def?.cardType !== "crest")
            continue;
        queueOnCardPlayedForCard(state, fusedNo, player, exCard, "ocfx", ["onCardFused", "onCardPlayedOrFused"], "onCardFused", fusedInstanceId);
    }
}
/** Queue "When this card is discarded" abilities for a card now in the cemetery. */
function queueOnDiscard(state, instanceId, player) {
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found || found.zone !== "cemetery")
        return;
    const cardNo = found.card.name;
    const def = (0, registry_1.getCardDef)(cardNo);
    for (const ability of def?.abilities ?? []) {
        if (ability.timing !== "onDiscard")
            continue;
        pushTrigger(state, instanceId, player, cardNo, ability, "onDiscard", "od");
    }
}
function queueLastWords(state, instanceId, player) {
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found)
        return;
    if ((0, passives_1.isBoxed)(found.card, state))
        return;
    const cardNo = found.card.name;
    const def = (0, registry_1.getCardDef)(cardNo);
    for (const ability of def?.abilities ?? []) {
        if (ability.timing === "lastWords") {
            pushTrigger(state, instanceId, player, cardNo, ability, "lastWords", "lw");
        }
    }
    for (const effect of found.card.grantedLastWords ?? []) {
        pushTrigger(state, instanceId, player, cardNo, {
            timing: "lastWords",
            effect,
            label: `${(0, registry_1.getCardDef)(cardNo)?.name ?? cardNo} — Last Words: banish this card`,
        }, "lastWords", "glw");
    }
}
function queueFanfare(state, instanceId, player) {
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found || (0, passives_1.isBoxed)(found.card, state))
        return;
    const def = (0, registry_1.getCardDef)(found.card.name);
    for (const ability of def?.abilities ?? []) {
        if (ability.timing === "fanfare") {
            pushTrigger(state, instanceId, player, found.card.name, ability, "fanfare", "ff");
        }
    }
}
function queueStartOfEndAbilities(state, player) {
    for (const card of [...(0, queries_1.getPlayer)(state, player).zones.field]) {
        if ((0, passives_1.isBoxed)(card, state))
            continue;
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, card));
        for (const ability of def?.abilities ?? []) {
            if (ability.timing !== "startOfEnd")
                continue;
            pushTrigger(state, card.instanceId, player, card.name, ability, "startOfEnd", "soe");
        }
        for (const [idx, granted] of (card.grantedStartOfEnd ?? []).entries()) {
            const ability = {
                timing: "startOfEnd",
                effect: granted.effect,
                label: granted.label,
            };
            pushTrigger(state, card.instanceId, player, card.name, ability, "startOfEnd", `gsoe${idx}`);
        }
    }
    // Granted start-of-end on EX cards (e.g. Kyoka: bury if still in EX).
    for (const card of [...(0, queries_1.getPlayer)(state, player).zones.exArea]) {
        if ((0, passives_1.isBoxed)(card, state))
            continue;
        for (const [idx, granted] of (card.grantedStartOfEnd ?? []).entries()) {
            const ability = {
                timing: "startOfEnd",
                effect: granted.effect,
                label: granted.label,
            };
            pushTrigger(state, card.instanceId, player, card.name, ability, "startOfEnd", `gsoe${idx}`);
        }
    }
}
function queueStartOfMainAbilities(state, player) {
    const zones = (0, queries_1.getPlayer)(state, player).zones;
    for (const card of zones.field) {
        if ((0, passives_1.isBoxed)(card, state))
            continue;
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, card));
        for (const ability of def?.abilities ?? []) {
            if (ability.timing !== "startOfMain")
                continue;
            pushTrigger(state, card.instanceId, player, card.name, ability, "startOfMain", "som");
        }
    }
    // Only Crests trigger from EX. Amulets like Destruction in Black/White sit in EX
    // until played onto the field and must not fire start-of-main there.
    for (const card of zones.exArea) {
        if ((0, passives_1.isBoxed)(card, state))
            continue;
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, card));
        if (def?.cardType !== "crest")
            continue;
        for (const ability of def?.abilities ?? []) {
            if (ability.timing !== "startOfMain")
                continue;
            pushTrigger(state, card.instanceId, player, card.name, ability, "startOfMain", "som");
        }
    }
}
/** During the active player's turn, when a card leaves an opponent's deck into cemetery. */
function queueOnOpponentDeckToCemetery(state) {
    const player = state.activePlayer;
    for (const fieldCard of (0, queries_1.getPlayer)(state, player).zones.field) {
        if ((0, passives_1.isBoxed)(fieldCard, state))
            continue;
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, fieldCard));
        for (const [idx, ability] of (def?.abilities ?? []).entries()) {
            if (ability.timing !== "onOpponentDeckToCemetery")
                continue;
            const key = `onOpponentDeckToCemetery:${idx}`;
            if (!canFireLimitedTrigger(fieldCard, key, ability))
                continue;
            pushTrigger(state, fieldCard.instanceId, player, fieldCard.name, ability, "onOpponentDeckToCemetery", "odc", key);
        }
    }
}
function queueAllyFollowerEnterTriggers(state, enteredInstanceId, player) {
    const entered = (0, queries_1.findInstance)(state, enteredInstanceId);
    if (!entered || entered.zone !== "field")
        return;
    const enteredNo = (0, queries_1.resolveCardNo)(state, entered.card);
    for (const fieldCard of (0, queries_1.getPlayer)(state, player).zones.field) {
        if (fieldCard.instanceId === enteredInstanceId || (0, passives_1.isBoxed)(fieldCard, state))
            continue;
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, fieldCard));
        for (const [idx, ability] of (def?.abilities ?? []).entries()) {
            if (ability.timing !== "onAllyFollowerEnter")
                continue;
            if (ability.activateFrom === "cemetery")
                continue;
            if (ability.filter && !(0, conditions_1.cardMatchesFilter)(enteredNo, ability.filter))
                continue;
            const key = `afe:${idx}`;
            if (!canFireLimitedTrigger(fieldCard, key, ability))
                continue;
            pushTrigger(state, fieldCard.instanceId, player, fieldCard.name, ability, "onAllyFollowerEnter", "afe", key, enteredInstanceId);
        }
    }
}
/** Cemetery cards that react when an ally follower enters (e.g. Delta Cannon + Tetra). */
function queueCemeteryOnAllyFollowerEnter(state, enteredInstanceId, player) {
    const entered = (0, queries_1.findInstance)(state, enteredInstanceId);
    if (!entered || entered.zone !== "field")
        return;
    const enteredNo = (0, queries_1.resolveCardNo)(state, entered.card);
    const enteredDef = (0, registry_1.getCardDef)(enteredNo);
    if (enteredDef?.cardType !== "follower")
        return;
    for (const cemCard of (0, queries_1.getPlayer)(state, player).zones.cemetery) {
        const cardNo = (0, queries_1.resolveCardNo)(state, cemCard);
        const def = (0, registry_1.getCardDef)(cardNo);
        for (const [idx, ability] of (def?.abilities ?? []).entries()) {
            if (ability.timing !== "onAllyFollowerEnter")
                continue;
            if (ability.activateFrom !== "cemetery")
                continue;
            if (ability.filter && !(0, conditions_1.cardMatchesFilter)(enteredNo, ability.filter))
                continue;
            pushTrigger(state, cemCard.instanceId, player, cardNo, ability, "onAllyFollowerEnter", "cafe", `cafe:${idx}`, enteredInstanceId);
        }
    }
}
/** Queue onAbilityDamageTaken after a follower takes ability damage (even if it dies to it). */
function queueOnAbilityDamageTaken(state, instanceId) {
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found || found.zone !== "field")
        return;
    // Most Disdain texts are "During your turn, whenever this takes ability damage…"
    if (state.activePlayer !== found.player)
        return;
    if ((0, passives_1.isBoxed)(found.card, state))
        return;
    const cardNo = (0, queries_1.resolveCardNo)(state, found.card);
    const def = (0, registry_1.getCardDef)(cardNo);
    for (const [idx, ability] of (def?.abilities ?? []).entries()) {
        if (ability.timing !== "onAbilityDamageTaken")
            continue;
        const key = `onAbilityDamageTaken:${idx}`;
        if (!canFireLimitedTrigger(found.card, key, ability))
            continue;
        pushTrigger(state, found.card.instanceId, found.player, cardNo, ability, "onAbilityDamageTaken", "adt", key);
    }
}
/**
 * Queue onAbilityDamageDealt after a follower deals ability damage to an enemy follower.
 * Equipment attached to the dealer can also carry this timing (e.g. Dark Axe Nachtfang).
 */
function queueOnAbilityDamageDealt(state, sourceInstanceId, damagedInstanceId) {
    const damaged = (0, queries_1.findInstance)(state, damagedInstanceId);
    if (!damaged || damaged.zone !== "field")
        return;
    if (!(0, queries_1.isFollowerCard)(damaged.card, state))
        return;
    const source = (0, queries_1.findInstance)(state, sourceInstanceId);
    if (!source)
        return;
    let dealer = source;
    if (source.card.equippedToInstanceId) {
        const host = (0, queries_1.findInstance)(state, source.card.equippedToInstanceId);
        if (!host || host.zone !== "field")
            return;
        dealer = host;
    }
    if (dealer.zone !== "field" || !(0, queries_1.isFollowerCard)(dealer.card, state))
        return;
    if (damaged.player === dealer.player)
        return;
    if ((0, passives_1.isBoxed)(dealer.card, state))
        return;
    const queueFrom = (card, idPrefix) => {
        const cardNo = (0, queries_1.resolveCardNo)(state, card);
        const def = (0, registry_1.getCardDef)(cardNo);
        for (const [idx, ability] of (def?.abilities ?? []).entries()) {
            if (ability.timing !== "onAbilityDamageDealt")
                continue;
            const key = `onAbilityDamageDealt:${idx}`;
            if (!canFireLimitedTrigger(card, key, ability))
                continue;
            pushTrigger(state, card.instanceId, dealer.player, cardNo, ability, "onAbilityDamageDealt", idPrefix, key, damagedInstanceId);
        }
    };
    queueFrom(dealer.card, "add");
    for (const eqId of dealer.card.equippedInstanceIds ?? []) {
        const eq = (0, queries_1.findInstance)(state, eqId);
        if (!eq)
            continue;
        queueFrom(eq.card, "adde");
    }
}
function onCardEntersExAreaTriggers(state, instanceId, player) {
    const entered = (0, queries_1.findInstance)(state, instanceId);
    if (!entered || entered.zone !== "exArea")
        return;
    const enteredNo = (0, queries_1.resolveCardNo)(state, entered.card);
    for (const fieldCard of (0, queries_1.getPlayer)(state, player).zones.field) {
        if ((0, passives_1.isBoxed)(fieldCard, state))
            continue;
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, fieldCard));
        for (const ability of def?.abilities ?? []) {
            if (!(0, passives_2.matchesExAreaEntryFilter)(ability, enteredNo))
                continue;
            pushTrigger(state, fieldCard.instanceId, player, fieldCard.name, ability, "onExAreaEntry", `ex_${instanceId}`);
        }
    }
}
/** Queue onUnionBurstActivated abilities on other ally field followers. */
function queueOnUnionBurstActivated(state, activatorInstanceId, player) {
    for (const fieldCard of (0, queries_1.getPlayer)(state, player).zones.field) {
        if (fieldCard.instanceId === activatorInstanceId)
            continue;
        if ((0, passives_1.isBoxed)(fieldCard, state))
            continue;
        const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, fieldCard));
        for (const [idx, ability] of (def?.abilities ?? []).entries()) {
            if (ability.timing !== "onUnionBurstActivated")
                continue;
            const key = `onUnionBurstActivated:${idx}`;
            if (!canFireLimitedTrigger(fieldCard, key, ability))
                continue;
            if (ability.condition && !(0, conditions_1.evalCondition)(state, player, ability.condition))
                continue;
            pushTrigger(state, fieldCard.instanceId, player, fieldCard.name, ability, "onUnionBurstActivated", "ub", key, activatorInstanceId);
        }
    }
}
