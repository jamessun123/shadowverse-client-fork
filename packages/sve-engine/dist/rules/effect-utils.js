"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectContainsOp = effectContainsOp;
exports.isAdvanceAbility = isAdvanceAbility;
exports.canAdvanceActivate = canAdvanceActivate;
exports.shouldDeferTriggers = shouldDeferTriggers;
exports.finishDeferredTriggers = finishDeferredTriggers;
exports.shouldClearResolutionContext = shouldClearResolutionContext;
exports.contextForTriggerResolution = contextForTriggerResolution;
exports.getChoiceContext = getChoiceContext;
exports.withChoiceContext = withChoiceContext;
exports.chooseTrackKeys = chooseTrackKeys;
exports.getChosenChooseIndices = getChosenChooseIndices;
exports.getChosenChooseLabels = getChosenChooseLabels;
exports.recordChosenChooseOption = recordChosenChooseOption;
const registry_1 = require("../cards/registry");
const conditions_1 = require("../state/conditions");
const queries_1 = require("../state/queries");
function effectContainsOp(effect, op) {
    if (effect.op === op)
        return true;
    if (effect.op === "sequence") {
        return effect.steps.some((step) => effectContainsOp(step, op));
    }
    if (effect.op === "if") {
        return (effectContainsOp(effect.then, op) ||
            (effect.else != null && effectContainsOp(effect.else, op)));
    }
    if (effect.op === "optionalCost") {
        return effectContainsOp(effect.cost, op) || effectContainsOp(effect.then, op);
    }
    return false;
}
function isAdvanceAbility(def, ability) {
    if (!def?.keywords?.includes("advanced"))
        return false;
    return effectContainsOp(ability.effect, "summonFromEvolveDeck");
}
/** Advance activated effects gate on nested if/else deck or cemetery conditions. */
function canAdvanceActivate(state, player, effect) {
    if (effect.op !== "if")
        return true;
    if ((0, conditions_1.evalCondition)(state, player, effect.condition))
        return true;
    if (effect.else?.op === "if" && (0, conditions_1.evalCondition)(state, player, effect.else.condition))
        return true;
    return false;
}
function shouldDeferTriggers(state) {
    // Only defer while a player choice is open. An orphaned resumeAfterChoice
    // queue (resume left behind with no pendingChoices) must not permanently
    // softlock pending triggers such as cemetery onAllyFollowerEnter (Sneer).
    // Resume is drained by continueAfterChoice before confirmation on the choice
    // path; runConfirmationTiming already returns early when pendingChoices is set.
    if (state.pendingChoices && state.pendingChoices.type !== "mulligan")
        return true;
    return false;
}
function finishDeferredTriggers(state) {
    if (!state.resolutionContext?.deferTriggers)
        return state;
    if (state.pendingChoices)
        return state;
    if ((state.resolutionContext.resumeAfterChoice?.length ?? 0) > 0)
        return state;
    const next = structuredClone(state);
    next.resolutionContext = { ...next.resolutionContext, deferTriggers: false };
    return next;
}
function shouldClearResolutionContext(state) {
    if (state.pendingChoices)
        return false;
    if ((state.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0)
        return false;
    if (state.resolutionContext?.deferTriggers)
        return false;
    return true;
}
function contextForTriggerResolution(state, sourceInstanceId, effect) {
    const prev = state.resolutionContext;
    return {
        sourceInstanceId,
        resumeOwnerInstanceId: prev?.resumeOwnerInstanceId ?? prev?.sourceInstanceId,
        effectStack: [effect],
        resumeAfterChoice: prev?.resumeAfterChoice,
        deferTriggers: prev?.deferTriggers,
        buriedCosts: prev?.buriedCosts,
        lastDiscardedCardName: prev?.lastDiscardedCardName,
        lastSelectedCardName: prev?.lastSelectedCardName,
        engagedAsCostCount: prev?.engagedAsCostCount,
        pendingUnionBurst: prev?.pendingUnionBurst,
        resolvingUnionBurstSourceId: prev?.resolvingUnionBurstSourceId,
    };
}
function getChoiceContext(state) {
    const sourceId = state.resolutionContext?.sourceInstanceId;
    if (!sourceId)
        return {};
    const found = (0, queries_1.findInstance)(state, sourceId);
    if (!found)
        return {};
    const cardNo = (0, queries_1.resolveCardNo)(state, found.card);
    const def = (0, registry_1.getCardDef)(cardNo);
    return {
        sourceCardNo: cardNo,
        sourceLabel: def?.name ?? cardNo,
    };
}
function withChoiceContext(state, choice) {
    const ctx = getChoiceContext(state);
    if (!ctx.sourceLabel)
        return choice;
    return { ...choice, ...ctx };
}
/** Track keys for excludeChosenThisTurn: global + per-source. */
function chooseTrackKeys(trackKey, sourceInstanceId) {
    const keys = [trackKey];
    if (sourceInstanceId)
        keys.push(`${trackKey}@${sourceInstanceId}`);
    return keys;
}
function getChosenChooseIndices(state, player, trackKey, sourceCard, sourceInstanceId) {
    const out = new Set();
    const flags = state.players[player].flags;
    for (const key of chooseTrackKeys(trackKey, sourceInstanceId)) {
        for (const i of sourceCard?.chosenChooseOptionsThisTurn?.[key] ?? [])
            out.add(i);
        for (const i of flags.chosenChooseOptionTracksThisTurn?.[key] ?? [])
            out.add(i);
    }
    return out;
}
function getChosenChooseLabels(state, player, trackKey, sourceCard, sourceInstanceId) {
    const out = new Set();
    const flags = state.players[player].flags;
    for (const key of chooseTrackKeys(trackKey, sourceInstanceId)) {
        for (const label of sourceCard?.chosenChooseOptionLabelsThisTurn?.[key] ?? []) {
            out.add(label);
        }
        for (const label of flags.chosenChooseOptionLabelsThisTurn?.[key] ?? []) {
            out.add(label);
        }
    }
    return out;
}
function pushUnique(list, value) {
    if (!list)
        return [value];
    return list.includes(value) ? list : [...list, value];
}
/** Record a chosen mode on the source card and player for the rest of the turn. */
function recordChosenChooseOption(state, player, trackKey, optionIndex, optionLabel, sourceInstanceId) {
    const keys = chooseTrackKeys(trackKey, sourceInstanceId);
    const flags = state.players[player].flags;
    if (!flags.chosenChooseOptionTracksThisTurn)
        flags.chosenChooseOptionTracksThisTurn = {};
    if (!flags.chosenChooseOptionLabelsThisTurn)
        flags.chosenChooseOptionLabelsThisTurn = {};
    const source = sourceInstanceId ? (0, queries_1.findInstance)(state, sourceInstanceId) : null;
    if (source) {
        if (!source.card.chosenChooseOptionsThisTurn)
            source.card.chosenChooseOptionsThisTurn = {};
        if (!source.card.chosenChooseOptionLabelsThisTurn) {
            source.card.chosenChooseOptionLabelsThisTurn = {};
        }
    }
    for (const key of keys) {
        flags.chosenChooseOptionTracksThisTurn[key] = pushUnique(flags.chosenChooseOptionTracksThisTurn[key], optionIndex);
        flags.chosenChooseOptionLabelsThisTurn[key] = pushUnique(flags.chosenChooseOptionLabelsThisTurn[key], optionLabel);
        if (source) {
            source.card.chosenChooseOptionsThisTurn[key] = pushUnique(source.card.chosenChooseOptionsThisTurn[key], optionIndex);
            source.card.chosenChooseOptionLabelsThisTurn[key] = pushUnique(source.card.chosenChooseOptionLabelsThisTurn[key], optionLabel);
        }
    }
}
