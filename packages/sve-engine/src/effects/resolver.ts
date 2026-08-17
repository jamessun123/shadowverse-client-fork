import { getCardDef, resolveTokenName } from "../cards/registry";
import { normalizeIdentityName } from "../cards/reprints";
import { placeLeavingPlay } from "../cards/tokens";

import { onCardEntersExArea, onFollowerEntersField, queueLastWords } from "../rules/confirmation";

import { runConfirmationTiming } from "../rules/confirmation";
import { describeEffect } from "../rules/trigger-labels";
import {
  queueOnDiscard,
  queueOnOpponentDeckToCemetery,
  queueOnAbilityDamageTaken,
  queueOnAbilityDamageDealt,
  queueOnEvolveAbilities,
} from "../rules/trigger-queue";
import { beginUnionBurstActivation, cancelPendingUnionBurst, commitPendingUnionBurst, recordUnionBurstActivated } from "../rules/union-burst";
import {
  finishDeferredTriggers,
  getChosenChooseIndices,
  getChosenChooseLabels,
  withChoiceContext,
} from "../rules/effect-utils";

import { cardMatchesFilter, evalCondition } from "../state/conditions";

import { createCardInstance } from "../state/factory";

import {
  clampDamageToFollower,
  fieldOccupancy,
  findInstance,
  findMatchingEvolveCard,
  getEffectiveStats,
  getPlayer,
  hasFieldSpace,
  hasKeyword,
  isEquippedAttachment,
  opponentOf,
  resolveCardDefCost,
  resolveCardNo,
  isFollowerCard,
} from "../state/queries";
import { isDestroyImmuneToAbilities } from "../state/passives";
import { resetCardInstanceState } from "../state/card-reset";
import { destroyFollower, drawCard, moveCard, shuffleDeck } from "../state/zones";
import {
  CardInstance,
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
    lastSelectedCardName: prev?.lastSelectedCardName,
    engagedAsCostCount: prev?.engagedAsCostCount,
    pendingUnionBurst: prev?.pendingUnionBurst,
    resolvingUnionBurstSourceId: prev?.resolvingUnionBurstSourceId,
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
  const matchesExtra = (c: CardInstance) => {
    const def = getCardDef(c.name);
    if (!def) return false;
    if ("trait" in selector && selector.trait && !def.traits?.includes(selector.trait)) {
      return false;
    }
    if ("cardType" in selector && selector.cardType && def.cardType !== selector.cardType) {
      return false;
    }
    if (
      "maxCost" in selector &&
      selector.maxCost != null &&
      resolveCardDefCost(resolveCardNo(state, c)) > selector.maxCost
    ) {
      return false;
    }
    if (
      "excludeIdentityName" in selector &&
      selector.excludeIdentityName &&
      normalizeIdentityName(def.name) === normalizeIdentityName(selector.excludeIdentityName)
    ) {
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
    case "enemyFieldCard":
      return getPlayer(state, enemy).zones.field
        .filter((c) => !isEquippedAttachment(c))
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
        .filter((c) => !isEquippedAttachment(c))
        .filter((c) => {
          if ("includeSelf" in selector && selector.includeSelf) return true;
          return c.instanceId !== state.resolutionContext?.sourceInstanceId;
        })
        .filter(matchesExtra)
        .map((c) => c.instanceId);
    case "lastSelected": {
      const id =
        state.resolutionContext?.lastSelectedTargetId ??
        state.resolutionContext?.forcedTargetId;
      return id ? [id] : [];
    }
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
    selector.type === "self" ||
    selector.type === "lastSelected"
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

  // "Whenever this deals ability damage to an enemy follower…" (e.g. Dark Axe Nachtfang).
  const sourceId = next.resolutionContext?.sourceInstanceId;
  if (sourceId) {
    queueOnAbilityDamageDealt(next, sourceId, instanceId);
  }

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
  if (amount.op === "cemeteryFilterCount") {
    return getPlayer(state, player).zones.cemetery.filter((c) =>
      cardMatchesFilter(resolveCardNo(state, c), amount.filter),
    ).length;
  }
  if (amount.op === "halfSourceAtk") {
    const sourceId = state.resolutionContext?.sourceInstanceId;
    if (!sourceId) return 0;
    const found = findInstance(state, sourceId);
    if (!found) return 0;
    let atkCard = found.card;
    if (found.card.equippedToInstanceId) {
      const host = findInstance(state, found.card.equippedToInstanceId);
      if (!host) return 0;
      atkCard = host.card;
    }
    return Math.ceil(getEffectiveStats(atkCard, state).atk / 2);
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
  to: "hand" | "exArea" | "field" | "cemetery",
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

  to: "hand" | "exArea" | "field" | "cemetery",

  optional?: boolean,

  playCostReduction?: number,

  remainderTo: "cemetery" | "deckBottom" | "deckTop" = "cemetery",

  reveal?: boolean,

  playCostReductionFilter?: DeckFilter,

): GameState {

  const next = structuredClone(state);

  const destLabel =
    to === "cemetery"
      ? "bury"
      : to === "hand"
        ? "add to hand"
        : to === "exArea"
          ? "put into EX"
          : "summon";

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
    reasonLabel: `Look at top — ${destLabel} if matching`,
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
  if (filter.anyOf?.length) {
    return filter.anyOf.map((alt) => describeDeckFilter(alt)).join(" or ");
  }
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
  remainderTo: "cemetery" | "deckBottom" | "shuffle",
  maxCount?: number,
  to: "field" | "exArea" | "hand" = "field",
  reveal?: boolean,
  distinctNames?: boolean,
  playCostReduction?: number,
): GameState {
  const next = structuredClone(state);
  const filterLabel = describeDeckFilter(filter);
  const destLabel =
    to === "exArea" ? "into your EX area" : to === "hand" ? "into your hand" : "onto your field";
  const countLabel =
    maxCount != null ? `up to ${maxCount} ${filterLabel}` : filterLabel;
  const distinctLabel = distinctNames ? " with different names" : "";
  const costLabel =
    maxTotalCost != null ? ` (total cost ${maxTotalCost} or less)` : "";
  const remainderLabel =
    remainderTo === "shuffle"
      ? " Then shuffle your deck."
      : remainderTo === "deckBottom"
        ? " Unselected cards go to the bottom of your deck."
        : " Unselected cards go to the cemetery.";
  next.pendingChoices = withChoiceContext(next, {
    type: "selectDeckSummon",
    player,
    maxTotalCost,
    maxCount,
    distinctNames,
    playCostReduction,
    to,
    filter,
    topInstanceIds: top.map((c) => c.instanceId),
    remainderTo,
    reveal,
    reasonLabel: `Select ${countLabel}${distinctLabel} to put ${destLabel}${costLabel}.${remainderLabel}`,
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

    placeLeavingPlay(p.zones, card, "cemetery");

    next.eventLog.push({ type: "bury", player });

  }

  return next;

}



export function moveZoneCardTo(

  state: GameState,

  player: PlayerId,

  instanceId: string,

  fromZone: "deck" | "cemetery" | "hand" | "evolveDeck",

  to: "hand" | "exArea" | "field" | "cemetery",

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

    if (!hasFieldSpace(p.zones.field, p.fieldLimit)) {
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

  } else if (to === "cemetery") {

    placeLeavingPlay(p.zones, card, "cemetery");

    next.eventLog.push({ type: "bury", player });

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
  if (next.resolutionContext) {
    next.resolutionContext.lastSelectedTargetId = picked.targetId!;
  }
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
      lastSelectedCardName: next.resolutionContext?.lastSelectedCardName,
      engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
      pendingUnionBurst: next.resolutionContext?.pendingUnionBurst,
      resolvingUnionBurstSourceId: next.resolutionContext?.resolvingUnionBurstSourceId,
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
        placeLeavingPlay(p.zones, buried, "cemetery");
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

      const sourceDamageBonus = (): number => {
        const sourceId = next.resolutionContext?.sourceInstanceId;
        if (!sourceId) return 0;
        const src = findInstance(next, sourceId);
        if (!src) return 0;
        return (
          (src.card.damageDealtBonus ?? 0) +
          src.card.modifiers.reduce((sum, m) => sum + (m.damageDealtBonus ?? 0), 0)
        );
      };

      const applyTo = (targetId: string, damageOverride?: number) => {
        let damage =
          damageOverride ?? resolveDamageAmount(next, player, effect.amount) + sourceDamageBonus();
        if (targetId === "leader") {
          next = dealDamageToLeader(next, opponentOf(player), damage);
        } else if (targetId === "selfLeader") {
          next = dealDamageToLeader(next, player, damage);
        } else {
          next = dealDamageToFollower(next, targetId, damage);
        }
      };

      const applyDivided = (targetIds: string[]) => {
        if (targetIds.length === 0) return;
        const total =
          resolveDamageAmount(next, player, effect.amount) + sourceDamageBonus();
        if (targetIds.length > total) return;
        const damages = targetIds.map(() => 1);
        let rem = total - targetIds.length;
        for (let i = 0; rem > 0; i += 1, rem -= 1) {
          damages[i % targetIds.length] += 1;
        }
        for (let i = 0; i < targetIds.length; i += 1) {
          applyTo(targetIds[i], damages[i]);
        }
      };

      if (forcedIds) {
        if (effect.divided) {
          applyDivided(forcedIds);
        } else {
          for (const targetId of forcedIds) {
            applyTo(targetId);
          }
        }
        break;
      }

      if (candidates.length === 0) break;

      const bounds = targetSelectionBounds(effect.targets);
      // Divided damage cannot target more followers than damage points.
      if (effect.divided) {
        const total =
          resolveDamageAmount(next, player, effect.amount) + sourceDamageBonus();
        bounds.max = Math.min(bounds.max, Math.max(0, total));
      }
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
      if (next.resolutionContext && picked.targetId) {
        next.resolutionContext.lastSelectedTargetId = picked.targetId;
      }
      if (effect.divided) {
        applyDivided([picked.targetId!]);
      } else {
        applyTo(picked.targetId!);
      }

      break;

    }



    case "buffFieldTrait": {
      const p = next.players[player];
      const sourceId = next.resolutionContext?.sourceInstanceId || "effect";
      for (const card of p.zones.field) {
        if (effect.excludeSelf && card.instanceId === sourceId) continue;
        const def = getCardDef(card.name);
        if (effect.trait && !def?.traits?.includes(effect.trait)) continue;
        // Atk/def buffs only apply to followers; amulets may still receive keywords.
        if (def?.cardType === "follower" && (effect.atk || effect.def)) {
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

      if (next.resolutionContext) {
        next.resolutionContext.lastSelectedTargetId = targetId;
      }

      const atkAmt = effect.atk == null ? 0 : resolveDamageAmount(next, player, effect.atk);
      const defAmt = effect.def == null ? 0 : resolveDamageAmount(next, player, effect.def);

      if (targetId === "selfLeader") {
        next.players[player].leaderDef += defAmt;
        break;
      }
      if (targetId === "leader") {
        next.players[opponentOf(player)].leaderDef += defAmt;
        break;
      }

      const found = findInstance(next, targetId);

      if (found && isFollowerCard(found.card, next)) {

        found.card.modifiers.push({

          atk: atkAmt,

          def: defAmt,

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

      const target = findInstance(next, targetId);
      if (target && isDestroyImmuneToAbilities(next, target.card, target.player)) break;

      queueLastWords(next, targetId, player);

      next = destroyFollower(next, targetId);

      break;

    }



    case "summon": {

      const p = next.players[player];

      const zone = effect.zone === "exArea" ? p.zones.exArea : p.zones.field;

      const hasRoom = () =>
        effect.zone === "exArea"
          ? zone.length < p.exLimit
          : hasFieldSpace(zone, p.fieldLimit);

      for (let i = 0; i < effect.count && hasRoom(); i++) {
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

        placeLeavingPlay(next.players[player].zones, card, "cemetery");

        queueOnDiscard(next, card.instanceId, player);

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
        if (card) placeLeavingPlay(next.players[opp].zones, card, "cemetery");
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

    case "commitPendingUnionBurst":
      next = commitPendingUnionBurst(next);
      break;

    case "optionalCost": {
      if (!canSatisfyOptionalCost(next, player, effect.cost)) {
        next = cancelPendingUnionBurst(next);
        break;
      }
      if (!next.pendingChoices) {
        next.pendingChoices = withChoiceContext(next, {
          type: "choose",
          player,
          min: 1,
          max: 1,
          reasonLabel: effect.label ?? "Optional effect",
          commitUnionBurstOnPay: Boolean(next.resolutionContext?.pendingUnionBurst),
          options: [
            {
              index: 0,
              label: effect.label ?? "Pay cost",
              effect: {
                op: "sequence",
                steps: [effect.cost, { op: "commitPendingUnionBurst" }, effect.then],
              },
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
        lastSelectedCardName: next.resolutionContext?.lastSelectedCardName,
        engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
        pendingUnionBurst: next.resolutionContext?.pendingUnionBurst,
        resolvingUnionBurstSourceId: next.resolutionContext?.resolvingUnionBurstSourceId,
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
              canChooseOptionResolve(next, player, o.effect),
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

        placeLeavingPlay(next.players[player].zones, card, "cemetery");

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

        placeLeavingPlay(next.players[opp].zones, card, "cemetery");

        next.eventLog.push({ type: "millOpponent", player, data: { name: card.name } });

        // Track for follow-up conditions (e.g. Arsène Lupin fanfare loot).
        next.resolutionContext = {
          ...next.resolutionContext,
          sourceInstanceId: next.resolutionContext?.sourceInstanceId,
          effectStack: next.resolutionContext?.effectStack ?? [],
          lastDiscardedCardName: card.name,
        };

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

      const matches = p.zones.cemetery.filter((c) =>
        cardMatchesFilter(c.name, effect.filter, next),
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
      let amount = 1;
      if (effect.amount === "maxPp") {
        amount = next.players[player].maxPp;
      } else if (typeof effect.amount === "number") {
        amount = effect.amount;
      }
      const current = found.card.persistentCounters[effect.key] ?? 0;
      let nextCount = current + amount;
      if (effect.max != null) nextCount = Math.min(nextCount, effect.max);
      found.card.persistentCounters[effect.key] = nextCount;
      break;
    }

    case "removePersistentCounter": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      if (!sourceId) break;
      const found = findInstance(next, sourceId);
      if (!found?.card.persistentCounters) break;
      const amount = effect.amount ?? 1;
      const current = found.card.persistentCounters[effect.key] ?? 0;
      found.card.persistentCounters[effect.key] = Math.max(0, current - amount);
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

      // Effect evolves (e.g. Adherent of Hollowness fanfare) grant Rush via
      // card.evolvedThisTurn but must not consume the once-per-turn evolve action.
      next.players[player].zones.evolveZone.push({

        fieldInstanceId: sourceId,

        evolveInstanceId: evoCard.instanceId,

      });

      if (effect.triggerOnEvolve === true) {
        queueOnEvolveAbilities(next, sourceId, player, false);
      }

      break;

    }



    case "tutorFromDeck": {

      const p = next.players[player];

      const matches = p.zones.deck.filter((c) =>
        cardMatchesFilter(c.name, effect.filter, next),
      );

      if (matches.length === 0) break;

      if (!next.pendingChoices) {

        return promptSelectZoneCard(
          next,
          player,
          "deck",
          effect.to,
          matches,
          effect.optional,
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
      const forced = next.resolutionContext?.forcedTargetId;
      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection(effect.targets, candidates) && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, effect, candidates);
      }
      const found = findInstance(next, picked.targetId!);
      if (found) {
        found.card.engaged = true;
        if (effect.skipRefreshNextStart) {
          found.card.skipRefreshNextStart = true;
        }
      }
      break;
    }

    case "refreshFollower": {
      const candidates = getTargetCandidates(next, player, effect.targets);
      if (candidates.length === 0) break;
      const forced = next.resolutionContext?.forcedTargetId;
      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection(effect.targets, candidates) && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, effect, candidates);
      }
      const found = findInstance(next, picked.targetId!);
      if (found) {
        if (next.resolutionContext) {
          next.resolutionContext.lastSelectedTargetId = picked.targetId!;
        }
        found.card.engaged = false;
        found.card.onFieldSinceTurnStart = true;
        found.card.skipRefreshNextStart = undefined;
      }
      break;
    }

    case "cannotAttack": {
      const targets = effect.targets ?? { type: "selfFollower" as const, count: 1 };
      const candidates = getTargetCandidates(next, player, targets);
      if (candidates.length === 0) break;
      const forced = next.resolutionContext?.forcedTargetId;
      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection(targets, candidates) && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, { ...effect, targets }, candidates);
      }
      const found = findInstance(next, picked.targetId!);
      if (found) {
        if (next.resolutionContext) {
          next.resolutionContext.lastSelectedTargetId = picked.targetId!;
        }
        found.card.cannotAttack = true;
        if (effect.untilEndOfTurn !== false) {
          found.card.modifiers.push({
            sourceId: next.resolutionContext?.sourceInstanceId || "cannotAttack",
            untilEndOfTurn: true,
            cannotAttack: true,
          });
        }
      }
      break;
    }

    case "equip": {
      const hostTargets = effect.targets ?? { type: "self" as const };
      const candidates = getTargetCandidates(next, player, hostTargets);
      if (candidates.length === 0) break;
      const forced = next.resolutionContext?.forcedTargetId;
      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection(hostTargets, candidates) && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, { ...effect, targets: hostTargets }, candidates);
      }
      const hostId = picked.targetId!;
      const host = findInstance(next, hostId);
      if (!host || host.zone !== "field") break;
      // Equipment attaches to the host and does not consume a board slot.

      const tokenName = resolveTokenName(effect.tokenName);
      const token = createCardInstance(tokenName, player, player);
      token.equippedToInstanceId = hostId;
      next.players[player].zones.field.push(token);
      if (!host.card.equippedInstanceIds) host.card.equippedInstanceIds = [];
      // Re-find host after possible clone issues — host is on next already
      const hostLive = findInstance(next, hostId);
      if (!hostLive) break;
      if (!hostLive.card.equippedInstanceIds) hostLive.card.equippedInstanceIds = [];
      hostLive.card.equippedInstanceIds.push(token.instanceId);

      const eqDef = getCardDef(token.name);
      for (const ability of eqDef?.abilities ?? []) {
        if (ability.timing === "passive" && ability.effect.op === "equipPassive") {
          const ep = ability.effect;
          if (ep.atk || ep.def || ep.damageDealtBonus || ep.damageTakenReduction) {
            hostLive.card.modifiers.push({
              atk: ep.atk ?? 0,
              def: ep.def ?? 0,
              sourceId: token.instanceId,
              damageDealtBonus: ep.damageDealtBonus,
              damageTakenReduction: ep.damageTakenReduction,
            });
          }
          if (ep.damageDealtBonus) {
            hostLive.card.damageDealtBonus =
              (hostLive.card.damageDealtBonus ?? 0) + ep.damageDealtBonus;
          }
          if (ep.damageTakenReduction) {
            hostLive.card.damageTakenReduction =
              (hostLive.card.damageTakenReduction ?? 0) + ep.damageTakenReduction;
          }
          for (const kw of ep.keywords ?? []) {
            if (!hostLive.card.grantedKeywords.includes(kw)) {
              hostLive.card.grantedKeywords.push(kw);
            }
          }
        }
        // Card text: "The follower equipped with this has … when you play a spell…"
        // Mirror equipment onCardPlayed watchers onto the host so they fire with the
        // follower as source (half-attack, max-per-turn, etc.).
        if (ability.timing === "onCardPlayed" || ability.timing === "onCardPlayedOrFused") {
          if (!hostLive.card.grantedOnCardPlayed) hostLive.card.grantedOnCardPlayed = [];
          hostLive.card.grantedOnCardPlayed.push({
            filter: ability.filter,
            effect: ability.effect,
            oncePerTurn: ability.oncePerTurn,
            maxPerTurn: ability.maxPerTurn,
            label: ability.label ?? eqDef?.name,
            sourceId: token.instanceId,
          });
        }
        if (ability.timing === "onEquip") {
          const prevCtx = next.resolutionContext;
          next.resolutionContext = {
            sourceInstanceId: token.instanceId,
            effectStack: [ability.effect],
            forcedTargetId: hostId,
          };
          next = resolveEffect(next, ability.effect, player);
          next.resolutionContext = prevCtx;
        }
      }
      break;
    }

    case "activateUnionBurst": {
      const candidates = getTargetCandidates(next, player, effect.targets);
      if (candidates.length === 0) break;
      const forced = next.resolutionContext?.forcedTargetId;
      const picked = pickTargetFromCandidates(
        forced,
        candidates,
        shouldPromptTargetSelection(effect.targets, candidates) && !next.pendingChoices,
      );
      if (picked.needsPrompt) {
        return promptSelectTarget(next, player, effect, candidates);
      }
      const target = findInstance(next, picked.targetId!);
      if (!target || target.zone !== "field") break;
      const def = getCardDef(resolveCardNo(next, target.card));
      const ub = def?.abilities?.find((a) => a.unionBurst);
      if (!ub) break;
      let toResolve = ub.effect;
      if (effect.skipCost && toResolve.op === "optionalCost") {
        toResolve = toResolve.then;
      }
      const prevCtx = next.resolutionContext;
      next.resolutionContext = {
        sourceInstanceId: target.card.instanceId,
        effectStack: [toResolve],
        resumeAfterChoice: prevCtx?.resumeAfterChoice,
        resumeOwnerInstanceId: prevCtx?.resumeOwnerInstanceId ?? prevCtx?.sourceInstanceId,
        pendingUnionBurst: prevCtx?.pendingUnionBurst,
        resolvingUnionBurstSourceId: target.card.instanceId,
        deferTriggers: prevCtx?.deferTriggers,
      };
      if (effect.skipCost || ub.effect.op !== "optionalCost") {
        next = recordUnionBurstActivated(next, player, target.card.instanceId, ub);
      } else {
        next = beginUnionBurstActivation(next, player, target.card.instanceId, ub);
      }
      next = resolveEffect(next, toResolve, player);
      if (next.pendingChoices || (next.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0) {
        // Nested UB paused — keep its context (plus any stashed parent UB).
        break;
      }
      next.resolutionContext = prevCtx;
      break;
    }

    case "equipPassive":
      break;

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

        placeLeavingPlay(p.zones, card, "banish");

      }

      break;

    }



    case "banishCemeteryDistinctCosts": {

      const p = next.players[player];

      // One card per base cost, cheapest first, so a card that could cover two
      // costs is never spent on the wrong one.
      for (let cost = effect.from; cost <= effect.to; cost++) {

        const idx = p.zones.cemetery.findIndex((c) => resolveCardDefCost(c.name) === cost);

        if (idx < 0) continue;

        const [card] = p.zones.cemetery.splice(idx, 1);

        placeLeavingPlay(p.zones, card, "banish");

      }

      break;

    }



    case "banishFromExArea": {

      const p = next.players[player];

      for (let i = 0; i < effect.count; i++) {

        const idx = p.zones.exArea.findIndex((c) => cardMatchesFilter(c.name, effect.filter));

        if (idx < 0) break;

        const [card] = p.zones.exArea.splice(idx, 1);

        resetCardInstanceState(card);

        placeLeavingPlay(p.zones, card, "banish");

      }

      break;

    }



    case "reviveSelfFromCemetery": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const p = next.players[player];

      const idx = p.zones.cemetery.findIndex((c) => c.instanceId === sourceId);

      if (idx < 0 || !hasFieldSpace(p.zones.field, p.fieldLimit)) break;

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

      // resolutionZone covers a spell moving itself into EX as part of its own effect.
      let fromZone: "cemetery" | "hand" | "resolutionZone" | null = null;
      let idx = -1;
      for (const candidate of ["cemetery", "hand", "resolutionZone"] as const) {
        idx = p.zones[candidate].findIndex((c) => c.instanceId === sourceId);
        if (idx >= 0) {
          fromZone = candidate;
          break;
        }
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

        placeLeavingPlay(p.zones, card, "cemetery");

        queueOnDiscard(next, card.instanceId, player);

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

      placeLeavingPlay(p.zones, card, "banish");

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

    case "burySelfIfInExArea": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      if (!sourceId) break;
      const found = findInstance(next, sourceId);
      if (!found || found.zone !== "exArea") break;
      next = moveCard(next, sourceId, "cemetery", found.player);
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

    case "grantStartOfEnd": {
      const targets = effect.targets ?? { type: "lastSelected" as const };
      const candidates = getTargetCandidates(next, player, targets);
      if (candidates.length === 0) break;
      for (const targetId of candidates) {
        if (targetId === "leader" || targetId === "selfLeader") continue;
        const found = findInstance(next, targetId);
        if (!found) continue;
        if (!found.card.grantedStartOfEnd) found.card.grantedStartOfEnd = [];
        found.card.grantedStartOfEnd.push({
          effect: effect.effect,
          label: effect.label,
        });
      }
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

      if (!hasFieldSpace(p.zones.field, p.fieldLimit)) break;

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
      const toZone = effect.to ?? "field";

      if (toZone === "field") {
        const slots = p.fieldLimit - fieldOccupancy(p.zones.field);
        if (slots <= 0) break;
      }

      const toSummon = Math.min(effect.count, toZone === "field"
        ? p.fieldLimit - fieldOccupancy(p.zones.field)
        : effect.count);

      const matches = p.zones.cemetery.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) break;

      // Always prompt — auto-summoning the first N cards skips "select" / distinct-name rules.
      if (!next.pendingChoices) {
        const pick = structuredClone(next);
        pick.pendingChoices = withChoiceContext(pick, {
          type: "selectCemeterySummon",
          player,
          count: toSummon,
          minCount:
            effect.minCount ?? (effect.maxTotalCost != null ? 1 : 0),
          maxTotalCost: effect.maxTotalCost,
          distinctNames: effect.distinctNames,
          filter: effect.filter,
          to: toZone,
          playCostReduction: effect.playCostReduction,
          options: matches.map((c) => ({
            instanceId: c.instanceId,
            name: c.name,
            label: getCardDef(c.name)?.name || c.name,
            cost: resolveCardDefCost(c.name),
          })),
        });
        return pick;
      }

      break;

    }



    case "searchDeckSummonMultiple": {
      const p = next.players[player];
      const fullDeck = effect.lookAt == null;
      const top = fullDeck
        ? p.zones.deck.filter((c) => cardMatchesFilter(c.name, effect.filter, next))
        : p.zones.deck.slice(0, effect.lookAt);
      if (top.length === 0) break;
      if (!next.pendingChoices) {
        return promptSelectDeckSummon(
          next,
          player,
          top,
          effect.filter,
          effect.maxTotalCost,
          effect.remainderTo ?? (fullDeck ? "shuffle" : "deckBottom"),
          effect.maxCount,
          effect.to ?? "field",
          effect.reveal,
          effect.distinctNames,
          effect.playCostReduction,
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
      const skipId = effect.excludeLastSelected
        ? next.resolutionContext?.lastSelectedTargetId
        : undefined;
      if (!followersOnly) {
        next = dealDamageToLeader(next, opp, amount);
      }
      if (!leadersOnly) {
        for (const card of [...next.players[opp].zones.field]) {
          if (skipId && card.instanceId === skipId) continue;
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



/**
 * Whether a choose-modal option should be offered. Pure if-then options (no else)
 * are gated on the condition so text like "if you've activated 2 other UBs…"
 * does not appear as a selectable no-op.
 */
export function canChooseOptionResolve(
  state: GameState,
  player: PlayerId,
  effect: Effect,
): boolean {
  if (effect.op === "if" && !effect.else) {
    return (
      evalCondition(state, player, effect.condition) &&
      canEffectResolve(state, player, effect.then)
    );
  }
  return canEffectResolve(state, player, effect);
}

export function canEffectResolve(state: GameState, player: PlayerId, effect: Effect): boolean {
  switch (effect.op) {
    case "buff":
    case "dealDamage":
    case "engage":
    case "box":
    case "destroy":
    case "refreshFollower":
    case "cannotAttack":
    case "equip":
    case "activateUnionBurst":
    case "grantKeyword": {
      if (
        "targets" in effect &&
        effect.targets &&
        effect.targets.type === "lastSelected"
      ) {
        // Prior step in a sequence will supply the target at resolve time.
        return true;
      }
      if (
        (effect.op === "dealDamage" ||
          effect.op === "buff" ||
          effect.op === "engage" ||
          effect.op === "box" ||
          effect.op === "destroy" ||
          effect.op === "refreshFollower" ||
          effect.op === "cannotAttack" ||
          effect.op === "equip" ||
          effect.op === "activateUnionBurst" ||
          effect.op === "grantKeyword") &&
        "targets" in effect &&
        effect.targets &&
        "minCount" in effect.targets &&
        effect.targets.minCount === 0
      ) {
        return true;
      }
      if (!("targets" in effect) || !effect.targets) {
        if (effect.op === "cannotAttack" || effect.op === "equip") {
          return getTargetCandidates(state, player, { type: "self" }).length > 0;
        }
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
      // Optional-cost fanfares (e.g. "2PP: Equip…") must not be offered when the
      // cost cannot be paid — resolveEffect would silently no-op.
      return (
        canSatisfyOptionalCost(state, player, effect.cost) &&
        canEffectResolve(state, player, effect.then)
      );
    case "choose":
    case "chooseMultiple":
      return effect.options.some(
        (o) =>
          (!o.additionalPpCost || state.players[player].pp >= o.additionalPpCost) &&
          canChooseOptionResolve(state, player, o.effect),
      );
    case "tutorFromDeck": {
      if (effect.optional) return true;
      return getPlayer(state, player).zones.deck.some((c) =>
        cardMatchesFilter(c.name, effect.filter, state),
      );
    }
    case "tutorFromCemetery": {
      return getPlayer(state, player).zones.cemetery.some((c) =>
        cardMatchesFilter(c.name, effect.filter, state),
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
    case "summonFromCemetery": {
      const min = effect.minCount ?? (effect.maxTotalCost != null ? 1 : 0);
      if (min === 0) return true;
      return getPlayer(state, player).zones.cemetery.some((c) => {
        if (!cardMatchesFilter(c.name, effect.filter, state)) return false;
        if (effect.maxTotalCost != null && resolveCardDefCost(c.name) > effect.maxTotalCost) {
          return false;
        }
        return true;
      });
    }
    case "discardFromHand": {
      const need = effect.count ?? 1;
      const matches = getPlayer(state, player).zones.hand.filter((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
      return matches.length >= need;
    }
    case "banishFromCemetery": {
      const need = effect.count ?? 1;
      return (
        getPlayer(state, player).zones.cemetery.filter((c) =>
          cardMatchesFilter(c.name, effect.filter),
        ).length >= need
      );
    }
    case "banishFromExArea": {
      const need = effect.count ?? 1;
      return (
        getPlayer(state, player).zones.exArea.filter((c) =>
          cardMatchesFilter(c.name, effect.filter),
        ).length >= need
      );
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


