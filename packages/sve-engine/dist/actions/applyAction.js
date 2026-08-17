"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAction = applyAction;
exports.advanceCombatIfNeeded = advanceCombatIfNeeded;
const registry_1 = require("../cards/registry");
const reprints_1 = require("../cards/reprints");
const tokens_1 = require("../cards/tokens");
const resolver_1 = require("../effects/resolver");
const setup_1 = require("../phases/setup");
const confirmation_1 = require("../rules/confirmation");
const effect_utils_1 = require("../rules/effect-utils");
const reveal_1 = require("../state/reveal");
const trigger_queue_1 = require("../rules/trigger-queue");
const union_burst_1 = require("../rules/union-burst");
const conditions_1 = require("../state/conditions");
const card_reset_1 = require("../state/card-reset");
const queries_1 = require("../state/queries");
const zones_1 = require("../state/zones");
const actionLog_1 = require("./actionLog");
function fail(state, error) {
    return { ok: false, state, error };
}
function isQuickCard(def) {
    if (!def)
        return false;
    if (def.keywords?.includes("quick"))
        return true;
    return Boolean(def.abilities?.some((a) => a.quick));
}
function hasPlayableQuickCards(state, player) {
    const pp = state.players[player].pp;
    const quickZones = [
        ...state.players[player].zones.hand.map((card) => ({ card, fromZone: "hand" })),
        ...state.players[player].zones.exArea.map((card) => ({ card, fromZone: "exArea" })),
    ];
    for (const { card, fromZone } of quickZones) {
        const def = (0, registry_1.getCardDef)(card.name);
        if (!isQuickCard(def))
            continue;
        const cost = (0, queries_1.getEffectivePlayCost)(card, card.name, state, player, fromZone);
        if (pp >= cost && (0, resolver_1.canPlayCardFromZones)(state, player, card.name))
            return true;
    }
    return false;
}
function proceedAfterEndMainQuick(state) {
    let next = structuredClone(state);
    const player = next.activePlayer;
    next.quickWindow = null;
    next.quickWindowPlayer = null;
    next.phase = "end";
    const wards = (0, queries_1.getPlayer)(next, player).zones.field.filter((c) => (0, queries_1.hasKeyword)(c, "ward", next) && !c.engaged);
    if (wards.length > 0) {
        next.pendingChoices = {
            type: "wardEngage",
            player,
            candidates: wards.map((w) => ({
                instanceId: w.instanceId,
                name: (0, queries_1.resolveCardNo)(next, w),
                label: (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(next, w))?.name || w.name,
            })),
        };
        return next;
    }
    return beginEndPhaseDiscard(next);
}
function continueEndPhaseFlow(state) {
    let next = structuredClone(state);
    if (next.pendingChoices || next.pendingTriggers.length > 0)
        return next;
    const player = next.activePlayer;
    const p = next.players[player];
    if (!p.flags.endStartAbilitiesQueued) {
        (0, trigger_queue_1.queueStartOfEndAbilities)(next, player);
        p.flags.endStartAbilitiesQueued = true;
        next = (0, confirmation_1.runConfirmationTiming)(next);
        if (next.pendingChoices || next.pendingTriggers.length > 0)
            return next;
    }
    if (!next.endPhaseQuickResolved) {
        const opp = (0, queries_1.opponentOf)(player);
        if (hasPlayableQuickCards(next, opp)) {
            next.quickWindow = "endPhase";
            next.quickWindowPlayer = opp;
            return next;
        }
        next.endPhaseQuickResolved = true;
    }
    return proceedAfterEndMainQuick(next);
}
function preserveResumeContext(next, sourceId, stack, tail) {
    const prev = next.resolutionContext;
    const appended = prev?.resumeAfterChoice ?? [];
    const owner = prev?.resumeOwnerInstanceId ?? sourceId;
    next.resolutionContext = {
        sourceInstanceId: sourceId,
        resumeOwnerInstanceId: owner,
        effectStack: stack,
        resumeAfterChoice: appended.length > 0 ? appended : tail,
        lastSelectedTargetId: prev?.lastSelectedTargetId,
        buriedCosts: prev?.buriedCosts,
        lastDiscardedCardName: prev?.lastDiscardedCardName,
        lastSelectedCardName: prev?.lastSelectedCardName,
        engagedAsCostCount: prev?.engagedAsCostCount,
        pendingUnionBurst: prev?.pendingUnionBurst,
        resolvingUnionBurstSourceId: prev?.resolvingUnionBurstSourceId,
        deferTriggers: true,
    };
    return next;
}
function continueAfterChoice(state, player) {
    if (state.pendingChoices)
        return state;
    let next = state;
    const resumeOwner = next.resolutionContext?.resumeOwnerInstanceId ?? next.resolutionContext?.sourceInstanceId;
    const sourceId = resumeOwner;
    const stack = next.resolutionContext?.effectStack ?? [];
    // Do not resolve queued triggers while a multi-step effect still has resume work
    // (e.g. Disdainful Rending must finish both damages before Galmieux's ping trigger).
    const hasResume = (next.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0;
    if (!hasResume && !(0, effect_utils_1.shouldDeferTriggers)(next) && next.pendingTriggers.length > 0) {
        next = (0, confirmation_1.runConfirmationTiming)(next);
        if (next.pendingChoices || next.pendingTriggers.length > 0)
            return next;
    }
    while (next.resolutionContext?.resumeAfterChoice?.length) {
        const [head, ...tail] = next.resolutionContext.resumeAfterChoice;
        const prev = next.resolutionContext;
        next.resolutionContext = {
            sourceInstanceId: sourceId,
            resumeOwnerInstanceId: resumeOwner ?? sourceId,
            effectStack: stack,
            resumeAfterChoice: tail,
            // Do not carry forcedTargetId into the next step (would auto-resolve unrelated
            // damage). Keep lastSelectedTargetId for conditions like Flag's Condemned check.
            lastSelectedTargetId: prev?.lastSelectedTargetId,
            buriedCosts: prev?.buriedCosts,
            lastDiscardedCardName: prev?.lastDiscardedCardName,
            lastSelectedCardName: prev?.lastSelectedCardName,
            engagedAsCostCount: prev?.engagedAsCostCount,
            pendingUnionBurst: prev?.pendingUnionBurst,
            resolvingUnionBurstSourceId: prev?.resolvingUnionBurstSourceId,
            deferTriggers: true,
        };
        next = (0, resolver_1.resolveEffect)(next, head, player, { deferConfirmation: true });
        if (next.pendingChoices) {
            return preserveResumeContext(next, sourceId, stack, tail);
        }
    }
    if (!next.pendingChoices && !(next.resolutionContext?.resumeAfterChoice?.length ?? 0)) {
        next = (0, effect_utils_1.finishDeferredTriggers)(next);
        // Flush the resolving spell (kept in resolution during choose/target prompts).
        if (sourceId) {
            const src = (0, queries_1.findInstance)(next, sourceId);
            if (src?.zone === "resolutionZone" && (0, registry_1.getCardDef)(src.card.name)?.cardType === "spell") {
                next = (0, zones_1.moveCard)(next, sourceId, "cemetery", src.player);
            }
        }
        next = (0, union_burst_1.flushPendingUnionBurst)(next);
        if ((0, effect_utils_1.shouldClearResolutionContext)(next)) {
            next.resolutionContext = null;
        }
    }
    return next;
}
function finishEndPhase(state) {
    let next = structuredClone(state);
    const player = next.activePlayer;
    const hand = next.players[player].zones.hand;
    if (hand.length > next.players[player].handLimit) {
        const excess = hand.length - next.players[player].handLimit;
        next.pendingChoices = {
            type: "discard",
            player,
            count: excess,
            candidates: hand.map((c) => ({
                instanceId: c.instanceId,
                name: (0, queries_1.resolveCardNo)(next, c),
                label: (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(next, c))?.name || c.name,
            })),
        };
        return next;
    }
    return endTurn(next);
}
function maybeContinueEndPhase(state) {
    if (state.phase !== "end")
        return state;
    return continueEndPhaseFlow(state);
}
function isCombatAttackerOnField(state) {
    if (!state.combat)
        return false;
    const found = (0, queries_1.findInstance)(state, state.combat.attackerId);
    return Boolean(found && found.zone === "field");
}
function abortCombatIfAttackerGone(state) {
    if (!state.combat || isCombatAttackerOnField(state))
        return state;
    const next = structuredClone(state);
    next.combat = null;
    next.phase = "main";
    next.quickWindow = null;
    next.quickWindowPlayer = null;
    return next;
}
function continuePausedCombat(state) {
    if (!state.combat || state.pendingChoices)
        return state;
    let next = abortCombatIfAttackerGone(state);
    if (!next.combat)
        return next;
    const combat = next.combat;
    if (combat.strikeAbilityIndex != null) {
        next = structuredClone(next);
        next.phase = "combat";
        next.combat = { ...combat, strikeAbilityIndex: combat.strikeAbilityIndex + 1 };
        return resolveCombat(next);
    }
    if (combat.phase === "declared") {
        next = structuredClone(next);
        next.phase = "combat";
        return resolveCombat(next);
    }
    return next;
}
function finishChoiceResolution(state, player) {
    let next = state;
    if (!next.pendingChoices) {
        next = continueAfterChoice(next, player);
    }
    next = (0, confirmation_1.runConfirmationTiming)(next);
    if (!next.pendingChoices) {
        next = continuePausedCombat(next);
    }
    if (next.phase === "end") {
        next = continueEndPhaseFlow(next);
    }
    else {
        next = maybeContinueEndPhase(next);
    }
    return next;
}
function sendSearchRemainder(state, player, instanceIds, remainderTo) {
    if (remainderTo === "deckTop") {
        // Leave looked-at cards on top in their current order.
        return state;
    }
    if (remainderTo === "shuffle") {
        // Full-deck search: unchosen cards stay in place, then shuffle.
        return (0, zones_1.shuffleDeck)(state, player);
    }
    if (remainderTo === "deckBottom") {
        let next = structuredClone(state);
        const deck = next.players[player].zones.deck;
        for (const id of instanceIds) {
            const idx = deck.findIndex((c) => c.instanceId === id);
            if (idx < 0)
                continue;
            const [card] = deck.splice(idx, 1);
            deck.push(card);
        }
        return next;
    }
    return (0, resolver_1.buryDeckCards)(state, player, instanceIds);
}
function ok(state) {
    return { ok: true, state };
}
function assertActivePlayer(state, player, error) {
    if (state.activePlayer !== player)
        return fail(state, error);
    return null;
}
function assertPhase(state, phases, error) {
    if (!phases.includes(state.phase))
        return fail(state, error);
    return null;
}
function handleChoiceResponse(state, player, payload) {
    const choice = state.pendingChoices;
    if (!choice || choice.player !== player)
        return fail(state, "No pending choice");
    let next = structuredClone(state);
    next.pendingChoices = null;
    if (choice.type === "mulligan") {
        return ok((0, setup_1.applyMulligan)(next, player, Boolean(payload.redraw)));
    }
    if (choice.type === "selectTrigger") {
        const triggerId = String(payload.triggerId);
        const trigger = next.pendingTriggers.find((t) => t.id === triggerId);
        if (!trigger)
            return fail(state, "Invalid trigger");
        next = (0, confirmation_1.resolveOneTrigger)(next, trigger);
        next = finishChoiceResolution(next, player);
        next = maybeContinueEndPhase(next);
        return ok(next);
    }
    if (choice.type === "selectTarget") {
        const allowed = (choice.candidates ?? []).map((c) => typeof c === "string" ? c : c.instanceId);
        const minCount = choice.minCount ?? choice.count ?? 1;
        const maxCount = choice.maxCount ?? choice.count ?? 1;
        const isMulti = maxCount > 1 || minCount !== maxCount;
        let targetIds = [];
        if (isMulti) {
            targetIds = Array.isArray(payload.targetIds)
                ? payload.targetIds.map(String)
                : payload.targetId
                    ? [String(payload.targetId)]
                    : [];
            if (targetIds.length < minCount || targetIds.length > maxCount) {
                return fail(state, minCount === maxCount
                    ? `Must select exactly ${minCount} card(s)`
                    : `Must select between ${minCount} and ${maxCount} card(s)`);
            }
            for (const id of targetIds) {
                if (!allowed.includes(id))
                    return fail(state, "Invalid target");
            }
        }
        else {
            const targetId = String(payload.targetId);
            if (!allowed.includes(targetId)) {
                return fail(state, "Invalid target");
            }
            targetIds = [targetId];
        }
        const resume = next.resolutionContext?.resumeAfterChoice;
        const prev = next.resolutionContext;
        const sourceId = prev?.sourceInstanceId ?? next.combat?.attackerId;
        next.resolutionContext = {
            sourceInstanceId: sourceId,
            resumeOwnerInstanceId: prev?.resumeOwnerInstanceId ?? sourceId,
            effectStack: [choice.effect],
            forcedTargetId: targetIds[0],
            forcedTargetIds: isMulti ? targetIds : undefined,
            lastSelectedTargetId: targetIds[0],
            resumeAfterChoice: resume,
            buriedCosts: prev?.buriedCosts,
            lastDiscardedCardName: prev?.lastDiscardedCardName,
            lastSelectedCardName: prev?.lastSelectedCardName,
            engagedAsCostCount: prev?.engagedAsCostCount,
            pendingUnionBurst: prev?.pendingUnionBurst,
            resolvingUnionBurstSourceId: prev?.resolvingUnionBurstSourceId,
            deferTriggers: true,
        };
        // Defer confirmation so multi-step spells (e.g. Disdainful Rending) finish
        // their resume queue before queued ability-damage triggers resolve.
        next = (0, resolver_1.resolveEffect)(next, choice.effect, player, { deferConfirmation: true });
        return ok(finishChoiceResolution(next, player));
    }
    if (choice.type === "selectZoneCards") {
        const ids = payload.instanceIds || [];
        const minCount = choice.minCount ?? choice.count;
        const maxCount = choice.maxCount ?? choice.count;
        if (ids.length < minCount || ids.length > maxCount) {
            return fail(state, minCount === maxCount
                ? `Must select exactly ${minCount} card(s)`
                : `Must select between ${minCount} and ${maxCount} card(s)`);
        }
        for (const id of ids) {
            if (!choice.options.some((o) => o.instanceId === id)) {
                return fail(state, "Invalid card");
            }
        }
        for (const id of ids) {
            if (choice.fromZone === "field" && choice.action === "engage") {
                const found = (0, queries_1.findInstance)(next, id);
                if (!found || found.zone !== "field")
                    return fail(state, "Invalid card");
                if (found.card.engaged)
                    return fail(state, "Card is already engaged");
                found.card.engaged = true;
                continue;
            }
            if (choice.fromZone === "field" && choice.action === "bury") {
                const buried = (0, queries_1.findInstance)(next, id);
                if (!buried || buried.zone !== "field")
                    return fail(state, "Invalid card");
                (0, trigger_queue_1.queueLastWords)(next, id, buried.player);
                next = (0, zones_1.destroyFollower)(next, id);
                continue;
            }
            if (choice.action === "fuse") {
                const pZones = next.players[player].zones;
                let handIdx = pZones.hand.findIndex((c) => c.instanceId === id);
                if (handIdx >= 0) {
                    const [card] = pZones.hand.splice(handIdx, 1);
                    (0, card_reset_1.resetCardInstanceState)(card);
                    (0, tokens_1.placeLeavingPlay)(pZones, card, "cemetery");
                    (0, trigger_queue_1.queueOnDiscard)(next, card.instanceId, player);
                    next.resolutionContext = {
                        ...next.resolutionContext,
                        sourceInstanceId: next.resolutionContext?.sourceInstanceId,
                        resumeOwnerInstanceId: next.resolutionContext?.resumeOwnerInstanceId,
                        effectStack: next.resolutionContext?.effectStack ?? [],
                        resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
                        deferTriggers: next.resolutionContext?.deferTriggers,
                        buriedCosts: next.resolutionContext?.buriedCosts,
                        engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
                        lastDiscardedCardName: card.name,
                    };
                    continue;
                }
                const exIdx = pZones.exArea.findIndex((c) => c.instanceId === id);
                if (exIdx < 0)
                    return fail(state, "Invalid card");
                const [card] = pZones.exArea.splice(exIdx, 1);
                (0, card_reset_1.resetCardInstanceState)(card);
                (0, tokens_1.placeLeavingPlay)(pZones, card, "cemetery");
                continue;
            }
            const zone = next.players[player].zones[choice.fromZone];
            const idx = zone.findIndex((c) => c.instanceId === id);
            if (idx < 0)
                return fail(state, "Invalid card");
            const [card] = zone.splice(idx, 1);
            if (choice.action === "banish") {
                (0, card_reset_1.resetCardInstanceState)(card);
                (0, tokens_1.placeLeavingPlay)(next.players[player].zones, card, "banish");
            }
            else {
                (0, card_reset_1.resetCardInstanceState)(card);
                (0, tokens_1.placeLeavingPlay)(next.players[player].zones, card, "cemetery");
                if (choice.action === "discard" && choice.fromZone === "hand") {
                    (0, trigger_queue_1.queueOnDiscard)(next, card.instanceId, player);
                    next.resolutionContext = {
                        ...next.resolutionContext,
                        sourceInstanceId: next.resolutionContext?.sourceInstanceId,
                        resumeOwnerInstanceId: next.resolutionContext?.resumeOwnerInstanceId,
                        effectStack: next.resolutionContext?.effectStack ?? [],
                        resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
                        deferTriggers: next.resolutionContext?.deferTriggers,
                        buriedCosts: next.resolutionContext?.buriedCosts,
                        engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
                        lastDiscardedCardName: card.name,
                    };
                }
            }
        }
        if (choice.recordEngagedAsCost) {
            next.resolutionContext = {
                ...next.resolutionContext,
                sourceInstanceId: next.resolutionContext?.sourceInstanceId,
                effectStack: next.resolutionContext?.effectStack ?? [],
                resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
                deferTriggers: next.resolutionContext?.deferTriggers,
                buriedCosts: next.resolutionContext?.buriedCosts,
                lastDiscardedCardName: next.resolutionContext?.lastDiscardedCardName,
                engagedAsCostCount: ids.length,
            };
        }
        if (choice.resumeActivate) {
            const { sourceInstanceId, zone: activateZone, abilityKey } = choice.resumeActivate;
            if (choice.fromZone === "exArea" && choice.action === "banish") {
                const ex = next.players[player].zones.exArea;
                const srcIdx = ex.findIndex((c) => c.instanceId === sourceInstanceId);
                if (srcIdx >= 0) {
                    const [self] = ex.splice(srcIdx, 1);
                    (0, card_reset_1.resetCardInstanceState)(self);
                    (0, tokens_1.placeLeavingPlay)(next.players[player].zones, self, "banish");
                }
            }
            next = finishActivateAfterCost(next, player, sourceInstanceId, activateZone, abilityKey);
            return ok(finishChoiceResolution(next, player));
        }
        return ok(finishChoiceResolution(next, player));
    }
    if (choice.type === "selectDeckSummon") {
        const ids = payload.instanceIds || [];
        let totalCost = 0;
        const p = next.players[player];
        const to = choice.to ?? "field";
        if (choice.maxCount != null && ids.length > choice.maxCount) {
            return fail(state, `Select up to ${choice.maxCount} card(s)`);
        }
        const seenNames = new Set();
        for (const id of ids) {
            if (!choice.topInstanceIds.includes(id))
                return fail(state, "Invalid card");
            const option = choice.options.find((o) => o.instanceId === id);
            if (!option?.eligible)
                return fail(state, "Card does not match filter");
            if (choice.distinctNames) {
                const key = (0, reprints_1.normalizeIdentityName)(option.name);
                if (seenNames.has(key)) {
                    return fail(state, "Selected cards must have different names");
                }
                seenNames.add(key);
            }
            totalCost += option.cost;
        }
        if (choice.maxTotalCost != null && totalCost > choice.maxTotalCost) {
            return fail(state, `Total cost must be ${choice.maxTotalCost} or less`);
        }
        if (to === "field") {
            const slots = p.fieldLimit - (0, queries_1.fieldOccupancy)(p.zones.field);
            if (ids.length > slots)
                return fail(state, "Not enough field space");
        }
        else if (to === "exArea") {
            const slots = p.exLimit - p.zones.exArea.length;
            if (ids.length > slots)
                return fail(state, "Not enough EX space");
        }
        else if (to === "hand") {
            // hand has no hard limit for this search
        }
        for (const id of ids) {
            const idx = next.players[player].zones.deck.findIndex((c) => c.instanceId === id);
            if (idx < 0)
                continue;
            const [card] = next.players[player].zones.deck.splice(idx, 1);
            if (choice.playCostReduction) {
                card.playCostReduction = (card.playCostReduction ?? 0) + choice.playCostReduction;
            }
            if (to === "exArea") {
                if (next.players[player].zones.exArea.length >= next.players[player].exLimit)
                    break;
                next.players[player].zones.exArea.push(card);
                (0, confirmation_1.onCardEntersExArea)(next, card.instanceId, player);
            }
            else if (to === "hand") {
                next.players[player].zones.hand.push(card);
                if ((0, reveal_1.shouldRevealBeforeHand)("hand", "deck", choice.reveal)) {
                    next = (0, reveal_1.revealCard)(next, player, id, card.name);
                }
            }
            else {
                if (!(0, queries_1.hasFieldSpace)(next.players[player].zones.field, next.players[player].fieldLimit))
                    break;
                next.players[player].zones.field.push(card);
                (0, confirmation_1.onFollowerEntersField)(next, card.instanceId, player);
            }
        }
        const remaining = choice.topInstanceIds.filter((id) => !ids.includes(id));
        next = sendSearchRemainder(next, player, remaining, choice.remainderTo);
        return ok(finishChoiceResolution(next, player));
    }
    if (choice.type === "selectCemeterySummon") {
        const ids = payload.instanceIds || [];
        const minCount = choice.minCount ?? 1;
        if (ids.length < minCount || ids.length > choice.count) {
            return fail(state, minCount === choice.count
                ? `Select exactly ${choice.count} card(s)`
                : `Select ${minCount} to ${choice.count} card(s)`);
        }
        let totalCost = 0;
        const p = next.players[player];
        const seenNames = new Set();
        for (const id of ids) {
            const card = p.zones.cemetery.find((c) => c.instanceId === id);
            if (!card || !(0, conditions_1.cardMatchesFilter)(card.name, choice.filter)) {
                return fail(state, "Invalid card");
            }
            if (choice.distinctNames) {
                const key = (0, reprints_1.normalizeIdentityName)(card.name);
                if (seenNames.has(key)) {
                    return fail(state, "Selected cards must have different names");
                }
                seenNames.add(key);
            }
            totalCost += (0, queries_1.resolveCardDefCost)(card.name);
        }
        if (choice.maxTotalCost != null && totalCost > choice.maxTotalCost) {
            return fail(state, `Total cost must be ${choice.maxTotalCost} or less`);
        }
        const slots = p.fieldLimit - (0, queries_1.fieldOccupancy)(p.zones.field);
        const toZone = choice.to ?? "field";
        if (toZone === "field" && ids.length > slots)
            return fail(state, "Not enough field space");
        for (const id of ids) {
            const idx = p.zones.cemetery.findIndex((c) => c.instanceId === id);
            if (idx < 0)
                continue;
            const [card] = p.zones.cemetery.splice(idx, 1);
            if (choice.playCostReduction) {
                card.playCostReduction = (card.playCostReduction ?? 0) + choice.playCostReduction;
            }
            if (toZone === "exArea") {
                p.zones.exArea.push(card);
                (0, confirmation_1.onCardEntersExArea)(next, card.instanceId, player);
            }
            else {
                p.zones.field.push(card);
                (0, confirmation_1.onFollowerEntersField)(next, card.instanceId, player);
            }
        }
        return ok(finishChoiceResolution(next, player));
    }
    if (choice.type === "putHandOnDeck") {
        if (choice.phase === "selectCard") {
            const instanceId = String(payload.instanceId);
            const found = (0, queries_1.findInstance)(next, instanceId);
            if (!found || found.zone !== "hand" || found.player !== player) {
                return fail(state, "Invalid card");
            }
            if (!choice.position) {
                next.pendingChoices = {
                    type: "putHandOnDeck",
                    player,
                    phase: "selectPosition",
                    selectedInstanceId: instanceId,
                    options: choice.options,
                };
                return ok(next);
            }
            next = putHandCardOnDeck(next, player, instanceId, choice.position);
            return ok(finishChoiceResolution(next, player));
        }
        const position = payload.position === "bottom" ? "bottom" : "top";
        if (!choice.selectedInstanceId)
            return fail(state, "No card selected");
        next = putHandCardOnDeck(next, player, choice.selectedInstanceId, position);
        return ok(finishChoiceResolution(next, player));
    }
    if (choice.type === "selectZoneCard") {
        if (payload.skip && choice.optional) {
            return ok(finishChoiceResolution(next, player));
        }
        const instanceId = String(payload.instanceId);
        const zoneOwner = choice.fromPlayer ?? player;
        const found = (0, queries_1.findInstance)(next, instanceId);
        if (!found || found.zone !== choice.fromZone || found.player !== zoneOwner) {
            return fail(state, "Invalid card");
        }
        if (next.resolutionContext) {
            next.resolutionContext.lastSelectedCardName = found.card.name;
            next.resolutionContext.lastSelectedTargetId = instanceId;
        }
        else {
            next.resolutionContext = {
                effectStack: [],
                lastSelectedCardName: found.card.name,
                lastSelectedTargetId: instanceId,
                deferTriggers: true,
            };
        }
        if (choice.playSelected) {
            const def = (0, registry_1.getCardDef)(found.card.name);
            if (!def)
                return fail(state, "Unknown card");
            if (def.cardType === "crest") {
                if (next.players[player].zones.exArea.length >= next.players[player].exLimit) {
                    return fail(state, "EX area full");
                }
            }
            else if (def.cardType !== "spell" &&
                !(0, queries_1.hasFieldSpace)(next.players[player].zones.field, next.players[player].fieldLimit)) {
                return fail(state, "Field full");
            }
            // Spells with no legal targets: accept the cemetery choice and close the
            // prompt, but do not play the card (it stays in the cemetery).
            if (def.cardType === "spell" && !(0, resolver_1.canPlayCardFromZones)(next, player, found.card.name)) {
                return ok(finishChoiceResolution(next, player));
            }
            next = playCardForFree(next, player, instanceId);
            return ok(finishChoiceResolution(next, player));
        }
        if ((0, reveal_1.shouldRevealBeforeHand)(choice.to, choice.fromZone, choice.reveal)) {
            next = (0, reveal_1.revealCard)(next, zoneOwner, instanceId, found.card.name);
        }
        if (zoneOwner !== player) {
            next = (0, zones_1.moveCard)(next, instanceId, choice.to, player);
            if (choice.to === "exArea" && choice.playCostReduction) {
                const moved = (0, queries_1.findInstance)(next, instanceId);
                if (moved) {
                    moved.card.playCostReduction += choice.playCostReduction;
                }
            }
            if (choice.to === "field") {
                const moved = (0, queries_1.findInstance)(next, instanceId);
                if (moved) {
                    moved.card.enteredFromCemetery = choice.fromZone === "cemetery";
                    moved.card.enteredFromHand = choice.fromZone === "hand";
                }
            }
        }
        else {
            next = (0, resolver_1.moveZoneCardTo)(next, player, instanceId, choice.fromZone, choice.to);
            if (choice.to === "exArea" && choice.playCostReduction) {
                const moved = (0, queries_1.findInstance)(next, instanceId);
                if (moved) {
                    moved.card.playCostReduction += choice.playCostReduction;
                }
            }
        }
        return ok(finishChoiceResolution(next, player));
    }
    if (choice.type === "searchDeckTop") {
        const remainderTo = choice.remainderTo ?? "cemetery";
        if (payload.skip && choice.optional) {
            next = sendSearchRemainder(next, player, choice.topInstanceIds, remainderTo);
            return ok(finishChoiceResolution(next, player));
        }
        const instanceId = String(payload.instanceId);
        if (!choice.topInstanceIds.includes(instanceId)) {
            return fail(state, "Invalid card");
        }
        const option = choice.options.find((o) => o.instanceId === instanceId);
        if (!option?.eligible)
            return fail(state, "Card does not match filter");
        if ((0, reveal_1.shouldRevealBeforeHand)(choice.to, "deck", choice.reveal)) {
            next = (0, reveal_1.revealCard)(next, player, instanceId, option.name);
        }
        if (next.resolutionContext) {
            next.resolutionContext.lastSelectedCardName = option.name;
            next.resolutionContext.lastSelectedTargetId = instanceId;
        }
        else {
            next.resolutionContext = {
                effectStack: [],
                lastSelectedCardName: option.name,
                lastSelectedTargetId: instanceId,
                deferTriggers: true,
            };
        }
        if (choice.to === "cemetery") {
            next = (0, resolver_1.buryDeckCards)(next, player, [instanceId]);
        }
        else {
            next = (0, resolver_1.moveZoneCardTo)(next, player, instanceId, "deck", choice.to);
        }
        if (choice.to === "exArea") {
            const moved = (0, queries_1.findInstance)(next, instanceId);
            if (!moved || moved.zone !== "exArea") {
                return fail(state, "EX area full");
            }
            if (choice.playCostReduction &&
                (!choice.playCostReductionFilter ||
                    (0, conditions_1.cardMatchesFilter)(moved.card.name, choice.playCostReductionFilter))) {
                moved.card.playCostReduction += choice.playCostReduction;
            }
        }
        const remaining = choice.topInstanceIds.filter((id) => id !== instanceId);
        next = sendSearchRemainder(next, player, remaining, remainderTo);
        return ok(finishChoiceResolution(next, player));
    }
    if (choice.type === "discard") {
        const ids = payload.instanceIds || [];
        if (ids.length !== choice.count) {
            return fail(state, `Must discard exactly ${choice.count} card(s)`);
        }
        const handIds = new Set(next.players[player].zones.hand.map((c) => c.instanceId));
        for (const id of ids) {
            if (!handIds.has(id))
                return fail(state, "Card not in hand");
            next = (0, zones_1.moveCard)(next, id, "cemetery", player);
            (0, trigger_queue_1.queueOnDiscard)(next, id, player);
        }
        next = (0, confirmation_1.runConfirmationTiming)(next);
        if (next.pendingChoices || next.pendingTriggers.length > 0) {
            return ok(next);
        }
        return ok(beginEndPhaseDiscard(next));
    }
    if (choice.type === "wardEngage") {
        const ids = payload.instanceIds || [];
        for (const id of ids) {
            const found = (0, queries_1.findInstance)(next, id);
            if (found)
                found.card.engaged = true;
        }
        return ok(beginEndPhaseDiscard(next));
    }
    if (choice.type === "choose") {
        const index = Number(payload.optionIndex);
        const opt = choice.options.find((o) => o.index === index);
        if (!opt)
            return fail(state, "Invalid choice");
        if (opt.additionalPpCost) {
            if (next.players[player].pp < opt.additionalPpCost) {
                return fail(state, "Not enough PP");
            }
            next.players[player].pp -= opt.additionalPpCost;
        }
        const trackKey = choice.trackChosenKey;
        const sourceId = choice.sourceInstanceId ?? next.resolutionContext?.sourceInstanceId;
        if (trackKey) {
            const sourceCard = sourceId ? (0, queries_1.findInstance)(next, sourceId)?.card : undefined;
            const usedIdx = (0, effect_utils_1.getChosenChooseIndices)(next, player, trackKey, sourceCard, sourceId);
            const usedLabels = (0, effect_utils_1.getChosenChooseLabels)(next, player, trackKey, sourceCard, sourceId);
            if (usedIdx.has(index) || usedLabels.has(opt.label)) {
                return fail(state, "Already chose that option this turn");
            }
        }
        if (choice.commitUnionBurstOnPay && index !== 0) {
            next = (0, union_burst_1.cancelPendingUnionBurst)(next);
        }
        // Defer confirmation so nested target prompts don't race with turn cleanup.
        next = (0, resolver_1.resolveEffect)(next, opt.effect, player, { deferConfirmation: true });
        // Record after the option effect so tracking lands on the final state clone.
        if (trackKey) {
            (0, effect_utils_1.recordChosenChooseOption)(next, player, trackKey, index, opt.label, sourceId);
        }
        return ok(finishChoiceResolution(next, player));
    }
    if (choice.type === "chooseMultiple") {
        const indices = payload.optionIndices || [];
        if (indices.length < choice.min || indices.length > choice.max) {
            return fail(state, `Choose between ${choice.min} and ${choice.max} option(s)`);
        }
        const unique = new Set(indices);
        if (unique.size !== indices.length)
            return fail(state, "Duplicate options");
        const effects = indices.flatMap((index) => {
            const opt = choice.options.find((o) => o.index === index);
            if (!opt)
                return [];
            if (opt.effect.op === "sequence")
                return opt.effect.steps;
            return [opt.effect];
        });
        next.resolutionContext = {
            sourceInstanceId: next.resolutionContext?.sourceInstanceId,
            effectStack: [],
            resumeAfterChoice: effects,
            deferTriggers: true,
        };
        return ok(finishChoiceResolution(next, player));
    }
    return ok(next);
}
function putHandCardOnDeck(state, player, instanceId, position) {
    const next = structuredClone(state);
    const hand = next.players[player].zones.hand;
    const idx = hand.findIndex((c) => c.instanceId === instanceId);
    if (idx < 0)
        return state;
    const [card] = hand.splice(idx, 1);
    if (position === "top")
        next.players[player].zones.deck.unshift(card);
    else
        next.players[player].zones.deck.push(card);
    return next;
}
/** Play a card already in a zone (e.g. opponent cemetery) for 0 PP. */
function playCardForFree(state, player, instanceId) {
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found)
        return state;
    const def = (0, registry_1.getCardDef)(found.card.name);
    if (!def)
        return state;
    const prev = state.resolutionContext;
    let next = structuredClone(state);
    const p = next.players[player];
    p.flags.cardsPlayedThisTurn += 1;
    if (def.cardType === "spell") {
        p.flags.spellsPlayedThisTurn = (p.flags.spellsPlayedThisTurn ?? 0) + 1;
    }
    (0, queries_1.consumeGrantedPlayCostReductions)(next, player, found.card.name);
    if (def.cardType === "crest") {
        if (p.zones.exArea.length >= p.exLimit)
            return state;
        next = (0, zones_1.moveCard)(next, instanceId, "exArea", player);
        next.resolutionContext = {
            sourceInstanceId: prev?.sourceInstanceId,
            effectStack: prev?.effectStack ?? [],
            resumeAfterChoice: prev?.resumeAfterChoice,
            forcedTargetId: prev?.forcedTargetId,
            buriedCosts: prev?.buriedCosts,
            lastDiscardedCardName: prev?.lastDiscardedCardName,
            lastSelectedCardName: prev?.lastSelectedCardName,
            engagedAsCostCount: prev?.engagedAsCostCount,
            deferTriggers: true,
        };
    }
    else if (def.cardType !== "spell") {
        if (!(0, queries_1.hasFieldSpace)(p.zones.field, p.fieldLimit))
            return state;
        next = (0, zones_1.moveCard)(next, instanceId, "field", player);
        const onField = (0, queries_1.findInstance)(next, instanceId);
        if (onField) {
            onField.card.enteredFromCemetery = found.zone === "cemetery";
            onField.card.enteredFromHand = false;
        }
        next.resolutionContext = {
            sourceInstanceId: prev?.sourceInstanceId,
            effectStack: prev?.effectStack ?? [],
            resumeAfterChoice: prev?.resumeAfterChoice,
            forcedTargetId: prev?.forcedTargetId,
            buriedCosts: prev?.buriedCosts,
            lastDiscardedCardName: prev?.lastDiscardedCardName,
            lastSelectedCardName: prev?.lastSelectedCardName,
            engagedAsCostCount: prev?.engagedAsCostCount,
            deferTriggers: true,
        };
    }
    else {
        next = (0, zones_1.moveCard)(next, instanceId, "resolutionZone", player);
        next.resolutionContext = {
            sourceInstanceId: instanceId,
            resumeOwnerInstanceId: instanceId,
            effectStack: [],
            resumeAfterChoice: prev?.resumeAfterChoice,
            forcedTargetId: prev?.forcedTargetId,
            buriedCosts: prev?.buriedCosts,
            lastDiscardedCardName: prev?.lastDiscardedCardName,
            lastSelectedCardName: prev?.lastSelectedCardName,
            engagedAsCostCount: prev?.engagedAsCostCount,
            deferTriggers: true,
        };
        next = (0, resolver_1.resolveSpell)(next, found.card.name, player);
        if (!next.pendingChoices) {
            // Queue while the spell still exists — token spells are eliminated on
            // cemetery move and would otherwise skip on-play watchers (e.g. Barbaros).
            (0, trigger_queue_1.queueOnCardPlayed)(next, instanceId, player, found.card.name);
            const res = (0, queries_1.findInstance)(next, instanceId);
            if (res?.zone === "resolutionZone") {
                next = (0, zones_1.moveCard)(next, instanceId, "cemetery", player);
            }
            // Restore prior ability source after the free spell finishes immediately.
            if (!(next.resolutionContext?.resumeAfterChoice?.length ?? 0)) {
                next.resolutionContext = {
                    sourceInstanceId: prev?.sourceInstanceId,
                    resumeOwnerInstanceId: prev?.resumeOwnerInstanceId,
                    effectStack: prev?.effectStack ?? [],
                    resumeAfterChoice: prev?.resumeAfterChoice,
                    forcedTargetId: prev?.forcedTargetId,
                    buriedCosts: prev?.buriedCosts,
                    lastDiscardedCardName: prev?.lastDiscardedCardName,
                    lastSelectedCardName: prev?.lastSelectedCardName,
                    engagedAsCostCount: prev?.engagedAsCostCount,
                    deferTriggers: true,
                };
            }
        }
        else {
            (0, trigger_queue_1.queueOnCardPlayed)(next, instanceId, player, found.card.name);
        }
    }
    if (def.cardType !== "spell") {
        (0, trigger_queue_1.queueOnCardPlayed)(next, instanceId, player);
    }
    return next;
}
function beginEndPhaseDiscard(state) {
    return finishEndPhase(structuredClone(state));
}
function clearTurnPlayCostReduction(player) {
    for (const zone of Object.values(player.zones)) {
        if (!Array.isArray(zone))
            continue;
        for (const card of zone) {
            card.playCostReduction = 0;
        }
    }
}
function endTurn(state) {
    let next = structuredClone(state);
    const player = next.activePlayer;
    for (const p of next.players) {
        p.flags.endStartAbilitiesQueued = false;
        p.flags.chosenChooseOptionTracksThisTurn = {};
        p.flags.chosenChooseOptionLabelsThisTurn = {};
        for (const cards of [p.zones.field, p.zones.hand, p.zones.exArea, p.zones.cemetery]) {
            for (const card of cards) {
                card.modifiers = card.modifiers.filter((m) => !m.untilEndOfTurn);
                card.abilitiesActivatedThisTurn = [];
                card.chosenChooseOptionsThisTurn = {};
                card.chosenChooseOptionLabelsThisTurn = {};
            }
        }
    }
    clearTurnPlayCostReduction(next.players[player]);
    next.activePlayer = (0, queries_1.opponentOf)(player);
    next.turnNumber += 1;
    next.phase = "start";
    next.combat = null;
    next.quickWindow = null;
    next.endPhaseQuickResolved = undefined;
    next = (0, setup_1.beginStartPhase)(next);
    next = (0, confirmation_1.runConfirmationTiming)(next);
    return next;
}
function playCard(state, player, handInstanceId, targets, fromQuickWindow = false) {
    const inQuickWindow = state.quickWindow !== null;
    if (inQuickWindow) {
        if (state.quickWindowPlayer !== player)
            return fail(state, "Not your quick window");
        if (!fromQuickWindow)
            return fail(state, "Use quick play during quick window");
    }
    else {
        const phaseErr = assertPhase(state, ["main"], "Cannot play card now");
        if (phaseErr)
            return phaseErr;
        const activeErr = assertActivePlayer(state, player, "Not your turn");
        if (activeErr)
            return activeErr;
    }
    const found = (0, queries_1.findInstance)(state, handInstanceId);
    if (!found || found.player !== player) {
        return fail(state, "Card not found");
    }
    if (found.zone !== "hand" && found.zone !== "exArea") {
        return fail(state, "Card not in hand or EX area");
    }
    const def = (0, registry_1.getCardDef)(found.card.name);
    if (!def)
        return fail(state, "Unknown card");
    if (def.cardType === "crest") {
        return fail(state, "Crests cannot be played");
    }
    if (inQuickWindow && !isQuickCard(def)) {
        return fail(state, "Not a quick card");
    }
    if (def.cardType === "spell" && !(0, resolver_1.canPlayCardFromZones)(state, player, found.card.name)) {
        return fail(state, "No valid targets");
    }
    let next = structuredClone(state);
    const p = next.players[player];
    const playCost = (0, queries_1.getEffectivePlayCost)(found.card, found.card.name, state, player, found.zone);
    if (p.pp < playCost)
        return fail(state, "Not enough PP");
    p.pp -= playCost;
    p.flags.cardsPlayedThisTurn += 1;
    if (def.cardType === "spell") {
        p.flags.spellsPlayedThisTurn = (p.flags.spellsPlayedThisTurn ?? 0) + 1;
    }
    (0, queries_1.consumeGrantedPlayCostReductions)(next, player, found.card.name);
    if (!(0, queries_1.hasFieldSpace)(p.zones.field, p.fieldLimit) && def.cardType !== "spell") {
        return fail(state, "Field full");
    }
    next = (0, zones_1.moveCard)(next, handInstanceId, "resolutionZone", player);
    const inResolution = (0, queries_1.findInstance)(next, handInstanceId);
    if (inResolution && def.cardType !== "spell") {
        inResolution.card.enteredFromHand = found.zone === "hand";
    }
    if (def.cardType === "spell") {
        next.resolutionContext = {
            sourceInstanceId: handInstanceId,
            resumeOwnerInstanceId: handInstanceId,
            effectStack: [],
            deferTriggers: true,
        };
        next = (0, resolver_1.resolveSpell)(next, found.card.name, player);
        // Keep the spell in resolution while a choose/target prompt is open so it
        // is not double-counted in the cemetery and effects can still see it.
        if (!next.pendingChoices) {
            // Queue while the spell still exists — token spells cease to exist when
            // moved to cemetery and would otherwise skip on-play watchers.
            (0, trigger_queue_1.queueOnCardPlayed)(next, handInstanceId, player, found.card.name);
            const res = (0, queries_1.findInstance)(next, handInstanceId);
            if (res) {
                next = (0, zones_1.moveCard)(next, handInstanceId, "cemetery", player);
            }
            if ((0, effect_utils_1.shouldClearResolutionContext)(next)) {
                next.resolutionContext = null;
            }
        }
        else {
            (0, trigger_queue_1.queueOnCardPlayed)(next, handInstanceId, player, found.card.name);
        }
    }
    else if (def.cardType === "follower" || def.cardType === "amulet") {
        // Drop orphaned resolution context so field-entry triggers (e.g. cemetery
        // Sneer of Disdain) are not permanently deferred by a leftover resume queue.
        if (!next.pendingChoices) {
            next.resolutionContext = null;
        }
        next = (0, zones_1.moveCard)(next, handInstanceId, "field", player);
        (0, trigger_queue_1.queueOnCardPlayed)(next, handInstanceId, player);
    }
    next = (0, confirmation_1.runConfirmationTiming)(next);
    // After the last playable quick, close the window so the game cannot softlock
    // waiting for a pass the player may not realize is required.
    if (fromQuickWindow &&
        next.quickWindow !== null &&
        !next.pendingChoices &&
        next.pendingTriggers.length === 0 &&
        !hasPlayableQuickCards(next, player)) {
        if (next.quickWindow === "afterAttack") {
            next.quickWindow = null;
            next.quickWindowPlayer = null;
            if (next.combat) {
                next.combat = { ...next.combat, phase: "damage" };
                next = resolveCombat(next);
            }
        }
        else if (next.quickWindow === "endPhase") {
            next.endPhaseQuickResolved = true;
            next = continueEndPhaseFlow(next);
        }
    }
    return ok(next);
}
function attack(state, player, attackerId, targetId) {
    const activeErr = assertActivePlayer(state, player, "Not your turn");
    if (activeErr)
        return activeErr;
    const phaseErr = assertPhase(state, ["main"], "Cannot attack now");
    if (phaseErr)
        return phaseErr;
    if (state.combat?.phase === "quickWindow") {
        return fail(state, "Resolve quick window first");
    }
    const attackerFound = (0, queries_1.findInstance)(state, attackerId);
    if (!attackerFound || attackerFound.zone !== "field" || attackerFound.player !== player) {
        return fail(state, "Invalid attacker");
    }
    const attacker = attackerFound.card;
    if ((0, registry_1.getCardDef)(attacker.name)?.cardType !== "follower") {
        return fail(state, "Only followers can attack");
    }
    if (attacker.engaged)
        return fail(state, "Follower is engaged and cannot attack");
    const canAttack = attacker.onFieldSinceTurnStart ||
        attacker.evolvedThisTurn ||
        (0, queries_1.hasKeyword)(attacker, "storm", state) ||
        (0, queries_1.hasKeyword)(attacker, "rush", state);
    if (!canAttack)
        return fail(state, "Follower cannot attack");
    const legal = (0, queries_1.getLegalAttackTargets)(state, attacker, player);
    const isLegal = targetId === "leader"
        ? legal.some((t) => t.type === "leader")
        : legal.some((t) => t.type === "follower" && t.instanceId === targetId);
    if (!isLegal)
        return fail(state, "Illegal attack target");
    let next = structuredClone(state);
    const attackerOnNext = (0, queries_1.findInstance)(next, attackerId);
    if (!attackerOnNext)
        return fail(state, "Invalid attacker");
    attackerOnNext.card.engaged = true;
    next.combat = {
        attackerId,
        targetId,
        targetPlayer: (0, queries_1.opponentOf)(player),
        phase: "declared",
    };
    next.phase = "combat";
    next.eventLog.push({ type: "attack", player, data: { attackerId, targetId } });
    next = resolveCombat(next);
    return ok(next);
}
function resolveCombatDamage(state) {
    if (!state.combat)
        return state;
    let next = abortCombatIfAttackerGone(state);
    if (!next.combat)
        return next;
    next = structuredClone(next);
    const combat = next.combat;
    const attackerFound = (0, queries_1.findInstance)(next, combat.attackerId);
    if (!attackerFound || attackerFound.zone !== "field") {
        next.combat = null;
        next.phase = "main";
        next.quickWindow = null;
        next.quickWindowPlayer = null;
        return next;
    }
    const { atk: attackerAtk } = (0, queries_1.getEffectiveStats)(attackerFound.card, next);
    if (combat.targetId === "leader") {
        next.players[combat.targetPlayer].leaderDef -= attackerAtk;
        if ((0, queries_1.hasKeyword)(attackerFound.card, "drain", next)) {
            next.players[attackerFound.player].leaderDef += attackerAtk;
        }
    }
    else {
        const targetFound = (0, queries_1.findInstance)(next, combat.targetId);
        if (targetFound && targetFound.zone === "field") {
            const targetStats = (0, queries_1.getEffectiveStats)(targetFound.card, next);
            if (targetStats.hasCombatStats && targetStats.def > 0) {
                const { atk: targetAtk } = targetStats;
                const dmgToTarget = (0, queries_1.clampDamageToFollower)(next, targetFound.card, targetFound.player, attackerAtk);
                targetFound.card.modifiers.push({ def: -dmgToTarget, sourceId: combat.attackerId });
                attackerFound.card.modifiers.push({ def: -targetAtk, sourceId: combat.targetId });
                if ((0, queries_1.hasKeyword)(attackerFound.card, "drain", next)) {
                    next.players[attackerFound.player].leaderDef += attackerAtk;
                }
                if ((0, queries_1.hasKeyword)(attackerFound.card, "bane", next, attackerFound.player) ||
                    (0, queries_1.hasKeyword)(targetFound.card, "bane", next, targetFound.player)) {
                    attackerFound.card.foughtWithBane = true;
                    targetFound.card.foughtWithBane = true;
                    attackerFound.card.foughtWithInstanceId = targetFound.card.instanceId;
                    targetFound.card.foughtWithInstanceId = attackerFound.card.instanceId;
                }
            }
        }
    }
    next.combat = null;
    next.phase = "main";
    next.quickWindow = null;
    next.quickWindowPlayer = null;
    return (0, confirmation_1.runConfirmationTiming)(next);
}
function resolveCombat(state) {
    if (!state.combat)
        return state;
    let next = abortCombatIfAttackerGone(state);
    if (!next.combat)
        return next;
    next = structuredClone(next);
    const combat = next.combat;
    if (combat.phase === "quickWindow") {
        return next;
    }
    if (combat.phase === "damage") {
        return resolveCombatDamage(next);
    }
    const attackerFound = (0, queries_1.findInstance)(next, combat.attackerId);
    if (!attackerFound || attackerFound.zone !== "field") {
        next.combat = null;
        next.phase = "main";
        next.quickWindow = null;
        next.quickWindowPlayer = null;
        return next;
    }
    // Strike resolves before quick window and combat damage (Comprehensive Rules §11).
    const strikeAbilities = (0, queries_1.getStrikeAbilities)(next, attackerFound.card);
    const strikeStart = combat.strikeAbilityIndex ?? 0;
    for (let i = strikeStart; i < strikeAbilities.length; i++) {
        const { ability, key } = strikeAbilities[i];
        next.resolutionContext = { sourceInstanceId: combat.attackerId, effectStack: [ability.effect] };
        if (ability.unionBurst) {
            next = (0, union_burst_1.beginUnionBurstActivation)(next, attackerFound.player, combat.attackerId, ability);
        }
        const hostAtStart = (0, queries_1.findInstance)(next, combat.attackerId);
        if (hostAtStart && ability.oncePerTurn && !hostAtStart.card.abilitiesActivatedThisTurn.includes(key)) {
            hostAtStart.card.abilitiesActivatedThisTurn.push(key);
        }
        next = (0, resolver_1.resolveEffect)(next, ability.effect, attackerFound.player, {
            deferConfirmation: true,
        });
        next = (0, confirmation_1.runConfirmationTiming)(next);
        if (next.pendingChoices ||
            next.pendingTriggers.length > 0 ||
            (next.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0) {
            next.combat = { ...combat, strikeAbilityIndex: i };
            next.phase = "main";
            next.quickWindow = null;
            next.quickWindowPlayer = null;
            return next;
        }
        next.resolutionContext = null;
        next = abortCombatIfAttackerGone(next);
        if (!next.combat)
            return next;
    }
    if (!isCombatAttackerOnField(next)) {
        next.combat = null;
        next.phase = "main";
        next.quickWindow = null;
        next.quickWindowPlayer = null;
        return next;
    }
    const attackerAfterStrike = (0, queries_1.findInstance)(next, combat.attackerId);
    if (!attackerAfterStrike || attackerAfterStrike.zone !== "field") {
        next.combat = null;
        next.phase = "main";
        next.quickWindow = null;
        next.quickWindowPlayer = null;
        return next;
    }
    const defender = (0, queries_1.opponentOf)(attackerAfterStrike.player);
    if (hasPlayableQuickCards(next, defender)) {
        next.combat = { ...combat, phase: "quickWindow", strikeAbilityIndex: undefined };
        next.quickWindow = "afterAttack";
        next.quickWindowPlayer = defender;
        next.phase = "main";
        return next;
    }
    next.combat = { ...combat, phase: "damage", strikeAbilityIndex: undefined };
    return resolveCombat(next);
}
function evolve(state, player, fieldInstanceId, evolveDeckInstanceId, useSuperEvo, useEvoPoint) {
    const activeErr = assertActivePlayer(state, player, "Not your turn");
    if (activeErr)
        return activeErr;
    if (!(0, queries_1.canEvolveFollower)(state, player, fieldInstanceId)) {
        return fail(state, "Cannot evolve this follower");
    }
    const fieldFound = (0, queries_1.findInstance)(state, fieldInstanceId);
    if (!fieldFound || fieldFound.zone !== "field")
        return fail(state, "Invalid field card");
    if (fieldFound.card.linkedEvoInstanceId)
        return fail(state, "Already evolved");
    const evoCard = (evolveDeckInstanceId
        ? (0, queries_1.findInstance)(state, evolveDeckInstanceId)?.card
        : null) ?? (0, queries_1.findMatchingEvolveCard)(state, player, fieldInstanceId);
    if (!evoCard)
        return fail(state, "Invalid evolve card");
    const evoFound = (0, queries_1.findInstance)(state, evoCard.instanceId);
    if (!evoFound || evoFound.zone !== "evolveDeck")
        return fail(state, "Invalid evolve card");
    if (evoFound.card.evolveUsed)
        return fail(state, "Evolve card already used");
    const evolveDeckInstanceIdResolved = evoCard.instanceId;
    if (!(0, queries_1.evolveCardsMatch)(fieldFound.card.name, evoFound.card.name)) {
        return fail(state, "Cards do not match");
    }
    const cost = (0, queries_1.getEffectiveEvolveCost)(state, player, fieldFound.card);
    if (cost == null)
        return fail(state, "Cannot evolve this follower");
    let next = structuredClone(state);
    const p = next.players[player];
    const payment = (0, queries_1.computeEvolvePayment)(cost, p.pp, p.evoPoints, Boolean(useEvoPoint));
    if (!payment.ok)
        return fail(state, "Cannot pay evolve cost");
    p.evoPoints -= payment.epCost;
    p.pp -= payment.ppCost;
    next = (0, zones_1.moveCard)(next, evolveDeckInstanceIdResolved, "resolutionZone", player);
    const fieldOnNext = (0, queries_1.findInstance)(next, fieldInstanceId);
    if (!fieldOnNext || fieldOnNext.zone !== "field")
        return fail(state, "Invalid field card");
    fieldOnNext.card.linkedEvoInstanceId = evolveDeckInstanceIdResolved;
    fieldOnNext.card.evolvedThisTurn = true;
    // Keep onFieldSinceTurnStart so a follower that could already attack the
    // leader still can after evolving; evolvedThisTurn grants Rush for followers.
    if (useSuperEvo && next.players[player].superEvoPoints > 0) {
        const threshold = player === next.firstPlayer ? 7 : 6;
        if (next.players[player].turnsPassed >= threshold) {
            next.players[player].superEvoPoints -= 1;
            fieldOnNext.card.superEvolved = true;
            fieldOnNext.card.modifiers.push({ atk: 1, def: 1, sourceId: "superEvo" });
        }
    }
    next.players[player].flags.evolvedThisTurn = true;
    next.players[player].zones.evolveZone.push({
        fieldInstanceId,
        evolveInstanceId: evolveDeckInstanceIdResolved,
    });
    (0, trigger_queue_1.queueOnEvolveAbilities)(next, fieldInstanceId, player, Boolean(fieldOnNext.card.superEvolved));
    next = (0, confirmation_1.runConfirmationTiming)(next);
    return ok(next);
}
function finishActivateAfterCost(state, player, sourceInstanceId, zone, abilityKey) {
    let next = structuredClone(state);
    // Prefer the live field/hand/etc. copy; if burySelf already removed it, fall back to
    // the pre-clone state or any zone so we can still resolve the activated ability.
    const sourceOnNext = (0, queries_1.findInstance)(next, sourceInstanceId) ?? (0, queries_1.findInstance)(state, sourceInstanceId);
    let ability = undefined;
    const equipMatch = /^equipActivated:([^:]+):(\d+)$/.exec(abilityKey);
    if (equipMatch) {
        const eqFound = (0, queries_1.findInstance)(next, equipMatch[1]);
        const eqDef = eqFound ? (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(next, eqFound.card)) : undefined;
        ability = eqDef?.abilities?.[Number(equipMatch[2])];
    }
    else {
        const def = sourceOnNext ? (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(next, sourceOnNext.card)) : undefined;
        ability = def?.abilities
            ?.map((a, idx) => ({ ability: a, key: `activated:${idx}` }))
            .find((entry) => entry.key === abilityKey)?.ability;
    }
    if (!ability)
        return next;
    const liveSource = (0, queries_1.findInstance)(next, sourceInstanceId);
    if (liveSource) {
        if (zone === "field" && ability.cost?.engage) {
            liveSource.card.engaged = true;
        }
        if (ability.oncePerTurn && !liveSource.card.abilitiesActivatedThisTurn.includes(abilityKey)) {
            liveSource.card.abilitiesActivatedThisTurn.push(abilityKey);
        }
        if (ability.maxPerTurn != null) {
            liveSource.card.counters[abilityKey] = (liveSource.card.counters[abilityKey] ?? 0) + 1;
        }
    }
    if (ability.cost?.burySelf) {
        const src = (0, queries_1.findInstance)(next, sourceInstanceId);
        if (src?.zone === "field") {
            (0, trigger_queue_1.queueLastWords)(next, sourceInstanceId, player);
            next = (0, zones_1.destroyFollower)(next, sourceInstanceId);
        }
    }
    next.resolutionContext = {
        sourceInstanceId,
        effectStack: [ability.effect],
    };
    if (ability.unionBurst) {
        next = (0, union_burst_1.beginUnionBurstActivation)(next, player, sourceInstanceId, ability);
    }
    next = (0, resolver_1.resolveEffect)(next, ability.effect, player);
    if (ability.cost?.fuse) {
        (0, trigger_queue_1.queueOnCardFused)(next, sourceInstanceId, player);
    }
    if ((0, effect_utils_1.shouldClearResolutionContext)(next)) {
        next = (0, union_burst_1.flushPendingUnionBurst)(next);
        next.resolutionContext = null;
    }
    return next;
}
function resolveActivate(state, player, sourceInstanceId, zone, useEvoPoint, abilityKey) {
    const found = (0, queries_1.findInstance)(state, sourceInstanceId);
    if (!found || found.zone !== zone || found.player !== player) {
        return fail(state, "Invalid card");
    }
    const activated = (0, queries_1.getActivatedAbilities)(state, found.card, player, zone);
    if (activated.length === 0)
        return fail(state, "No activated ability");
    const selected = abilityKey
        ? activated.find((entry) => entry.key === abilityKey)
        : activated.length === 1
            ? activated[0]
            : undefined;
    if (!selected) {
        return fail(state, abilityKey ? "Invalid activated ability" : "Choose which ability to activate");
    }
    if (zone === "field" && found.card.engaged && selected.ability.cost?.engage) {
        return fail(state, "Follower is engaged and cannot pay engage cost");
    }
    let next = structuredClone(state);
    const p = next.players[player];
    const { ability, key } = selected;
    const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(next, found.card));
    const advance = (0, effect_utils_1.isAdvanceAbility)(def, ability);
    if (advance && p.flags.evolvedThisTurn) {
        return fail(state, "Already evolved or advanced this turn");
    }
    if (advance && !(0, effect_utils_1.canAdvanceActivate)(next, player, ability.effect)) {
        return fail(state, "Advance conditions not met");
    }
    const activateCost = ability.cost?.pp ?? 0;
    const payment = (0, queries_1.computeEvolvePayment)(activateCost, p.pp, p.evoPoints, Boolean(useEvoPoint));
    if (!payment.ok)
        return fail(state, "Cannot pay activate cost");
    p.evoPoints -= payment.epCost;
    p.pp -= payment.ppCost;
    if (advance) {
        p.flags.evolvedThisTurn = true;
    }
    if (ability.cost?.banishFromCemetery) {
        const filter = ability.cost.banishFromCemetery;
        const count = ability.cost.banishCount ?? 1;
        const matches = p.zones.cemetery.filter((c) => (0, conditions_1.cardMatchesFilter)(c.name, filter));
        if (matches.length < count)
            return fail(state, "Cannot pay activate cost");
        if (matches.length >= count) {
            next.pendingChoices = {
                type: "selectZoneCards",
                player,
                fromZone: "cemetery",
                count,
                action: "banish",
                options: matches.map((c) => ({
                    instanceId: c.instanceId,
                    name: c.name,
                    label: (0, registry_1.getCardDef)(c.name)?.name || c.name,
                })),
                resumeActivate: { sourceInstanceId, zone, abilityKey: key },
            };
            return ok(next);
        }
        for (let i = 0; i < count; i++) {
            const idx = p.zones.cemetery.findIndex((c) => (0, conditions_1.cardMatchesFilter)(c.name, filter));
            if (idx < 0)
                return fail(state, "Cannot pay activate cost");
            const [card] = p.zones.cemetery.splice(idx, 1);
            (0, card_reset_1.resetCardInstanceState)(card);
            (0, tokens_1.placeLeavingPlay)(p.zones, card, "banish");
        }
    }
    if (ability.cost?.banishFromExArea) {
        const filter = ability.cost.banishFromExArea;
        const total = ability.cost.banishCount ?? 1;
        const matches = p.zones.exArea.filter((c) => (0, conditions_1.cardMatchesFilter)(c.name, filter));
        if (matches.length < total)
            return fail(state, "Cannot pay activate cost");
        const sourceInEx = matches.some((c) => c.instanceId === sourceInstanceId);
        const needFromEx = sourceInEx ? total - 1 : total;
        const pool = sourceInEx
            ? matches.filter((c) => c.instanceId !== sourceInstanceId)
            : matches;
        if (needFromEx > 0 && pool.length >= needFromEx) {
            next.pendingChoices = {
                type: "selectZoneCards",
                player,
                fromZone: "exArea",
                count: needFromEx,
                action: "banish",
                options: pool.map((c) => ({
                    instanceId: c.instanceId,
                    name: c.name,
                    label: (0, registry_1.getCardDef)(c.name)?.name || c.name,
                })),
                resumeActivate: { sourceInstanceId, zone, abilityKey: key },
            };
            return ok(next);
        }
        const toBanish = sourceInEx
            ? [sourceInstanceId, ...pool.slice(0, needFromEx).map((c) => c.instanceId)]
            : pool.slice(0, needFromEx).map((c) => c.instanceId);
        for (const id of toBanish) {
            const idx = p.zones.exArea.findIndex((c) => c.instanceId === id);
            if (idx < 0)
                return fail(state, "Cannot pay activate cost");
            const [card] = p.zones.exArea.splice(idx, 1);
            (0, card_reset_1.resetCardInstanceState)(card);
            (0, tokens_1.placeLeavingPlay)(p.zones, card, "banish");
        }
    }
    if (ability.cost?.buryFromField) {
        const filter = ability.cost.buryFromField;
        const count = ability.cost.buryFieldCount ?? 1;
        const matches = p.zones.field.filter((c) => {
            if (ability.cost?.excludeSelfFromBury && c.instanceId === sourceInstanceId)
                return false;
            return (0, conditions_1.cardMatchesFilter)(c.name, filter);
        });
        if (matches.length < count)
            return fail(state, "Cannot pay activate cost");
        if (matches.length >= count) {
            next.pendingChoices = {
                type: "selectZoneCards",
                player,
                fromZone: "field",
                count,
                action: "bury",
                options: matches.map((c) => ({
                    instanceId: c.instanceId,
                    name: c.name,
                    label: (0, registry_1.getCardDef)(c.name)?.name || c.name,
                })),
                resumeActivate: { sourceInstanceId, zone, abilityKey: key },
            };
            return ok(next);
        }
    }
    if (ability.cost?.engageFromField) {
        const filter = ability.cost.engageFromField;
        const count = ability.cost.engageFieldCount ?? 1;
        const matches = p.zones.field.filter((c) => {
            if (c.engaged)
                return false;
            if (ability.cost?.excludeSelfFromEngage && c.instanceId === sourceInstanceId)
                return false;
            return (0, conditions_1.cardMatchesFilter)(c.name, filter);
        });
        if (matches.length < count)
            return fail(state, "Cannot pay activate cost");
        if (matches.length >= count) {
            next.pendingChoices = {
                type: "selectZoneCards",
                player,
                fromZone: "field",
                count,
                action: "engage",
                options: matches.map((c) => ({
                    instanceId: c.instanceId,
                    name: c.name,
                    label: (0, registry_1.getCardDef)(c.name)?.name || c.name,
                })),
                resumeActivate: { sourceInstanceId, zone, abilityKey: key },
            };
            return ok(next);
        }
    }
    if (ability.cost?.fuse) {
        const filter = ability.cost.fuse.filter;
        const count = ability.cost.fuse.count ?? 1;
        const excludeSelf = ability.cost.fuse.excludeSelf !== false;
        const matches = [];
        for (const c of p.zones.hand) {
            if (excludeSelf && c.instanceId === sourceInstanceId)
                continue;
            if (!(0, conditions_1.cardMatchesFilter)(c.name, filter))
                continue;
            const base = (0, registry_1.getCardDef)(c.name)?.name || c.name;
            matches.push({ instanceId: c.instanceId, name: c.name, label: `${base} (Hand)` });
        }
        for (const c of p.zones.exArea) {
            if (excludeSelf && c.instanceId === sourceInstanceId)
                continue;
            if (!(0, conditions_1.cardMatchesFilter)(c.name, filter))
                continue;
            const base = (0, registry_1.getCardDef)(c.name)?.name || c.name;
            matches.push({ instanceId: c.instanceId, name: c.name, label: `${base} (EX)` });
        }
        if (matches.length < count)
            return fail(state, "Cannot pay fuse cost");
        next.pendingChoices = {
            type: "selectZoneCards",
            player,
            fromZone: "hand",
            count,
            action: "fuse",
            options: matches,
            resumeActivate: { sourceInstanceId, zone, abilityKey: key },
        };
        return ok(next);
    }
    if (ability.cost?.removePersistentCounter) {
        const { key: counterKey, amount = 1 } = ability.cost.removePersistentCounter;
        const live = (0, queries_1.findInstance)(next, sourceInstanceId);
        if (!live)
            return fail(state, "Invalid card");
        const have = live.card.persistentCounters?.[counterKey] ?? 0;
        if (have < amount)
            return fail(state, "Not enough counters");
        if (!live.card.persistentCounters)
            live.card.persistentCounters = {};
        live.card.persistentCounters[counterKey] = have - amount;
    }
    next = finishActivateAfterCost(next, player, sourceInstanceId, zone, key);
    next = (0, confirmation_1.runConfirmationTiming)(next);
    return ok(next);
}
function applyAction(state, player, action) {
    return (0, actionLog_1.appendActionLog)(state, player, action, applyActionUnlogged(state, player, action));
}
function applyActionUnlogged(state, player, action) {
    if (state.phase === "gameOver")
        return fail(state, "Game is over");
    let workingState = (0, reveal_1.clearRevealedCards)(state);
    if (workingState.pendingChoices &&
        action.type !== "CHOICE_RESPONSE" &&
        action.type !== "MULLIGAN") {
        return fail(workingState, "Must resolve pending choice first");
    }
    switch (action.type) {
        case "MULLIGAN":
            if (workingState.phase !== "mulligan")
                return fail(workingState, "Not mulligan phase");
            return ok((0, setup_1.applyMulligan)(workingState, player, action.redraw));
        case "CHOICE_RESPONSE":
            return handleChoiceResponse(workingState, player, action.payload);
        case "PLAY_CARD":
            return playCard(workingState, player, action.handInstanceId, action.targets);
        case "QUICK_PLAY":
            if (state.quickWindow === null)
                return fail(state, "No quick window");
            return playCard(state, player, action.handInstanceId, action.targets, true);
        case "PASS_QUICK_WINDOW": {
            if (state.quickWindow === null)
                return fail(state, "No quick window");
            if (state.quickWindowPlayer !== player)
                return fail(state, "Not your quick window");
            if (state.quickWindow === "afterAttack") {
                let next = structuredClone(state);
                next.quickWindow = null;
                next.quickWindowPlayer = null;
                if (next.combat) {
                    next.combat = { ...next.combat, phase: "damage" };
                    next = resolveCombat(next);
                }
                return ok(next);
            }
            if (state.quickWindow === "endPhase") {
                let next = structuredClone(state);
                next.endPhaseQuickResolved = true;
                next = continueEndPhaseFlow(next);
                return ok(next);
            }
            return fail(state, "Unknown quick window");
        }
        case "ATTACK":
            return attack(state, player, action.attackerId, action.targetId);
        case "EVOLVE":
            return evolve(state, player, action.fieldInstanceId, action.evolveDeckInstanceId, action.useSuperEvo, action.useEvoPoint);
        case "END_MAIN": {
            const activeErr = assertActivePlayer(state, player, "Not your turn");
            if (activeErr)
                return activeErr;
            if (state.quickWindow === "endPhase") {
                return fail(state, "Opponent must resolve quick window first");
            }
            if (state.combat?.phase === "quickWindow") {
                return fail(state, "Resolve quick window first");
            }
            if (state.combat?.phase === "declared") {
                return ok(resolveCombat(state));
            }
            let next = structuredClone(state);
            next.phase = "end";
            next.endPhaseQuickResolved = false;
            next = continueEndPhaseFlow(next);
            return ok(next);
        }
        case "ACTIVATE": {
            const activeErr = assertActivePlayer(state, player, "Not your turn");
            if (activeErr)
                return activeErr;
            const phaseErr = assertPhase(state, ["main"], "Cannot activate now");
            if (phaseErr)
                return phaseErr;
            return resolveActivate(state, player, action.fieldInstanceId, "field", action.useEvoPoint, action.abilityKey);
        }
        case "ACTIVATE_CEMETERY": {
            const activeErr = assertActivePlayer(state, player, "Not your turn");
            if (activeErr)
                return activeErr;
            const phaseErr = assertPhase(state, ["main"], "Cannot activate now");
            if (phaseErr)
                return phaseErr;
            return resolveActivate(state, player, action.cemeteryInstanceId, "cemetery", undefined, action.abilityKey);
        }
        case "ACTIVATE_EXAREA": {
            const activeErr = assertActivePlayer(state, player, "Not your turn");
            if (activeErr)
                return activeErr;
            const phaseErr = assertPhase(state, ["main"], "Cannot activate now");
            if (phaseErr)
                return phaseErr;
            return resolveActivate(state, player, action.exAreaInstanceId, "exArea", undefined, action.abilityKey);
        }
        case "ACTIVATE_HAND": {
            const activeErr = assertActivePlayer(state, player, "Not your turn");
            if (activeErr)
                return activeErr;
            const phaseErr = assertPhase(state, ["main"], "Cannot activate now");
            if (phaseErr)
                return phaseErr;
            return resolveActivate(state, player, action.handInstanceId, "hand", action.useEvoPoint, action.abilityKey);
        }
        case "CONCEDE": {
            const next = structuredClone(state);
            next.winner = (0, queries_1.opponentOf)(player);
            next.phase = "gameOver";
            return ok(next);
        }
        case "DEBUG_ADJUST_PP": {
            if (!state.testingMode)
                return fail(state, "Testing mode only");
            const next = structuredClone(state);
            const p = next.players[player];
            const delta = Number(action.delta) || 0;
            p.pp = Math.max(0, p.pp + delta);
            if (p.pp > p.maxPp)
                p.maxPp = p.pp;
            return ok(next);
        }
        case "DEBUG_ADJUST_LIFE": {
            if (!state.testingMode)
                return fail(state, "Testing mode only");
            const next = structuredClone(state);
            const p = next.players[player];
            const delta = Number(action.delta) || 0;
            p.leaderDef = Math.max(0, p.leaderDef + delta);
            return ok(next);
        }
        case "DEBUG_TUTOR_FROM_DECK": {
            if (!state.testingMode)
                return fail(state, "Testing mode only");
            const instanceId = String(action.instanceId || "");
            if (!instanceId)
                return fail(state, "No card selected");
            const found = (0, queries_1.findInstance)(state, instanceId);
            if (!found || found.zone !== "deck" || found.player !== player) {
                return fail(state, "Card not in your deck");
            }
            return ok((0, resolver_1.moveZoneCardTo)(state, player, instanceId, "deck", "hand"));
        }
        default:
            return fail(state, "Unknown action");
    }
}
function advanceCombatIfNeeded(state) {
    return state;
}
