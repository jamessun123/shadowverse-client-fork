import { findInstance } from "../state/queries";
import {
  ActionLogEntry,
  ActionResult,
  GameAction,
  GameState,
  PlayerId,
} from "../types";

function cardName(state: GameState, instanceId: string | undefined): string | undefined {
  if (!instanceId) return undefined;
  const found = findInstance(state, instanceId);
  if (!found) return undefined;
  return found.card.name.replace(/\s+TOKEN$/i, "");
}

function targetLabel(state: GameState, targetId: string | undefined): string {
  if (!targetId) return "a target";
  if (targetId === "leader") return "the enemy leader";
  if (targetId === "selfLeader") return "their leader";
  return cardName(state, targetId) ?? "a follower";
}

/** This player's turn count (going second: first action turn is 1, not global 2). */
function playerTurnNumber(state: GameState, player: PlayerId): number {
  const global = state.turnNumber;
  if (global <= 0) return global;
  return player === state.firstPlayer ? Math.ceil(global / 2) : Math.floor(global / 2);
}

function describeChoice(
  state: GameState,
  payload: Record<string, unknown>,
): { text: string; cardName?: string } {
  const choice = state.pendingChoices;
  if (!choice) return { text: "resolved a choice" };

  if (payload.skip) return { text: `skipped (${choice.type})` };

  if (payload.targetId != null) {
    const id = String(payload.targetId);
    const name = targetLabel(state, id);
    return { text: `selected target: ${name}`, cardName: cardName(state, id) };
  }

  if (Array.isArray(payload.targetIds)) {
    const ids = (payload.targetIds as string[]).map(String);
    const names = ids.map((id) => targetLabel(state, id));
    return {
      text: ids.length ? `selected targets: ${names.join(", ")}` : "selected no targets",
      cardName: ids.length === 1 ? cardName(state, ids[0]) : undefined,
    };
  }

  if (payload.instanceId != null) {
    const id = String(payload.instanceId);
    const name = cardName(state, id) ?? id;
    return { text: `selected ${name}`, cardName: cardName(state, id) };
  }

  if (Array.isArray(payload.instanceIds)) {
    const ids = payload.instanceIds as string[];
    const names = ids.map((id) => cardName(state, id) ?? id);
    return {
      text: ids.length
        ? `selected ${names.join(", ")}`
        : `selected no cards (${choice.type})`,
      cardName: names.length === 1 ? names[0] : undefined,
    };
  }

  if (payload.optionIndex != null) {
    const idx = Number(payload.optionIndex);
    const opt =
      choice.type === "choose" || choice.type === "chooseMultiple"
        ? choice.options.find((o) => o.index === idx)
        : undefined;
    return { text: `chose option: ${opt?.label ?? `#${idx}`}` };
  }

  if (payload.triggerId != null) {
    const trigger = state.pendingTriggers.find((t) => t.id === String(payload.triggerId));
    return { text: `ordered trigger: ${trigger?.label ?? String(payload.triggerId)}` };
  }

  if (payload.position != null) {
    return { text: `put card on deck ${payload.position}` };
  }

  if (typeof payload.redraw === "boolean") {
    return { text: payload.redraw ? "mulligan redraw" : "kept hand" };
  }

  return { text: `responded to ${choice.type}` };
}

/** Build a human-readable action log entry from pre-action state. */
export function buildActionLogEntry(
  state: GameState,
  player: PlayerId,
  action: GameAction,
): ActionLogEntry {
  const base = {
    seq: (state.actionLog?.length ?? 0) + 1,
    turnNumber: playerTurnNumber(state, player),
    phase: state.phase,
    player,
    actionType: action.type,
  };

  switch (action.type) {
    case "MULLIGAN":
      return {
        ...base,
        text: action.redraw ? "redrew their hand (mulligan)" : "kept their opening hand",
      };
    case "PLAY_CARD": {
      const name = cardName(state, action.handInstanceId);
      return {
        ...base,
        text: name ? `played ${name}` : "played a card",
        cardName: name,
      };
    }
    case "QUICK_PLAY": {
      const name = cardName(state, action.handInstanceId);
      return {
        ...base,
        text: name ? `quick-played ${name}` : "quick-played a card",
        cardName: name,
      };
    }
    case "ATTACK": {
      const attacker = cardName(state, action.attackerId);
      const target = targetLabel(state, action.targetId);
      return {
        ...base,
        text: attacker
          ? `attacked ${target} with ${attacker}`
          : `attacked ${target}`,
        cardName: attacker,
      };
    }
    case "EVOLVE": {
      const name = cardName(state, action.fieldInstanceId);
      const kind = action.useSuperEvo ? "super-evolved" : "evolved";
      return {
        ...base,
        text: name ? `${kind} ${name}` : kind,
        cardName: name,
      };
    }
    case "ACTIVATE": {
      const name = cardName(state, action.fieldInstanceId);
      return {
        ...base,
        text: name ? `activated ${name}` : "activated a field ability",
        cardName: name,
      };
    }
    case "ACTIVATE_CEMETERY": {
      const name = cardName(state, action.cemeteryInstanceId);
      return {
        ...base,
        text: name ? `activated ${name} from cemetery` : "activated a cemetery ability",
        cardName: name,
      };
    }
    case "ACTIVATE_EXAREA": {
      const name = cardName(state, action.exAreaInstanceId);
      return {
        ...base,
        text: name ? `activated ${name} from EX area` : "activated an EX area ability",
        cardName: name,
      };
    }
    case "ACTIVATE_HAND": {
      const name = cardName(state, action.handInstanceId);
      return {
        ...base,
        text: name ? `activated ${name} from hand` : "activated a hand ability",
        cardName: name,
      };
    }
    case "END_MAIN":
      return { ...base, text: "ended their main phase" };
    case "PASS_QUICK_WINDOW":
      return { ...base, text: "passed the quick window" };
    case "CHOICE_RESPONSE": {
      const described = describeChoice(state, action.payload || {});
      return { ...base, text: described.text, cardName: described.cardName };
    }
    case "CONCEDE":
      return { ...base, text: "conceded" };
    default:
      return { ...base, text: `performed ${(action as GameAction).type}` };
  }
}

export function appendActionLog(
  before: GameState,
  player: PlayerId,
  action: GameAction,
  result: ActionResult,
): ActionResult {
  if (!result.ok) return result;
  const entry = buildActionLogEntry(before, player, action);
  const next = result.state;
  if (!next.actionLog) next.actionLog = [];
  next.actionLog.push(entry);
  return result;
}
