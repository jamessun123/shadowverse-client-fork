"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUnionBurstActivated = recordUnionBurstActivated;
exports.beginUnionBurstActivation = beginUnionBurstActivation;
exports.commitPendingUnionBurst = commitPendingUnionBurst;
exports.cancelPendingUnionBurst = cancelPendingUnionBurst;
exports.scheduleOrRecordUnionBurstActivated = scheduleOrRecordUnionBurstActivated;
exports.flushPendingUnionBurst = flushPendingUnionBurst;
exports.markResolvingUnionBurst = markResolvingUnionBurst;
const actionLog_1 = require("../actions/actionLog");
const trigger_queue_1 = require("./trigger-queue");
/** Record that a Union Burst ability resolved and queue cross-card triggers. */
function recordUnionBurstActivated(state, player, sourceInstanceId, ability) {
    if (!ability?.unionBurst)
        return state;
    const next = state;
    const flags = next.players[player].flags;
    const ids = flags.unionBurstSourceIdsThisTurn ?? [];
    ids.push(sourceInstanceId);
    flags.unionBurstSourceIdsThisTurn = ids;
    const count = ids.length;
    flags.unionBurstsActivatedThisTurn = count;
    (0, trigger_queue_1.queueOnUnionBurstActivated)(next, sourceInstanceId, player);
    (0, actionLog_1.appendUnionBurstLogEntry)(next, player, sourceInstanceId, count);
    return next;
}
function stashPendingUnionBurst(state, player, sourceInstanceId, ability) {
    const next = markResolvingUnionBurst(state, sourceInstanceId);
    if (!next.resolutionContext) {
        next.resolutionContext = { effectStack: [ability.effect] };
    }
    next.resolutionContext.pendingUnionBurst = { player, sourceInstanceId, ability };
    next.resolutionContext.resolvingUnionBurstSourceId = sourceInstanceId;
    return next;
}
/**
 * Start a Union Burst. Optional-cost UBs (Karyl / Christina) are stashed until
 * the player actually pays; skipping must not count as an activation.
 */
function beginUnionBurstActivation(state, player, sourceInstanceId, ability) {
    if (!ability?.unionBurst)
        return state;
    if (ability.effect.op === "optionalCost") {
        return stashPendingUnionBurst(state, player, sourceInstanceId, ability);
    }
    const next = markResolvingUnionBurst(state, sourceInstanceId);
    return recordUnionBurstActivated(next, player, sourceInstanceId, ability);
}
/** Record a stashed optional-cost Union Burst once the player pays. */
function commitPendingUnionBurst(state) {
    const pending = state.resolutionContext?.pendingUnionBurst;
    if (!pending)
        return state;
    const next = recordUnionBurstActivated(state, pending.player, pending.sourceInstanceId, pending.ability);
    if (next.resolutionContext) {
        delete next.resolutionContext.pendingUnionBurst;
    }
    return next;
}
/** Drop a stashed Union Burst when the player skips or cannot pay. */
function cancelPendingUnionBurst(state) {
    const next = state;
    if (next.resolutionContext) {
        delete next.resolutionContext.pendingUnionBurst;
        delete next.resolutionContext.resolvingUnionBurstSourceId;
    }
    return next;
}
function abilityStillResolving(state) {
    if (state.pendingChoices)
        return true;
    return (state.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0;
}
/**
 * Record a Union Burst only once its effect has fully finished.
 * If the ability paused on a target/choose prompt, stash it on the resolution
 * context so mid-ability checks (e.g. Eris / Ameth "2 other UBs") do not count
 * the current activation.
 */
function scheduleOrRecordUnionBurstActivated(state, player, sourceInstanceId, ability) {
    if (!ability?.unionBurst)
        return state;
    if (abilityStillResolving(state)) {
        const next = state;
        if (!next.resolutionContext) {
            next.resolutionContext = { effectStack: [ability.effect] };
        }
        next.resolutionContext.pendingUnionBurst = { player, sourceInstanceId, ability };
        next.resolutionContext.resolvingUnionBurstSourceId = sourceInstanceId;
        return next;
    }
    return recordUnionBurstActivated(state, player, sourceInstanceId, ability);
}
/** Flush a stashed Union Burst once choices/resume work are done. */
function flushPendingUnionBurst(state) {
    const pending = state.resolutionContext?.pendingUnionBurst;
    if (!pending || abilityStillResolving(state))
        return state;
    const next = recordUnionBurstActivated(state, pending.player, pending.sourceInstanceId, pending.ability);
    if (next.resolutionContext) {
        delete next.resolutionContext.pendingUnionBurst;
        delete next.resolutionContext.resolvingUnionBurstSourceId;
    }
    return next;
}
/** Mark that a Union Burst from this source is currently resolving. */
function markResolvingUnionBurst(state, sourceInstanceId) {
    const next = state;
    if (!next.resolutionContext) {
        next.resolutionContext = { effectStack: [] };
    }
    next.resolutionContext.resolvingUnionBurstSourceId = sourceInstanceId;
    return next;
}
