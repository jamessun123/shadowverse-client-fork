import { getCardDef, resolveTokenName } from "../cards/registry";

import { onCardEntersExArea, onFollowerEntersField, queueLastWords } from "../rules/confirmation";

import { runConfirmationTiming } from "../rules/confirmation";
import { describeEffect } from "../rules/trigger-labels";
import { queueOnOpponentDeckToCemetery, queueOnAbilityDamageTaken } from "../rules/trigger-queue";
import {
  contextForTriggerResolution,
  finishDeferredTriggers,
  getChosenChooseIndices,
  getChosenChooseLabels,
  withChoiceContext,
} from "../rules/effect-utils";

import { cardMatchesFilter, evalCondition } from "../state/conditions";

import { createCardInstance } from "../state/factory";

import {
  clampDamageToFollower,
  findInstance,
  findMatchingEvolveCard,
  getEffectiveStats,
  getPlayer,
  hasKeyword,
  opponentOf,
  resolveCardDefCost,
  resolveCardNo,
  isFollowerCard,
} from "../state/queries";
import { resetCardInstanceState } from "../state/card-reset";
import { destroyFollower, drawCard, moveCard, shuffleDeck } from "../state/zones";
import {
  DamageAmount,
  DeckFilter,
  Effect,
  GameState,
  Keyword,
  PlayerId,
  TargetSelector,
} from "../types";

export function appendResumeEffects(state: GameState, effects: Effect[]): GameState {
  if (effects.length === 0) return state;
  const next = structuredClone(state);
  const existing = next.resolutionContext?.resumeAfterChoice ?? [];
  const prev = next.resolutionContext;
  next.resolutionContext = {
    sourceInstanceId: prev?.sourceInstanceId,
    resumeOwnerInstanceId: prev?.resumeOwnerInstanceId ?? prev?.sourceInstanceId,
    effectStack: prev?.effectStack ?? [],
    resumeAfterChoice: [...existing, ...effects],
    forcedTargetId: prev?.forcedTargetId,
    forcedTargetIds: prev?.forcedTargetIds,
    lastSelectedTargetId: prev?.lastSelectedTargetId,
    buriedCosts: prev?.buriedCosts,
    lastDiscardedCardName: prev?.lastDiscardedCardName,
    engagedAsCostCount: prev?.engagedAsCostCount,
    deferTriggers: true,
  };
  return next;
}

function getTargetCandidates(
  state: GameState,
  player: PlayerId,
  selector: TargetSelector,
): string[] {
  const enemy = opponentOf(player);
  const matchesExtra = (c: { name: string; instanceId: string }) => {
    const def = getCardDef(c.name);
    if (!def) return false;
    if ("trait" in selector && selector.trait && !def.traits?.includes(selector.trait)) {
      return false;
    }
    if ("cardType" in selector && selector.cardType && def.cardType !== selector.cardType) {
      return false;
    }
    return true;
  };

  switch (selector.type) {
    case "selfLeader":
      return ["selfLeader"];
    case "enemyLeader":
      return ["leader"];
    case "enemyFollower":
      return getPlayer(state, enemy).zones.field
        .filter((c) => isFollowerCard(c, state))
        .filter((c) => !hasKeyword(c, "aura", state, enemy))
        .filter(matchesExtra)
        .map((c) => c.instanceId);
    case "enemyLeaderOrFollower":
      return [
        "leader",
        ...getPlayer(state, enemy).zones.field
          .filter((c) => isFollowerCard(c, state))
          .filter((c) => !hasKeyword(c, "aura", state, enemy))
          .filter(matchesExtra)
          .map((c) => c.instanceId),
      ];
    case "selfFollower":
      return getPlayer(state, player).zones.field
        .filter((c) => {
          if ("includeSelf" in selector && selector.includeSelf) return true;
          return c.instanceId !== state.resolutionContext?.sourceInstanceId;
        })
        .filter((c) => isFollowerCard(c, state))
        .filter(matchesExtra)
        .map((c) => c.instanceId);
    case "selfFieldCard":
      return getPlayer(state, player).zones.field
        .filter((c) => {
          if ("includeSelf" in selector && selector.includeSelf) return true;
          return c.instanceId !== state.resolutionContext?.sourceInstanceId;
        })
        .filter(matchesExtra)
        .map((c) => c.instanceId);
    case "anyFollower":
      return [...getPlayer(state, 0).zones.field, ...getPlayer(state, 1).zones.field]
        .filter((c) => {
          if (!isFollowerCard(c, state)) return false;
          if (
            "excludeSelf" in selector &&
            selector.excludeSelf &&
            c.instanceId === state.resolutionContext?.sourceInstanceId
          ) {
            return false;
          }
          const owner = getPlayer(state, 0).zones.field.some((f) => f.instanceId === c.instanceId)
            ? 0
            : 1;
          const effectEnemy = opponentOf(player);
          if (owner === effectEnemy && hasKeyword(c, "aura", state, owner)) return false;
          return matchesExtra(c);
        })
        .map((c) => c.instanceId);
    case "self":
      return state.resolutionContext?.sourceInstanceId
        ? [state.resolutionContext.sourceInstanceId]
        : [];
    default:
      return [];
  }
}

function shouldPromptTargetSelection(
  selector: TargetSelector,
  candidates: string[],
): boolean {
  if (candidates.length === 0) return false;
  // Leaders / self have no real choice — resolve immediately (e.g. Zealot's
  // follow-up leader damage after destroying a follower).
  if (
    selector.type === "enemyLeader" ||
    selector.type === "selfLeader" ||
    selector.type === "self"
  ) {
    return false;
  }
  // Always let the player confirm field-card targets, even with one candidate.
  return true;
}

function targetSelectionBounds(selector: TargetSelector): { min: number; max: number } {
  const count = "count" in selector && selector.count != null ? selector.count : 1;
  const min =
    "minCount" in selector && selector.minCount != null ? selector.minCount : count;
  const max =
    "maxCount" in selector && selector.maxCount != null ? selector.maxCount : count;
  return { min, max };
}

/** Multi-select UI when range allows 0 or more than one target. */
function isMultiTargetSelection(selector: TargetSelector): boolean {
  const { min, max } = targetSelectionBounds(selector);
  return max > 1 || min !== max;
}

function pickTargetFromCandidates(
  forced: string | undefined,
  candidates: string[],
  shouldPrompt: boolean,
): { targetId?: string; needsPrompt: boolean } {
  if (candidates.length === 0) return { needsPrompt: false };
  // forcedTargetId is only used when it is a legal candidate for this effect
  // (e.g. buff the ally that entered). Ignore it for unrelated target selectors
  // such as enemy followers.
  if (forced && candidates.includes(forced)) {
    return { targetId: forced, needsPrompt: false };
  }
  if (shouldPrompt) return { needsPrompt: true };
  return { targetId: candidates[0], needsPrompt: false };
}



function dealDamageToFollower(state: GameState, instanceId: string, amount: number): GameState {

  const next = structuredClone(state);

  const found = findInstance(next, instanceId);

  if (!found || found.zone !== "field") return state;

  // Damage only applies to followers — amulets have no defense and cannot be damaged.
  if (!isFollowerCard(found.card, next)) return state;

  const dmg = clampDamageToFollower(next, found.card, found.player, amount);
  if (dmg <= 0) return next;

  found.card.modifiers.push({ atk: 0, def: -dmg, sourceId: "effect" });

  // Queue "whenever this takes ability damage" before destroy. Leave 0-def followers
  // on the field so confirmation can resolve those triggers first (dig/buff/Storm),
  // then destroyAtZeroDef handles destruction + last words.
  queueOnAbilityDamageTaken(next, instanceId);

  return next;

}



function resolveDamageAmount(state: GameState, player: PlayerId, amount: DamageAmount): number {
  if (typeof amount === "number") return amount;
  if (amount.op === "otherFieldTraitCount") {
    const sourceId = state.resolutionContext?.sourceInstanceId;
    return getPlayer(state, player).zones.field.filter((c) => {
      if (c.instanceId === sourceId) return false;
      const def = getCardDef(c.name);
      return def?.traits?.includes(amount.trait);
    }).length;
  }
  if (amount.op === "fieldTraitCount") {
    const n = getPlayer(state, player).zones.field.filter((c) => {
      const def = getCardDef(c.name);
      return def?.traits?.includes(amount.trait);
    }).length;
    return n * (amount.multiplier ?? 1);
  }
  if (amount.op === "engagedFieldTraitCount") {
    const n = getPlayer(state, player).zones.field.filter((c) => {
      if (!c.engaged) return false;
      const def = getCardDef(c.name);
      return def?.traits?.includes(amount.trait);
    }).length;
    return n * (amount.multiplier ?? 1);
  }
  if (amount.op === "engagedAsCostCount") {
    return (state.resolutionContext?.engagedAsCostCount ?? 0) * (amount.multiplier ?? 1);
  }
  return 0;
}

function promptSelectZoneCards(
  state: GameState,
  player: PlayerId,
  fromZone: "cemetery" | "hand" | "exArea" | "field",
  count: number,
  action: "banish" | "discard" | "bury" | "engage" | "fuse",
  matches: { instanceId: string; name: string }[],
  resumeActivate?: {
    sourceInstanceId: string;
    zone: "field" | "cemetery" | "exArea" | "hand";
    abilityKey: string;
  },
  opts?: {
    minCount?: number;
    maxCount?: number;
    recordEngagedAsCost?: boolean;
    reasonLabel?: string;
  },
): GameState {
  const next = structuredClone(state);
  const minCount = opts?.minCount;
  const maxCount = opts?.maxCount;
  const rangeLabel =
    minCount != null && maxCount != null && minCount !== maxCount
      ? `${minCount}-${maxCount}`
      : String(count);
  next.pendingChoices = withChoiceContext(next, {
    type: "selectZoneCards",
    player,
    fromZone,
    count,
    minCount,
    maxCount,
    action,
    resumeActivate,
    recordEngagedAsCost: opts?.recordEngagedAsCost,
    reasonLabel: opts?.reasonLabel ?? `${action} ${rangeLabel} card(s)`,
    options: zoneCardOptions(matches),
  });
  return next;
}

function dealDamageToLeader(state: GameState, player: PlayerId, amount: number): GameState {

  const next = structuredClone(state);

  next.players[player].leaderDef -= amount;

  next.players[player].flags.leaderLostDefThisTurn = true;

  return next;

}



function labelForInstance(state: GameState, id: string): string {

  if (id === "leader") return "Enemy Leader";

  if (id === "selfLeader") return "Your Leader";

  const found = findInstance(state, id);

  if (!found) return id.slice(0, 8);

  const def = getCardDef(found.card.name);

  const name = def?.name || found.card.name;

  if (def?.cardType !== "follower") return name;

  const { atk, def: defense } = getEffectiveStats(found.card, state);

  return `${name} (${atk}/${defense})`;

}

function sideForTargetCandidate(
  state: GameState,
  choosingPlayer: PlayerId,
  instanceId: string,
): "ally" | "enemy" {
  if (instanceId === "leader") return "enemy";
  if (instanceId === "selfLeader") return "ally";
  const found = findInstance(state, instanceId);
  if (!found) return "ally";
  return found.player === choosingPlayer ? "ally" : "enemy";
}

function promptSelectTarget(

  state: GameState,

  player: PlayerId,

  effect: Effect,

  candidates: string[],

  bounds?: { min: number; max: number },

): GameState {

  const next = structuredClone(state);
  const minCount = bounds?.min ?? 1;
  const maxCount = bounds?.max ?? 1;

  next.pendingChoices = withChoiceContext(next, {
    type: "selectTarget",
    player,
    effect,
    count: maxCount,
    minCount,
    maxCount,
    reasonLabel: describeEffect(effect),
    candidates: candidates.map((instanceId) => {
      const found = findInstance(next, instanceId);
      return {
        instanceId,
        label: labelForInstance(next, instanceId),
        name: found?.card.name,
        side: sideForTargetCandidate(next, player, instanceId),
      };
    }),
  });

  return next;

}



function zoneCardOptions(cards: { instanceId: string; name: string }[]) {

  return cards.map((c) => ({

    instanceId: c.instanceId,

    label: getCardDef(c.name)?.name || c.name,

    name: c.name,

  }));

}



function promptSelectZoneCard(
  state: GameState,
  player: PlayerId,
  fromZone: "deck" | "cemetery" | "hand" | "evolveDeck",
  to: "hand" | "exArea" | "field",
  matches: { instanceId: string; name: string }[],
  optional?: boolean,
  playCostReduction?: number,
  reveal?: boolean,
  fromPlayer?: PlayerId,
  playSelected?: boolean,
): GameState {
  const next = structuredClone(state);
  next.pendingChoices = withChoiceContext(next, {
    type: "selectZoneCard",
    player,
    fromZone,
    fromPlayer,
    to,
    playSelected,
    optional,
    playCostReduction,
    reveal,
    options: zoneCardOptions(matches),
  });
  return next;
}



function promptSearchDeckTop(

  state: GameState,

  player: PlayerId,

  top: { instanceId: string; name: string }[],

  filter: DeckFilter,

  to: "hand" | "exArea" | "field",

  optional?: boolean,

  playCostReduction?: number,

  remainderTo: "cemetery" | "deckBottom" = "cemetery",

  reveal?: boolean,

  playCostReductionFilter?: DeckFilter,

): GameState {

  const next = structuredClone(state);

  next.pendingChoices = withChoiceContext(next, {
    type: "searchDeckTop",
    player,
    to,
    filter,
    topInstanceIds: top.map((c) => c.instanceId),
    optional,
    playCostReduction,
    playCostReductionFilter,
    remainderTo,
    reveal,
    reasonLabel: "Search deck",
    options: top.map((c) => ({
      instanceId: c.instanceId,
      label: getCardDef(c.name)?.name || c.name,
      name: c.name,
      eligible: cardMatchesFilter(c.name, filter),
    })),
  });

  return next;

}

function describeDeckFilter(filter: DeckFilter): string {
  const parts: string[] = [];
  if (filter.trait) parts.push(filter.trait);
  if (filter.allTraits?.length) parts.push(...filter.allTraits);
  if (filter.cardType) parts.push(filter.cardType);
  if (filter.identityNameContains) parts.push(`"${filter.identityNameContains}"`);
  if (filter.identityName) parts.push(filter.identityName);
  if (parts.length === 0) return "matching cards";
  if (filter.cardType) return parts.join(" ");
  return `${parts.join(" ")} card(s)`;
}

function promptSelectDeckSummon(
  state: GameState,
  player: PlayerId,
  top: { instanceId: string; name: string }[],
  filter: DeckFilter,
  maxTotalCost: number | undefined,
  remainderTo: "cemetery" | "deckBottom",
  maxCount?: number,
  to: "field" | "exArea" | "hand" = "field",
  reveal?: boolean,
): GameState {
  const next = structuredClone(state);
  const filterLabel = describeDeckFilter(filter);
  const destLabel =
    to === "exArea" ? "into your EX area" : to === "hand" ? "into your hand" : "onto your field";
  const countLabel =
    maxCount != null ? `up to ${maxCount} ${filterLabel}` : filterLabel;
  const costLabel =
    maxTotalCost != null ? ` (total cost ${maxTotalCost} or less)` : "";
  const remainderLabel =
    remainderTo === "deckBottom"
      ? " Unselected cards go to the bottom of your deck."
      : " Unselected cards go to the cemetery.";
  next.pendingChoices = withChoiceContext(next, {
    type: "selectDeckSummon",
    player,
    maxTotalCost,
    maxCount,
    to,
    filter,
    topInstanceIds: top.map((c) => c.instanceId),
    remainderTo,
    reveal,
    reasonLabel: `Select ${countLabel} to put ${destLabel}${costLabel}.${remainderLabel}`,
    options: top.map((c) => ({
      instanceId: c.instanceId,
      label: getCardDef(c.name)?.name || c.name,
      name: c.name,
      cost: resolveCardDefCost(c.name),
      eligible: cardMatchesFilter(c.name, filter),
    })),
  });
  return next;
}

export function buryDeckCards(state: GameState, player: PlayerId, instanceIds: string[]): GameState {

  let next = structuredClone(state);

  const p = next.players[player];

  for (const id of instanceIds) {

    const idx = p.zones.deck.findIndex((c) => c.instanceId === id);

    if (idx < 0) continue;

    const [card] = p.zones.deck.splice(idx, 1);

    p.zones.cemetery.push(card);

    next.eventLog.push({ type: "bury", player });

  }

  return next;

}



export function moveZoneCardTo(

  state: GameState,

  player: PlayerId,

  instanceId: string,

  fromZone: "deck" | "cemetery" | "hand" | "evolveDeck",

  to: "hand" | "exArea" | "field",

): GameState {

  let next = structuredClone(state);

  const p = next.players[player];

  const list = p.zones[fromZone];

  const idx = list.findIndex((c) => c.instanceId === instanceId);

  if (idx < 0) return state;

  const [card] = list.splice(idx, 1);

  if (to === "hand") {

    p.zones.hand.push(card);

  } else if (to === "exArea") {

    if (p.zones.exArea.length >= p.exLimit) {
      // Restore original deck order — do not orphan or shuffle on a failed move.
      list.splice(idx, 0, card);
      return state;
    }

    p.zones.exArea.push(card);

    onCardEntersExArea(next, card.instanceId, player);

  } else if (to === "field") {

    if (p.zones.field.length >= p.fieldLimit) {
      list.push(card);
    } else {
      p.zones.field.push(card);
      if (fromZone === "cemetery") {
        card.enteredFromCemetery = true;
        card.enteredFromHand = false;
      } else if (fromZone === "hand") {
        card.enteredFromHand = true;
        card.enteredFromCemetery = false;
      } else {
        card.enteredFromHand = false;
        card.enteredFromCemetery = false;
      }
      onFollowerEntersField(next, card.instanceId, player);
    }

  } else {

    list.push(card);

  }

  if (fromZone === "deck") return shuffleDeck(next, player);

  return next;

}



function applyGrantKeyword(
  state: GameState,
  player: PlayerId,
  keyword: Keyword,
  targets: TargetSelector,
  effect: Effect,
): GameState {
  const next = structuredClone(state);
  const candidates = getTargetCandidates(next, player, targets);
  if (candidates.length === 0) return state;

  const forced = next.resolutionContext?.forcedTargetId;
  const picked = pickTargetFromCandidates(
    forced,
    candidates,
    shouldPromptTargetSelection(targets, candidates) && !next.pendingChoices,
  );
  if (picked.needsPrompt) {
    return promptSelectTarget(next, player, effect, candidates);
  }

  const found = findInstance(next, picked.targetId!);
  if (!found) return state;
  if (!found.card.grantedKeywords.includes(keyword)) {
    found.card.grantedKeywords.push(keyword);
  }
  return next;
}



function canSatisfyOptionalCost(state: GameState, player: PlayerId, effect: Effect): boolean {
  switch (effect.op) {
    case "discardFromHand": {
      const need = effect.count ?? 1;
      const matches = getPlayer(state, player).zones.hand.filter((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
      return matches.length >= need;
    }
    case "selectFromHand":
      return getPlayer(state, player).zones.hand.some((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
    case "banishFromExArea": {
      const need = effect.count ?? 1;
      return (
        getPlayer(state, player).zones.exArea.filter((c) =>
          cardMatchesFilter(c.name, effect.filter),
        ).length >= need
      );
    }
    case "banishFromCemetery": {
      const need = effect.count ?? 1;
      return (
        getPlayer(state, player).zones.cemetery.filter((c) =>
          cardMatchesFilter(c.name, effect.filter),
        ).length >= need
      );
    }
    case "spendPp":
      return getPlayer(state, player).pp >= effect.amount;
    case "burySelf": {
      const sourceId = state.resolutionContext?.sourceInstanceId;
      if (!sourceId) return false;
      const found = findInstance(state, sourceId);
      return Boolean(found && found.zone === "field" && found.player === player);
    }
    case "destroy":
      return getTargetCandidates(state, player, effect.targets).length > 0;
    case "discard":
      return getPlayer(state, player).zones.hand.length >= effect.count;
    case "sequence":
      return effect.steps.every((step) => canSatisfyOptionalCost(state, player, step));
    default:
      return true;
  }
}

export type ResolveEffectOptions = {
  deferConfirmation?: boolean;
};

export function resolveEffect(
  state: GameState,
  effect: Effect,
  player: PlayerId,
  options?: ResolveEffectOptions,
): GameState {

  let next = structuredClone(state);

  if (options?.deferConfirmation) {
    next.resolutionContext = {
      sourceInstanceId: next.resolutionContext?.sourceInstanceId,
      resumeOwnerInstanceId:
        next.resolutionContext?.resumeOwnerInstanceId ??
        next.resolutionContext?.sourceInstanceId,
      effectStack: next.resolutionContext?.effectStack ?? [],
      resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
      forcedTargetId: next.resolutionContext?.forcedTargetId,
      forcedTargetIds: next.resolutionContext?.forcedTargetIds,
      lastSelectedTargetId: next.resolutionContext?.lastSelectedTargetId,
      buriedCosts: next.resolutionContext?.buriedCosts,
      lastDiscardedCardName: next.resolutionContext?.lastDiscardedCardName,
      engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
      deferTriggers: true,
    };
  }

  switch (effect.op) {

    case "draw":

      for (let i = 0; i < effect.count; i++) {

        next = drawCard(next, player);

      }

      break;



    case "recoverPp": {

      const p = next.players[player];

      p.pp = Math.min(p.pp + effect.amount, p.maxPp);

      break;

    }

    case "spendPp": {
      const p = next.players[player];
      p.pp = Math.max(0, p.pp - effect.amount);
      break;
    }

    case "increaseMaxPp": {
      const p = next.players[player];
      const gain = Math.max(0, effect.amount);
      // Max only (empty orb). Pair with recoverPp when the point should be usable now.
      p.maxPp = Math.min(10, p.maxPp + gain);
      break;
    }

    case "rollDie": {
      const roll = Math.floor(Math.random() * effect.sides) + 1;
      next.eventLog.push({ type: "diceRoll", player, data: { roll } });
      const outcome = effect.outcomes.find((o) => o.on.includes(roll));
      if (outcome) {
        next = resolveEffect(next, outcome.effect, player, options);
        if (next.pendingChoices) return next;
      }
      break;
    }

    case "buryOpponentMaxAttackFollower": {
      for (const opp of [opponentOf(player)] as PlayerId[]) {
        const field = getPlayer(next, opp).zones.field;
        if (field.length === 0) continue;
        let best = field[0];
        let bestAtk = getEffectiveStats(best, next).atk;
        for (const card of field.slice(1)) {
          const atk = getEffectiveStats(card, next).atk;
          if (atk > bestAtk) {
            best = card;
            bestAtk = atk;
          }
        }
        const p = next.players[opp];
        const idx = p.zones.field.findIndex((c) => c.instanceId === best.instanceId);
        if (idx < 0) continue;
        const [buried] = p.zones.field.splice(idx, 1);
        resetCardInstanceState(buried);
        p.zones.cemetery.push(buried);
        next.eventLog.push({ type: "bury", player: opp });
      }
      break;
    }



    case "healLeader":

      next.players[player].leaderDef += effect.amount;

      break;



    case "dealDamage": {
      const forcedIds = next.resolutionContext?.forcedTargetIds;
      const forced = next.resolutionContext?.forcedTargetId;
      const candidates = getTargetCandidates(next, player, effect.targets);

      const applyTo = (targetId: string) => {
        const damage = resolveDamageAmount(next, player, effect.amount);
        if (targetId === "leader") {
          next = dealDamageToLeader(next, opponentOf(player), damage);
        } else if (targetId === "selfLeader") {
          next = dealDamageToLeader(next, player, damage);
        } else {
          next = dealDamageToFollower(next, targetId, damage);
        }
      };

      if (forcedIds) {
        for (const targetId of forcedIds) {
          applyTo(targetId);
        }
        break;
      }

      if (candidates.length === 0) break;

      const bounds = targetSelectionBounds(effect.targets);
      if (
        isMultiTargetSelection(effect.targets) &&
        shouldPromptTargetSelection(effect.targets, candidates) &&
        !next.pendingChoices
      ) {
        return promptSelectTarget(next, player, effect, candidates, bounds);
      }

      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection(effect.targets, candidates) && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, effect, candidates, bounds);
      }
      applyTo(picked.targetId!);

      break;

    }



    case "buffFieldTrait": {
      const p = next.players[player];
      const sourceId = next.resolutionContext?.sourceInstanceId || "effect";
      for (const card of p.zones.field) {
        if (effect.excludeSelf && card.instanceId === sourceId) continue;
        const def = getCardDef(card.name);
        if (!def?.traits?.includes(effect.trait)) continue;
        // Atk/def buffs only apply to followers; amulets may still receive keywords.
        if (def.cardType === "follower" && (effect.atk || effect.def)) {
          card.modifiers.push({ atk: effect.atk ?? 0, def: effect.def ?? 0, sourceId });
        }
        if (effect.keyword && !card.grantedKeywords.includes(effect.keyword)) {
          card.grantedKeywords.push(effect.keyword);
        }
      }
      break;
    }

    case "buff": {

      const forced = next.resolutionContext?.forcedTargetId;

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection(effect.targets, candidates) && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, effect, candidates);
      }
      const targetId = picked.targetId!;

      const found = findInstance(next, targetId);

      if (found && isFollowerCard(found.card, next)) {

        found.card.modifiers.push({

          atk: effect.atk ?? 0,

          def: effect.def ?? 0,

          sourceId: next.resolutionContext?.sourceInstanceId || "effect",

        });

      }

      break;

    }



    case "grantKeyword":

      next = applyGrantKeyword(next, player, effect.keyword, effect.targets, effect);
      if (next.pendingChoices) return next;

      break;

    case "grantKeywordMatching": {
      const p = next.players[player];
      for (const card of p.zones.field) {
        if (!cardMatchesFilter(resolveCardNo(next, card), effect.filter)) continue;
        if (!card.grantedKeywords.includes(effect.keyword)) {
          card.grantedKeywords.push(effect.keyword);
        }
      }
      break;
    }

    case "destroy": {

      const forced = next.resolutionContext?.forcedTargetId;

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection(effect.targets, candidates) && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, effect, candidates);
      }
      const targetId = picked.targetId!;

      // Follower-only selectors must never destroy amulets (or other non-followers).
      const followerOnly =
        effect.targets.type === "enemyFollower" ||
        effect.targets.type === "selfFollower" ||
        effect.targets.type === "anyFollower";
      if (followerOnly) {
        const found = findInstance(next, targetId);
        if (!found || !isFollowerCard(found.card, next)) break;
      }

      queueLastWords(next, targetId, player);

      next = destroyFollower(next, targetId);

      break;

    }



    case "summon": {

      const p = next.players[player];

      const zone = effect.zone === "exArea" ? p.zones.exArea : p.zones.field;

      const limit = effect.zone === "exArea" ? p.exLimit : p.fieldLimit;

      for (let i = 0; i < effect.count && zone.length < limit; i++) {
        const tokenKey = effect.tokenName ?? effect.tokenCardNo;
        if (!tokenKey) break;
        const token = createCardInstance(resolveTokenName(tokenKey), player, player);
        if (!getCardDef(token.name)) break;
        zone.push(token);

        if (effect.zone === "field") {

          onFollowerEntersField(next, token.instanceId, player);

        } else {

          onCardEntersExArea(next, token.instanceId, player);

        }

      }

      break;

    }



    case "discard": {

      const hand = next.players[player].zones.hand;

      const toDiscard = Math.min(effect.count, hand.length);

      if (toDiscard <= 0) break;

      if (toDiscard > 0 && !next.pendingChoices) {

        return promptSelectZoneCards(next, player, "hand", toDiscard, "discard", hand);

      }

      for (let i = 0; i < toDiscard; i++) {

        const card = hand.pop()!;

        next.players[player].zones.cemetery.push(card);

      }

      break;

    }

    case "discardOpponentRandom": {
      const opp = opponentOf(player);
      const hand = next.players[opp].zones.hand;
      const toDiscard = Math.min(effect.count, hand.length);
      for (let i = 0; i < toDiscard; i++) {
        const idx = Math.floor(Math.random() * hand.length);
        const [card] = hand.splice(idx, 1);
        if (card) next.players[opp].zones.cemetery.push(card);
      }
      break;
    }



    case "if":

      if (evalCondition(next, player, effect.condition)) {

        next = resolveEffect(next, effect.then, player);

      } else if (effect.else) {

        next = resolveEffect(next, effect.else, player);

      }

      break;



    case "noop":
      break;

    case "optionalCost": {
      if (!canSatisfyOptionalCost(next, player, effect.cost)) break;
      if (!next.pendingChoices) {
        next.pendingChoices = withChoiceContext(next, {
          type: "choose",
          player,
          min: 1,
          max: 1,
          reasonLabel: effect.label ?? "Optional effect",
          options: [
            {
              index: 0,
              label: effect.label ?? "Pay cost",
              effect: { op: "sequence", steps: [effect.cost, effect.then] },
            },
            { index: 1, label: "Skip", effect: { op: "noop" } },
          ],
        });
        return next;
      }
      break;
    }

    case "sequence": {
      next.resolutionContext = {
        sourceInstanceId: next.resolutionContext?.sourceInstanceId,
        resumeOwnerInstanceId:
          next.resolutionContext?.resumeOwnerInstanceId ??
          next.resolutionContext?.sourceInstanceId,
        effectStack: next.resolutionContext?.effectStack ?? [],
        resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
        forcedTargetId: next.resolutionContext?.forcedTargetId,
        forcedTargetIds: next.resolutionContext?.forcedTargetIds,
        lastSelectedTargetId: next.resolutionContext?.lastSelectedTargetId,
        buriedCosts: next.resolutionContext?.buriedCosts,
        lastDiscardedCardName: next.resolutionContext?.lastDiscardedCardName,
        engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
        deferTriggers: true,
      };
      for (let i = 0; i < effect.steps.length; i++) {
        next = resolveEffect(next, effect.steps[i], player, { deferConfirmation: true });
        if (next.pendingChoices) {
          return appendResumeEffects(next, effect.steps.slice(i + 1));
        }
      }
      break;
    }



    case "choose":

      if (!next.pendingChoices) {

        const sourceId = next.resolutionContext?.sourceInstanceId;
        const sourceCard = sourceId ? findInstance(next, sourceId)?.card : undefined;
        const trackKey = effect.excludeChosenThisTurn
          ? (effect.trackKey ?? "default")
          : undefined;
        const alreadyChosen = trackKey
          ? getChosenChooseIndices(next, player, trackKey, sourceCard, sourceId)
          : null;
        const alreadyChosenLabels = trackKey
          ? getChosenChooseLabels(next, player, trackKey, sourceCard, sourceId)
          : null;

        const affordableOptions = effect.options
          .map((o, i) => ({
            index: i,
            label: o.label,
            effect: o.effect,
            additionalPpCost: o.additionalPpCost,
          }))
          .filter(
            (o) =>
              !(alreadyChosen?.has(o.index) || alreadyChosenLabels?.has(o.label)),
          )
          .filter(
            (o) =>
              (!o.additionalPpCost || next.players[player].pp >= o.additionalPpCost) &&
              canEffectResolve(next, player, o.effect),
          );
        if (affordableOptions.length === 0) break;
        next.pendingChoices = withChoiceContext(next, {
          type: "choose",
          player,
          reasonLabel: "Choose an option",
          options: affordableOptions,
          min: effect.min,
          max: effect.max,
          trackChosenKey: trackKey,
          sourceInstanceId: sourceId,
        });

        return next;

      }

      break;



    case "chooseMultiple":

      if (!next.pendingChoices) {

        next.pendingChoices = withChoiceContext(next, {
          type: "chooseMultiple",
          player,
          reasonLabel: "Choose effects and order",
          options: effect.options.map((o, i) => ({
            index: i,
            label: o.label,
            effect: o.effect,
          })),
          min: effect.min,
          max: effect.max,
        });

        return next;

      }

      break;



    case "mill": {

      const deck = next.players[player].zones.deck;

      for (let i = 0; i < effect.count && deck.length > 0; i++) {

        const [card] = deck.splice(0, 1);

        next.players[player].zones.cemetery.push(card);

        next.eventLog.push({ type: "bury", player });

      }

      if (deck.length === 0 && effect.count > 0) {

        next.eventLog.push({ type: "deckOut", player });

      }

      break;

    }



    case "millOpponent": {

      const opp = opponentOf(player);

      const deck = next.players[opp].zones.deck;

      for (let i = 0; i < effect.count && deck.length > 0; i++) {

        const [card] = deck.splice(0, 1);

        next.players[opp].zones.cemetery.push(card);

        next.eventLog.push({ type: "millOpponent", player, data: { name: card.name } });

        queueOnOpponentDeckToCemetery(next);

      }

      break;

    }



    case "damageFollowerAndLeader": {

      const forced = next.resolutionContext?.forcedTargetId;

      const candidates = getTargetCandidates(next, player, { type: "enemyFollower" });

      if (candidates.length === 0) break;

      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection({ type: "enemyFollower", count: 1 }, candidates) &&
          !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, effect, candidates);
      }
      const targetId = picked.targetId!;

      next = dealDamageToFollower(next, targetId, effect.followerAmount);

      next = dealDamageToLeader(next, opponentOf(player), effect.leaderAmount);

      break;

    }



    case "tutorFromCemetery": {

      const p = next.players[player];

      const matches = p.zones.cemetery.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) break;

      if (!next.pendingChoices) {

        return promptSelectZoneCard(
          next,
          player,
          "cemetery",
          effect.to,
          matches,
          undefined,
          effect.playCostReduction,
          effect.reveal,
        );

      }

      break;

    }

    case "tutorFromOpponentCemetery": {
      const opp = opponentOf(player);
      const filter = effect.filter ?? {};
      const matches = next.players[opp].zones.cemetery.filter((c) =>
        cardMatchesFilter(c.name, filter),
      );
      if (matches.length === 0) break;
      if (!next.pendingChoices) {
        return promptSelectZoneCard(
          next,
          player,
          "cemetery",
          effect.to,
          matches,
          undefined,
          effect.playCostReduction,
          undefined,
          opp,
        );
      }
      break;
    }

    case "playFromOpponentCemetery": {
      const opp = opponentOf(player);
      const filter = effect.filter ?? {};
      const matches = next.players[opp].zones.cemetery.filter((c) =>
        cardMatchesFilter(c.name, filter),
      );
      if (matches.length === 0) break;
      if (!next.pendingChoices) {
        return promptSelectZoneCard(
          next,
          player,
          "cemetery",
          "field",
          matches,
          undefined,
          undefined,
          undefined,
          opp,
          true,
        );
      }
      break;
    }

    case "playFromCemetery": {
      const filter = effect.filter ?? {};
      const matches = next.players[player].zones.cemetery.filter((c) =>
        cardMatchesFilter(c.name, filter),
      );
      if (matches.length === 0) break;
      if (!next.pendingChoices) {
        return promptSelectZoneCard(
          next,
          player,
          "cemetery",
          "field",
          matches,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
        );
      }
      break;
    }

    case "addPersistentCounter": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      if (!sourceId) break;
      const found = findInstance(next, sourceId);
      if (!found) break;
      if (!found.card.persistentCounters) found.card.persistentCounters = {};
      const amount = effect.amount ?? 1;
      found.card.persistentCounters[effect.key] =
        (found.card.persistentCounters[effect.key] ?? 0) + amount;
      break;
    }

    case "returnSourceToHand": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      if (!sourceId) break;
      const found = findInstance(next, sourceId);
      if (!found) break;
      if (found.zone === "hand") break;
      next = moveCard(next, sourceId, "hand", found.card.owner);
      break;
    }



    case "autoEvolveIf": {

      if (!evalCondition(next, player, effect.condition)) break;

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const fieldFound = findInstance(next, sourceId);

      if (!fieldFound || fieldFound.zone !== "field" || fieldFound.card.linkedEvoInstanceId) break;

      const evoCard = findMatchingEvolveCard(next, player, sourceId);

      if (!evoCard) break;

      const evoFound = findInstance(next, evoCard.instanceId);

      if (!evoFound || evoFound.zone !== "evolveDeck") break;

      next = moveCard(next, evoCard.instanceId, "resolutionZone", player);

      const fieldOnNext = findInstance(next, sourceId);
      if (!fieldOnNext || fieldOnNext.zone !== "field") break;

      fieldOnNext.card.linkedEvoInstanceId = evoCard.instanceId;

      fieldOnNext.card.evolvedThisTurn = true;

      // Preserve prior leader-attack eligibility; Rush comes from evolvedThisTurn.

      next.players[player].flags.evolvedThisTurn = true;

      next.players[player].zones.evolveZone.push({

        fieldInstanceId: sourceId,

        evolveInstanceId: evoCard.instanceId,

      });

      if (effect.triggerOnEvolve === true) {
        const evoDef = getCardDef(evoFound.card.name);
        for (const ability of evoDef?.abilities?.filter((a) => a.timing === "onEvolve") ?? []) {
          next.resolutionContext = contextForTriggerResolution(next, sourceId, ability.effect);
          next = resolveEffect(next, ability.effect, player);
          if (next.pendingChoices || (next.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0) {
            return next;
          }
          next.resolutionContext = null;
        }
      }

      break;

    }



    case "tutorFromDeck": {

      const p = next.players[player];

      const matches = p.zones.deck.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) break;

      if (!next.pendingChoices) {

        return promptSelectZoneCard(
          next,
          player,
          "deck",
          effect.to,
          matches,
          undefined,
          effect.playCostReduction,
          effect.reveal,
        );

      }

      break;

    }



    case "searchDeckChoose": {

      const p = next.players[player];

      const top = p.zones.deck.slice(0, effect.lookAt);

      if (top.length === 0) break;

      if (!next.pendingChoices) {

        return promptSearchDeckTop(
          next,
          player,
          top,
          effect.filter,
          effect.to,
          effect.optional,
          effect.playCostReduction,
          effect.remainderTo ?? "cemetery",
          effect.reveal,
          effect.playCostReductionFilter,
        );

      }

      break;

    }



    case "engage": {

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      let targetId = candidates[0];

      if (candidates.length >= 1 && !next.pendingChoices) {

        return promptSelectTarget(next, player, effect, candidates);

      }

      const found = findInstance(next, targetId);

      if (found) found.card.engaged = true;

      break;

    }



    case "box": {

      const forced = next.resolutionContext?.forcedTargetId;

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        candidates.length >= 1 && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, effect, candidates);
      }
      const targetId = picked.targetId!;

      const found = findInstance(next, targetId);

      if (found) {

        found.card.engaged = true;

        found.card.boxedUntilTurn = next.turnNumber + 2;

      }

      break;

    }



    case "grantPlayCostReduction": {

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      const targetId = candidates[0];

      const found = findInstance(next, targetId);

      if (found) found.card.persistentPlayCostReduction += effect.amount;

      break;

    }



    case "banishFromCemetery": {

      const p = next.players[player];

      const matches = p.zones.cemetery.filter((c) => cardMatchesFilter(c.name, effect.filter));

      const toBanish = Math.min(effect.count, matches.length);

      if (toBanish <= 0) break;

      if (matches.length >= toBanish && !next.pendingChoices) {

        return promptSelectZoneCards(next, player, "cemetery", toBanish, "banish", matches);

      }

      for (let i = 0; i < toBanish; i++) {

        const idx = p.zones.cemetery.findIndex((c) => cardMatchesFilter(c.name, effect.filter));

        if (idx < 0) break;

        const [card] = p.zones.cemetery.splice(idx, 1);

        p.zones.banish.push(card);

      }

      break;

    }



    case "banishFromExArea": {

      const p = next.players[player];

      for (let i = 0; i < effect.count; i++) {

        const idx = p.zones.exArea.findIndex((c) => cardMatchesFilter(c.name, effect.filter));

        if (idx < 0) break;

        const [card] = p.zones.exArea.splice(idx, 1);

        p.zones.banish.push(card);

      }

      break;

    }



    case "reviveSelfFromCemetery": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const p = next.players[player];

      const idx = p.zones.cemetery.findIndex((c) => c.instanceId === sourceId);

      if (idx < 0 || p.zones.field.length >= p.fieldLimit) break;

      const [card] = p.zones.cemetery.splice(idx, 1);

      p.zones.field.push(card);

      onFollowerEntersField(next, card.instanceId, player);

      break;

    }



    case "moveSourceToExArea": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const p = next.players[player];

      if (p.zones.exArea.length >= p.exLimit) break;

      let fromZone: "cemetery" | "hand" | null = null;

      let idx = p.zones.cemetery.findIndex((c) => c.instanceId === sourceId);

      if (idx >= 0) fromZone = "cemetery";

      if (fromZone === null) {

        idx = p.zones.hand.findIndex((c) => c.instanceId === sourceId);

        if (idx >= 0) fromZone = "hand";

      }

      if (fromZone === null || idx < 0) break;

      const [card] = p.zones[fromZone].splice(idx, 1);

      p.zones.exArea.push(card);

      onCardEntersExArea(next, card.instanceId, player);

      break;

    }



    case "selectFromHand": {

      const p = next.players[player];

      const matches = p.zones.hand.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) {

        if (effect.optional) break;

        return next;

      }

      if (!next.pendingChoices) {

        return promptSelectZoneCard(
          next,
          player,
          "hand",
          effect.to,
          matches,
          effect.optional,
          effect.playCostReduction,
        );

      }

      break;

    }



    case "discardFromHand": {

      const p = next.players[player];

      const matches = p.zones.hand.filter((c) => cardMatchesFilter(c.name, effect.filter));

      const toDiscard = Math.min(effect.count, matches.length);

      if (toDiscard <= 0) break;

      if (toDiscard > 0 && !next.pendingChoices) {

        return promptSelectZoneCards(next, player, "hand", toDiscard, "discard", matches);

      }

      let remaining = toDiscard;

      for (let i = p.zones.hand.length - 1; i >= 0 && remaining > 0; i--) {

        const card = p.zones.hand[i];

        if (!cardMatchesFilter(card.name, effect.filter)) continue;

        p.zones.hand.splice(i, 1);

        p.zones.cemetery.push(card);

        next.resolutionContext = {
          ...next.resolutionContext,
          sourceInstanceId: next.resolutionContext?.sourceInstanceId,
          effectStack: next.resolutionContext?.effectStack ?? [],
          lastDiscardedCardName: card.name,
        };

        remaining--;

      }

      break;

    }



    case "triggerAbilities": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const found = findInstance(next, sourceId);

      if (!found) break;

      const def = getCardDef(resolveCardNo(next, found.card));

      const abilities = def?.abilities?.filter((a) => a.timing === effect.timing) ?? [];

      for (const ability of abilities) {

        next = resolveEffect(next, ability.effect, player);

        if (next.pendingChoices) return next;

      }

      break;

    }



    case "banishSelf": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const found = findInstance(next, sourceId);

      if (!found) break;

      const p = next.players[found.player];

      const zoneKey = found.zone as keyof typeof p.zones;

      const list = p.zones[zoneKey] as typeof p.zones.hand;

      const idx = list.findIndex((c) => c.instanceId === sourceId);

      if (idx < 0) break;

      const [card] = list.splice(idx, 1);

      resetCardInstanceState(card);

      p.zones.banish.push(card);

      break;

    }

    case "burySelf": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      if (!sourceId) break;
      const found = findInstance(next, sourceId);
      if (!found || found.zone !== "field") break;
      queueLastWords(next, sourceId, found.player);
      next = destroyFollower(next, sourceId);
      break;
    }

    case "grantLastWords": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      const found = sourceId ? findInstance(next, sourceId) : null;

      if (!found) break;

      if (!found.card.grantedLastWords) found.card.grantedLastWords = [];

      found.card.grantedLastWords.push(effect.effect);

      break;

    }



    case "putHandCardOnDeck": {

      const hand = next.players[player].zones.hand;

      if (hand.length === 0) break;

      if (!next.pendingChoices) {

        const pick = structuredClone(next);

        pick.pendingChoices = withChoiceContext(pick, {
          type: "putHandOnDeck",
          player,
          phase: "selectCard",
          position: effect.position,
          reasonLabel: "Put a hand card on your deck",
          options: hand.map((c) => ({
            instanceId: c.instanceId,
            name: c.name,
            label: getCardDef(c.name)?.name || c.name,
          })),
        });

        return pick;

      }

      break;

    }



    case "summonFromEvolveDeck": {

      const p = next.players[player];

      if (p.zones.field.length >= p.fieldLimit) break;

      const filter = effect.filter ?? {};

      const matches = p.zones.evolveDeck.filter(
        (c) => !c.evolveUsed && cardMatchesFilter(c.name, filter),
      );

      if (matches.length === 0) break;

      if (!next.pendingChoices) {
        return promptSelectZoneCard(next, player, "evolveDeck", "field", matches);
      }

      break;

    }



    case "summonFromCemetery": {

      const p = next.players[player];

      const slots = p.fieldLimit - p.zones.field.length;

      if (slots <= 0) break;

      const toSummon = Math.min(effect.count, slots);

      const matches = p.zones.cemetery.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) break;

      if (effect.maxTotalCost != null) {

        if (!next.pendingChoices) {

          const pick = structuredClone(next);

          pick.pendingChoices = {

            type: "selectCemeterySummon",

            player,

            count: toSummon,

            maxTotalCost: effect.maxTotalCost,

            filter: effect.filter,

            options: matches.map((c) => ({

              instanceId: c.instanceId,

              name: c.name,

              label: getCardDef(c.name)?.name || c.name,

              cost: resolveCardDefCost(c.name),

            })),

          };

          return pick;

        }

        break;

      }

      let summoned = 0;

      for (const card of [...matches]) {

        if (summoned >= toSummon || p.zones.field.length >= p.fieldLimit) break;

        const idx = p.zones.cemetery.findIndex((c) => c.instanceId === card.instanceId);

        if (idx < 0) continue;

        const [picked] = p.zones.cemetery.splice(idx, 1);

        p.zones.field.push(picked);

        onFollowerEntersField(next, picked.instanceId, player);

        summoned++;

      }

      break;

    }



    case "searchDeckSummonMultiple": {
      const p = next.players[player];
      const top = p.zones.deck.slice(0, effect.lookAt);
      if (top.length === 0) break;
      if (!next.pendingChoices) {
        return promptSelectDeckSummon(
          next,
          player,
          top,
          effect.filter,
          effect.maxTotalCost,
          effect.remainderTo ?? "deckBottom",
          effect.maxCount,
          effect.to ?? "field",
          effect.reveal,
        );
      }
      break;
    }

    case "buryFieldFollowers": {
      const p = next.players[player];
      const sourceId = next.resolutionContext?.sourceInstanceId;
      const buriedCosts: number[] = [];
      let toBury;
      if (effect.sourceOnly && sourceId) {
        const source = findInstance(next, sourceId);
        toBury = source?.zone === "field" ? [source.card] : [];
      } else {
        toBury = p.zones.field.filter((card) => {
          if (effect.excludeSelf && card.instanceId === sourceId) return false;
          const cardNo = resolveCardNo(next, card);
          if (effect.filter && !cardMatchesFilter(cardNo, effect.filter)) return false;
          if (effect.minCost != null && resolveCardDefCost(cardNo) < effect.minCost) {
            return false;
          }
          return true;
        });
      }
      for (const card of toBury) {
        buriedCosts.push(resolveCardDefCost(resolveCardNo(next, card)));
        queueLastWords(next, card.instanceId, player);
        next = destroyFollower(next, card.instanceId);
      }
      next.resolutionContext = {
        ...next.resolutionContext,
        sourceInstanceId: next.resolutionContext?.sourceInstanceId,
        effectStack: next.resolutionContext?.effectStack ?? [],
        buriedCosts,
      };
      break;
    }

    case "dealDamageAllEnemies": {
      const opp = opponentOf(player);
      const amount = resolveDamageAmount(next, player, effect.amount);
      const leadersOnly = effect.leadersOnly === true;
      const followersOnly = effect.followersOnly === true;
      if (!followersOnly) {
        next = dealDamageToLeader(next, opp, amount);
      }
      if (!leadersOnly) {
        for (const card of [...next.players[opp].zones.field]) {
          const def = getCardDef(card.name);
          if (def?.cardType !== "follower") continue;
          next = dealDamageToFollower(next, card.instanceId, amount);
        }
      }
      break;
    }

    case "dealDamageAllFollowers": {
      const amount = resolveDamageAmount(next, player, effect.amount);
      const ids = [
        ...next.players[0].zones.field.map((c) => c.instanceId),
        ...next.players[1].zones.field.map((c) => c.instanceId),
      ];
      for (const id of ids) {
        const found = findInstance(next, id);
        if (!found || found.zone !== "field") continue;
        const def = getCardDef(found.card.name);
        if (def?.cardType !== "follower") continue;
        next = dealDamageToFollower(next, id, amount);
      }
      break;
    }

    case "grantOnCardPlayed": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      const found = sourceId ? findInstance(next, sourceId) : null;
      if (!found) break;
      if (!found.card.grantedOnCardPlayed) found.card.grantedOnCardPlayed = [];
      found.card.grantedOnCardPlayed.push({
        filter: effect.filter,
        effect: effect.effect,
        untilEndOfTurn: effect.untilEndOfTurn,
        oncePerTurn: effect.oncePerTurn,
        maxPerTurn: effect.maxPerTurn,
        label: effect.label,
      });
      break;
    }

    case "playCostReduction": {
      // Applied via getEffectivePlayCost from pending grantOnCardPlayed entries.
      break;
    }

    case "setSourceEvolveCostOverride": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      const found = sourceId ? findInstance(next, sourceId) : null;
      if (found) found.card.evolveCostOverride = effect.amount;
      break;
    }

    case "engageFromFieldAsCost": {
      const p = next.players[player];
      const matches = p.zones.field.filter(
        (c) => !c.engaged && cardMatchesFilter(c.name, effect.filter),
      );
      const min = effect.min ?? 0;
      const max = Math.min(effect.max ?? matches.length, matches.length);
      if (matches.length < min) break;
      if (matches.length === 0 || max <= 0) {
        next.resolutionContext = {
          ...next.resolutionContext,
          sourceInstanceId: next.resolutionContext?.sourceInstanceId,
          effectStack: next.resolutionContext?.effectStack ?? [],
          engagedAsCostCount: 0,
        };
        break;
      }
      if (!next.pendingChoices) {
        return promptSelectZoneCards(next, player, "field", max, "engage", matches, undefined, {
          minCount: min,
          maxCount: max,
          recordEngagedAsCost: true,
          reasonLabel: "Engage any number of Idolatry as an additional cost",
        });
      }
      break;
    }

    case "passiveKeywords":

    case "auraGrantKeyword":

    case "damageCap":

      break;

  }



  if (options?.deferConfirmation) {
    return next;
  }

  next = finishDeferredTriggers(next);
  return runConfirmationTiming(next);

}



export function canEffectResolve(state: GameState, player: PlayerId, effect: Effect): boolean {
  switch (effect.op) {
    case "buff":
    case "dealDamage":
    case "engage":
    case "box":
    case "destroy": {
      if (
        (effect.op === "dealDamage" ||
          effect.op === "buff" ||
          effect.op === "engage" ||
          effect.op === "box" ||
          effect.op === "destroy") &&
        "minCount" in effect.targets &&
        effect.targets.minCount === 0
      ) {
        return true;
      }
      return getTargetCandidates(state, player, effect.targets).length > 0;
    }
    case "sequence":
      return effect.steps.every((step) => canEffectResolve(state, player, step));
    case "if":
      if (!evalCondition(state, player, effect.condition)) {
        return effect.else ? canEffectResolve(state, player, effect.else) : true;
      }
      return canEffectResolve(state, player, effect.then);
    case "optionalCost":
      return canEffectResolve(state, player, effect.then);
    case "choose":
    case "chooseMultiple":
      return effect.options.some(
        (o) =>
          (!o.additionalPpCost || state.players[player].pp >= o.additionalPpCost) &&
          canEffectResolve(state, player, o.effect),
      );
    case "tutorFromCemetery": {
      return getPlayer(state, player).zones.cemetery.some((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
    }
    case "tutorFromOpponentCemetery":
    case "playFromOpponentCemetery": {
      const filter = effect.filter ?? {};
      return getPlayer(state, opponentOf(player)).zones.cemetery.some((c) =>
        cardMatchesFilter(c.name, filter),
      );
    }
    case "playFromCemetery": {
      const filter = effect.filter ?? {};
      return getPlayer(state, player).zones.cemetery.some((c) =>
        cardMatchesFilter(c.name, filter),
      );
    }
    case "discardFromHand": {
      const need = effect.count ?? 1;
      const matches = getPlayer(state, player).zones.hand.filter((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
      return matches.length >= need;
    }
    default:
      return true;
  }
}

export function canPlayCardFromZones(
  state: GameState,
  player: PlayerId,
  cardNo: string,
): boolean {
  const def = getCardDef(cardNo);
  if (!def) return false;
  // Crests enter EX via effects only — they are never played from hand/EX.
  if (def.cardType === "crest") return false;
  if (def.cardType === "spell") {
    const spell = def.abilities?.find((a) => a.timing === "spell");
    if (!spell) return false;
    if (spell.condition && !evalCondition(state, player, spell.condition)) return false;
    return canEffectResolve(state, player, spell.effect);
  }
  return true;
}

export function resolveSpell(state: GameState, cardNo: string, player: PlayerId): GameState {

  const def = getCardDef(cardNo);

  const spell = def?.abilities?.find((a) => a.timing === "spell");

  if (!spell) return state;

  return resolveEffect(state, spell.effect, player);

}


