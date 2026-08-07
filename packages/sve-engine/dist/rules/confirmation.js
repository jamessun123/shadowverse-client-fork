"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueFanfare = exports.queueLastWords = void 0;
exports.onFollowerEntersField = onFollowerEntersField;
exports.onCardEntersExArea = onCardEntersExArea;
exports.resolveOneTrigger = resolveOneTrigger;
exports.runConfirmationTiming = runConfirmationTiming;
const tokens_1 = require("../cards/tokens");
const card_reset_1 = require("../state/card-reset");
const resolver_1 = require("../effects/resolver");
const effect_utils_1 = require("./effect-utils");
const trigger_queue_1 = require("./trigger-queue");
const union_burst_1 = require("./union-burst");
const queries_1 = require("../state/queries");
const zones_1 = require("../state/zones");
function checkLosses(state) {
    let next = structuredClone(state);
    for (const pid of [0, 1]) {
        if (next.players[pid].leaderDef <= 0) {
            next.winner = pid === 0 ? 1 : 0;
            next.phase = "gameOver";
            return next;
        }
        while (next.players[pid].flags.owedDraws > 0) {
            if (next.players[pid].zones.deck.length === 0) {
                next.winner = pid === 0 ? 1 : 0;
                next.phase = "gameOver";
                return next;
            }
            next = (0, zones_1.drawCard)(next, pid);
            next.players[pid].flags.owedDraws -= 1;
        }
    }
    return next;
}
function destroyAtZeroDef(state) {
    let next = state;
    let changed = true;
    while (changed) {
        changed = false;
        for (const pid of [0, 1]) {
            for (const card of [...(0, queries_1.getPlayer)(next, pid).zones.field]) {
                const stats = (0, queries_1.getEffectiveStats)(card, next);
                // Amulets and other non-followers have no defense and must not be
                // destroyed by the zero-def rule that applies to followers.
                if (!stats.hasCombatStats)
                    continue;
                if (stats.def <= 0) {
                    (0, trigger_queue_1.queueLastWords)(next, card.instanceId, pid);
                    next = (0, zones_1.destroyFollower)(next, card.instanceId);
                    changed = true;
                }
            }
        }
    }
    return next;
}
function resolveBane(state) {
    let next = structuredClone(state);
    const toDestroy = new Set();
    for (const pid of [0, 1]) {
        for (const card of next.players[pid].zones.field) {
            if (!card.foughtWithBane || !card.foughtWithInstanceId)
                continue;
            const opponent = (0, queries_1.findInstance)(next, card.foughtWithInstanceId);
            if (!opponent || opponent.zone !== "field")
                continue;
            const cardHasBane = (0, queries_1.hasKeyword)(card, "bane", next, pid);
            const oppHasBane = (0, queries_1.hasKeyword)(opponent.card, "bane", next, opponent.player);
            if (cardHasBane && !oppHasBane) {
                toDestroy.add(card.foughtWithInstanceId);
            }
            else if (oppHasBane && !cardHasBane) {
                toDestroy.add(card.instanceId);
            }
            else if (cardHasBane && oppHasBane) {
                toDestroy.add(card.instanceId);
                toDestroy.add(card.foughtWithInstanceId);
            }
        }
    }
    for (const instanceId of toDestroy) {
        const found = (0, queries_1.findInstance)(next, instanceId);
        if (!found || found.zone !== "field")
            continue;
        (0, trigger_queue_1.queueLastWords)(next, instanceId, found.player);
        next = (0, zones_1.destroyFollower)(next, instanceId);
    }
    return next;
}
function enforceFieldLimits(state) {
    let next = structuredClone(state);
    for (const pid of [0, 1]) {
        const p = next.players[pid];
        while ((0, queries_1.fieldOccupancy)(p.zones.field) > p.fieldLimit) {
            let idx = p.zones.field.length - 1;
            while (idx >= 0 && (0, queries_1.isEquippedAttachment)(p.zones.field[idx]))
                idx -= 1;
            if (idx < 0)
                break;
            const [excess] = p.zones.field.splice(idx, 1);
            (0, card_reset_1.resetCardInstanceState)(excess);
            (0, tokens_1.placeLeavingPlay)(p.zones, excess, "cemetery");
        }
        while (p.zones.exArea.length > p.exLimit) {
            const excess = p.zones.exArea.pop();
            (0, card_reset_1.resetCardInstanceState)(excess);
            (0, tokens_1.placeLeavingPlay)(p.zones, excess, "cemetery");
        }
    }
    return next;
}
function capPlayPoints(state) {
    const next = structuredClone(state);
    for (const pid of [0, 1]) {
        const p = next.players[pid];
        if (p.pp > p.maxPp)
            p.pp = p.maxPp;
    }
    return next;
}
var trigger_queue_2 = require("./trigger-queue");
Object.defineProperty(exports, "queueLastWords", { enumerable: true, get: function () { return trigger_queue_2.queueLastWords; } });
Object.defineProperty(exports, "queueFanfare", { enumerable: true, get: function () { return trigger_queue_2.queueFanfare; } });
/** Fanfare and field-entry setup when a follower/amulet enters the field. */
function onFollowerEntersField(state, instanceId, player) {
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found || found.zone !== "field")
        return;
    if (found.card.enteredFromHand === undefined) {
        found.card.enteredFromHand = false;
    }
    found.card.enteredFieldTurn = state.turnNumber;
    found.card.onFieldSinceTurnStart = false;
    (0, trigger_queue_1.queueFanfare)(state, instanceId, player);
    (0, trigger_queue_1.queueAllyFollowerEnterTriggers)(state, instanceId, player);
    (0, trigger_queue_1.queueCemeteryOnAllyFollowerEnter)(state, instanceId, player);
}
function onCardEntersExArea(state, instanceId, player) {
    (0, trigger_queue_1.onCardEntersExAreaTriggers)(state, instanceId, player);
}
function markTriggerAbilityUsed(state, trigger) {
    if (!trigger.abilityKey)
        return;
    const markableTimings = [
        "onCardPlayed",
        "onCardPlayedOrFused",
        "onCardFused",
        "onAllyFollowerEnter",
        "onOpponentDeckToCemetery",
        "onAbilityDamageTaken",
        "onAbilityDamageDealt",
        "onUnionBurstActivated",
    ];
    if (!markableTimings.includes(trigger.timing))
        return;
    const found = (0, queries_1.findInstance)(state, trigger.sourceInstanceId);
    if (!found)
        return;
    const { ability, abilityKey } = trigger;
    if (ability.oncePerTurn && !found.card.abilitiesActivatedThisTurn.includes(abilityKey)) {
        found.card.abilitiesActivatedThisTurn.push(abilityKey);
    }
    if (ability.maxPerTurn != null) {
        found.card.counters[abilityKey] = (found.card.counters[abilityKey] ?? 0) + 1;
    }
}
/** True when a pending trigger's effect can currently resolve (with source context). */
function isTriggerResolvable(state, trigger) {
    const probe = structuredClone(state);
    const enteredId = trigger.ability.useEnteredTarget ? trigger.forcedTargetId : undefined;
    probe.resolutionContext = {
        ...(0, effect_utils_1.contextForTriggerResolution)(probe, trigger.sourceInstanceId, trigger.ability.effect),
        forcedTargetId: enteredId,
        lastSelectedTargetId: enteredId,
    };
    return (0, resolver_1.canEffectResolve)(probe, trigger.controller, trigger.ability.effect);
}
/** Drop triggers that would no-op (e.g. Fanfare 2PP with insufficient PP). */
function pruneUnresolvableTriggers(state) {
    const next = structuredClone(state);
    next.pendingTriggers = next.pendingTriggers.filter((t) => isTriggerResolvable(next, t));
    return next;
}
function resolveOneTrigger(state, trigger) {
    let next = structuredClone(state);
    next.pendingTriggers = next.pendingTriggers.filter((t) => t.id !== trigger.id);
    // Set source before canEffectResolve — self-target effects (e.g. Apostle of Disdain
    // buff/Storm) need sourceInstanceId to see any candidates.
    const enteredId = trigger.ability.useEnteredTarget ? trigger.forcedTargetId : undefined;
    next.resolutionContext = {
        ...(0, effect_utils_1.contextForTriggerResolution)(next, trigger.sourceInstanceId, trigger.ability.effect),
        // Auto-target the entered/activator follower when the ability opts in.
        forcedTargetId: enteredId,
        lastSelectedTargetId: enteredId,
    };
    if (trigger.ability.unionBurst) {
        next = (0, union_burst_1.markResolvingUnionBurst)(next, trigger.sourceInstanceId);
    }
    // Comprehensive Rules 10.7.3.2: if it cannot be played, remove pending status only.
    if (!(0, resolver_1.canEffectResolve)(next, trigger.controller, trigger.ability.effect)) {
        if ((0, effect_utils_1.shouldClearResolutionContext)(next)) {
            next.resolutionContext = null;
        }
        return next;
    }
    next = (0, resolver_1.resolveEffect)(next, trigger.ability.effect, trigger.controller);
    markTriggerAbilityUsed(next, trigger);
    next = (0, union_burst_1.scheduleOrRecordUnionBurstActivated)(next, trigger.controller, trigger.sourceInstanceId, trigger.ability);
    if ((0, effect_utils_1.shouldClearResolutionContext)(next)) {
        next = (0, union_burst_1.flushPendingUnionBurst)(next);
        next.resolutionContext = null;
    }
    return next;
}
function runConfirmationTiming(state) {
    if (state.phase === "gameOver")
        return state;
    let next = structuredClone(state);
    let loop = true;
    /** Hard cap so last-words summon chains (e.g. White/Black Psalm) cannot softlock or auto-win. */
    let resolutions = 0;
    const maxResolutions = 64;
    while (loop) {
        loop = false;
        if (resolutions >= maxResolutions)
            return next;
        if (next.pendingChoices && next.pendingChoices.type !== "mulligan")
            return next;
        next = capPlayPoints(next);
        next = resolveBane(next);
        // Resolve "whenever this takes ability damage" before destroyAtZeroDef so dig/buff
        // effects (e.g. Galmieux, Ardent Disdain) still see the damaged follower on the field.
        if ((0, effect_utils_1.shouldDeferTriggers)(next))
            return next;
        const adtActive = next.pendingTriggers.filter((t) => t.timing === "onAbilityDamageTaken" && t.controller === next.activePlayer);
        const adtInactive = next.pendingTriggers.filter((t) => t.timing === "onAbilityDamageTaken" && t.controller !== next.activePlayer);
        if (adtActive.length > 1) {
            next.pendingChoices = {
                type: "selectTrigger",
                player: next.activePlayer,
                options: adtActive.map((t) => ({
                    triggerId: t.id,
                    label: t.label,
                })),
            };
            return next;
        }
        if (adtActive.length === 1) {
            next = resolveOneTrigger(next, adtActive[0]);
            resolutions += 1;
            loop = true;
            continue;
        }
        if (adtInactive.length > 1) {
            const opp = next.activePlayer === 0 ? 1 : 0;
            next.pendingChoices = {
                type: "selectTrigger",
                player: opp,
                options: adtInactive.map((t) => ({
                    triggerId: t.id,
                    label: t.label,
                })),
            };
            return next;
        }
        if (adtInactive.length === 1) {
            next = resolveOneTrigger(next, adtInactive[0]);
            resolutions += 1;
            loop = true;
            continue;
        }
        next = destroyAtZeroDef(next);
        next = enforceFieldLimits(next);
        next = checkLosses(next);
        if (next.phase === "gameOver")
            return next;
        if ((0, effect_utils_1.shouldDeferTriggers)(next))
            return next;
        // Remove fanfares/triggers that cannot resolve before offering order choice
        // (e.g. Karyl's "2PP: Equip" after spending all PP to play her).
        const beforePrune = next.pendingTriggers.length;
        next = pruneUnresolvableTriggers(next);
        if (next.pendingTriggers.length !== beforePrune) {
            loop = true;
            continue;
        }
        const activeTriggers = next.pendingTriggers.filter((t) => t.controller === next.activePlayer);
        const inactiveTriggers = next.pendingTriggers.filter((t) => t.controller !== next.activePlayer);
        if (activeTriggers.length > 1 && !next.pendingChoices) {
            next.pendingChoices = {
                type: "selectTrigger",
                player: next.activePlayer,
                options: activeTriggers.map((t) => ({
                    triggerId: t.id,
                    label: t.label,
                })),
            };
            return next;
        }
        if (activeTriggers.length === 1) {
            next = resolveOneTrigger(next, activeTriggers[0]);
            resolutions += 1;
            loop = true;
            continue;
        }
        if (inactiveTriggers.length > 1 && !next.pendingChoices) {
            const opp = next.activePlayer === 0 ? 1 : 0;
            next.pendingChoices = {
                type: "selectTrigger",
                player: opp,
                options: inactiveTriggers.map((t) => ({
                    triggerId: t.id,
                    label: t.label,
                })),
            };
            return next;
        }
        if (inactiveTriggers.length === 1) {
            next = resolveOneTrigger(next, inactiveTriggers[0]);
            resolutions += 1;
            loop = true;
        }
    }
    return next;
}
