"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUnionBurstActivated = recordUnionBurstActivated;
const actionLog_1 = require("../actions/actionLog");
const trigger_queue_1 = require("./trigger-queue");
/** Record that a Union Burst ability resolved and queue cross-card triggers. */
function recordUnionBurstActivated(state, player, sourceInstanceId, ability) {
    if (!ability?.unionBurst)
        return state;
    const next = state;
    const count = (next.players[player].flags.unionBurstsActivatedThisTurn ?? 0) + 1;
    next.players[player].flags.unionBurstsActivatedThisTurn = count;
    (0, trigger_queue_1.queueOnUnionBurstActivated)(next, sourceInstanceId, player);
    (0, actionLog_1.appendUnionBurstLogEntry)(next, player, sourceInstanceId, count);
    return next;
}
