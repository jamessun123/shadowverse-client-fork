import { getCardDef } from "../cards/registry";
import { describeAbility } from "./trigger-labels";
import { cardMatchesFilter } from "../state/conditions";
import { isBoxed } from "../state/passives";
import { findInstance, getPlayer, resolveCardNo } from "../state/queries";
import { matchesExAreaEntryFilter } from "../state/passives";
import { AbilityDefinition, CardInstance, GameState, PlayerId, TriggerTiming } from "../types";

function pushTrigger(
  state: GameState,
  instanceId: string,
  player: PlayerId,
  cardNo: string,
  ability: AbilityDefinition,
  timing: TriggerTiming,
  idPrefix: string,
  abilityKey?: string,
  forcedTargetId?: string,
): void {
  state.pendingTriggers.push({
    id: `${idPrefix}_${instanceId}_${state.pendingTriggers.length}`,
    controller: player,
    sourceInstanceId: instanceId,
    ability,
    timing,
    label: ability.label ?? describeAbility(cardNo, ability),
    abilityKey,
    forcedTargetId,
  });
}

function canFireLimitedTrigger(
  fieldCard: { abilitiesActivatedThisTurn: string[]; counters: Record<string, number> },
  key: string,
  opts: { oncePerTurn?: boolean; maxPerTurn?: number },
): boolean {
  if (opts.oncePerTurn && fieldCard.abilitiesActivatedThisTurn.includes(key)) return false;
  if (opts.maxPerTurn != null && (fieldCard.counters[key] ?? 0) >= opts.maxPerTurn) return false;
  return true;
}

function queueOnCardPlayedForCard(
  state: GameState,
  playedNo: string,
  player: PlayerId,
  fieldCard: CardInstance,
  idPrefix: string,
  matchTimings: ReadonlyArray<AbilityDefinition["timing"]> = ["onCardPlayed", "onCardPlayedOrFused"],
  queuedTiming: TriggerTiming = "onCardPlayed",
): void {
  if (isBoxed(fieldCard, state)) return;
  const cardNo = resolveCardNo(state, fieldCard);
  const def = getCardDef(cardNo);

  for (const [idx, ability] of (def?.abilities ?? []).entries()) {
    if (!matchTimings.includes(ability.timing)) continue;
    if (ability.filter && !cardMatchesFilter(playedNo, ability.filter)) continue;
    const key = `${queuedTiming}:${idx}`;
    if (!canFireLimitedTrigger(fieldCard, key, ability)) continue;
    pushTrigger(state, fieldCard.instanceId, player, cardNo, ability, queuedTiming, idPrefix, key);
  }

  // Passive grantOnCardPlayed is the hand-authored form of a persistent on-play trigger.
  // Fuse does not consume/fire these grants — only actual plays do.
  if (queuedTiming === "onCardPlayed") {
    for (const [idx, ability] of (def?.abilities ?? []).entries()) {
      if (ability.timing !== "passive" || ability.effect.op !== "grantOnCardPlayed") continue;
      const granted = ability.effect;
      if (granted.filter && !cardMatchesFilter(playedNo, granted.filter)) continue;
      const key = `onCardPlayed:${idx}`;
      if (
        !canFireLimitedTrigger(fieldCard, key, {
          oncePerTurn: granted.oncePerTurn,
          maxPerTurn: granted.maxPerTurn,
        })
      ) {
        continue;
      }
      const pseudoAbility: AbilityDefinition = {
        timing: "onCardPlayed",
        effect: granted.effect,
        label: granted.label,
        oncePerTurn: granted.oncePerTurn,
        maxPerTurn: granted.maxPerTurn,
      };
      pushTrigger(
        state,
        fieldCard.instanceId,
        player,
        cardNo,
        pseudoAbility,
        "onCardPlayed",
        idPrefix,
        key,
      );
    }

    for (const [gIdx, granted] of (fieldCard.grantedOnCardPlayed ?? []).entries()) {
      // playCostReduction grants discount the play cost up front and are consumed on play.
      if (granted.effect.op === "playCostReduction") continue;
      if (granted.filter && !cardMatchesFilter(playedNo, granted.filter)) continue;
      const key = `grantedOnCardPlayed:${gIdx}`;
      if (!canFireLimitedTrigger(fieldCard, key, granted)) continue;
      const pseudoAbility: AbilityDefinition = {
        timing: "onCardPlayed",
        effect: granted.effect,
        label: granted.label,
        oncePerTurn: granted.oncePerTurn,
        maxPerTurn: granted.maxPerTurn,
      };
      pushTrigger(
        state,
        fieldCard.instanceId,
        player,
        cardNo,
        pseudoAbility,
        "onCardPlayed",
        `g${idPrefix}`,
        key,
      );
    }
  }
}

export function queueOnCardPlayed(
  state: GameState,
  playedInstanceId: string,
  player: PlayerId,
): void {
  const played = findInstance(state, playedInstanceId);
  if (!played) return;
  const playedNo = resolveCardNo(state, played.card);
  const zones = getPlayer(state, player).zones;

  for (const fieldCard of zones.field) {
    queueOnCardPlayedForCard(state, playedNo, player, fieldCard, "ocp");
  }
  // Crests live in EX and can watch plays; amulets/spells waiting in EX do not.
  for (const exCard of zones.exArea) {
    const def = getCardDef(resolveCardNo(state, exCard));
    if (def?.cardType !== "crest") continue;
    queueOnCardPlayedForCard(state, playedNo, player, exCard, "ocpx");
  }
}

/** Queue watchers for a card that was fused into the EX area. */
export function queueOnCardFused(
  state: GameState,
  fusedInstanceId: string,
  player: PlayerId,
): void {
  const fused = findInstance(state, fusedInstanceId);
  if (!fused) return;
  const fusedNo = resolveCardNo(state, fused.card);
  const zones = getPlayer(state, player).zones;

  for (const fieldCard of zones.field) {
    queueOnCardPlayedForCard(
      state,
      fusedNo,
      player,
      fieldCard,
      "ocf",
      ["onCardFused", "onCardPlayedOrFused"],
      "onCardFused",
    );
  }
  for (const exCard of zones.exArea) {
    if (exCard.instanceId === fusedInstanceId) continue;
    const def = getCardDef(resolveCardNo(state, exCard));
    if (def?.cardType !== "crest") continue;
    queueOnCardPlayedForCard(
      state,
      fusedNo,
      player,
      exCard,
      "ocfx",
      ["onCardFused", "onCardPlayedOrFused"],
      "onCardFused",
    );
  }
}

export function queueLastWords(state: GameState, instanceId: string, player: PlayerId): void {
  const found = findInstance(state, instanceId);
  if (!found) return;
  if (isBoxed(found.card, state)) return;
  const cardNo = found.card.name;
  const def = getCardDef(cardNo);
  for (const ability of def?.abilities ?? []) {
    if (ability.timing === "lastWords") {
      pushTrigger(state, instanceId, player, cardNo, ability, "lastWords", "lw");
    }
  }
  for (const effect of found.card.grantedLastWords ?? []) {
    pushTrigger(
      state,
      instanceId,
      player,
      cardNo,
      {
        timing: "lastWords",
        effect,
        label: `${getCardDef(cardNo)?.name ?? cardNo} — Last Words: banish this card`,
      },
      "lastWords",
      "glw",
    );
  }
}

export function queueFanfare(state: GameState, instanceId: string, player: PlayerId): void {
  const found = findInstance(state, instanceId);
  if (!found || isBoxed(found.card, state)) return;
  const def = getCardDef(found.card.name);
  for (const ability of def?.abilities ?? []) {
    if (ability.timing === "fanfare") {
      pushTrigger(state, instanceId, player, found.card.name, ability, "fanfare", "ff");
    }
  }
}

export function queueStartOfEndAbilities(state: GameState, player: PlayerId): void {
  for (const card of [...getPlayer(state, player).zones.field]) {
    if (isBoxed(card, state)) continue;
    const def = getCardDef(resolveCardNo(state, card));
    for (const ability of def?.abilities ?? []) {
      if (ability.timing !== "startOfEnd") continue;
      pushTrigger(state, card.instanceId, player, card.name, ability, "startOfEnd", "soe");
    }
  }
}

export function queueStartOfMainAbilities(state: GameState, player: PlayerId): void {
  const zones = getPlayer(state, player).zones;
  for (const card of zones.field) {
    if (isBoxed(card, state)) continue;
    const def = getCardDef(resolveCardNo(state, card));
    for (const ability of def?.abilities ?? []) {
      if (ability.timing !== "startOfMain") continue;
      pushTrigger(state, card.instanceId, player, card.name, ability, "startOfMain", "som");
    }
  }
  // Only Crests trigger from EX. Amulets like Destruction in Black/White sit in EX
  // until played onto the field and must not fire start-of-main there.
  for (const card of zones.exArea) {
    if (isBoxed(card, state)) continue;
    const def = getCardDef(resolveCardNo(state, card));
    if (def?.cardType !== "crest") continue;
    for (const ability of def?.abilities ?? []) {
      if (ability.timing !== "startOfMain") continue;
      pushTrigger(state, card.instanceId, player, card.name, ability, "startOfMain", "som");
    }
  }
}

/** During the active player's turn, when a card leaves an opponent's deck into cemetery. */
export function queueOnOpponentDeckToCemetery(state: GameState): void {
  const player = state.activePlayer;
  for (const fieldCard of getPlayer(state, player).zones.field) {
    if (isBoxed(fieldCard, state)) continue;
    const def = getCardDef(resolveCardNo(state, fieldCard));
    for (const [idx, ability] of (def?.abilities ?? []).entries()) {
      if (ability.timing !== "onOpponentDeckToCemetery") continue;
      const key = `onOpponentDeckToCemetery:${idx}`;
      if (!canFireLimitedTrigger(fieldCard, key, ability)) continue;
      pushTrigger(
        state,
        fieldCard.instanceId,
        player,
        fieldCard.name,
        ability,
        "onOpponentDeckToCemetery",
        "odc",
        key,
      );
    }
  }
}

export function queueAllyFollowerEnterTriggers(
  state: GameState,
  enteredInstanceId: string,
  player: PlayerId,
): void {
  const entered = findInstance(state, enteredInstanceId);
  if (!entered || entered.zone !== "field") return;
  const enteredNo = resolveCardNo(state, entered.card);
  for (const fieldCard of getPlayer(state, player).zones.field) {
    if (fieldCard.instanceId === enteredInstanceId || isBoxed(fieldCard, state)) continue;
    const def = getCardDef(resolveCardNo(state, fieldCard));
    for (const [idx, ability] of (def?.abilities ?? []).entries()) {
      if (ability.timing !== "onAllyFollowerEnter") continue;
      if (ability.activateFrom === "cemetery") continue;
      if (ability.filter && !cardMatchesFilter(enteredNo, ability.filter)) continue;
      const key = `afe:${idx}`;
      if (!canFireLimitedTrigger(fieldCard, key, ability)) continue;
      pushTrigger(
        state,
        fieldCard.instanceId,
        player,
        fieldCard.name,
        ability,
        "onAllyFollowerEnter",
        "afe",
        key,
        enteredInstanceId,
      );
    }
  }
}

/** Cemetery cards that react when an ally follower enters (e.g. Delta Cannon + Tetra). */
export function queueCemeteryOnAllyFollowerEnter(
  state: GameState,
  enteredInstanceId: string,
  player: PlayerId,
): void {
  const entered = findInstance(state, enteredInstanceId);
  if (!entered || entered.zone !== "field") return;
  const enteredNo = resolveCardNo(state, entered.card);
  const enteredDef = getCardDef(enteredNo);
  if (enteredDef?.cardType !== "follower") return;

  for (const cemCard of getPlayer(state, player).zones.cemetery) {
    const cardNo = resolveCardNo(state, cemCard);
    const def = getCardDef(cardNo);
    for (const [idx, ability] of (def?.abilities ?? []).entries()) {
      if (ability.timing !== "onAllyFollowerEnter") continue;
      if (ability.activateFrom !== "cemetery") continue;
      if (ability.filter && !cardMatchesFilter(enteredNo, ability.filter)) continue;
      pushTrigger(
        state,
        cemCard.instanceId,
        player,
        cardNo,
        ability,
        "onAllyFollowerEnter",
        "cafe",
        `cafe:${idx}`,
        enteredInstanceId,
      );
    }
  }
}

/** Queue onAbilityDamageTaken for a follower that just took ability damage and survived. */
export function queueOnAbilityDamageTaken(
  state: GameState,
  instanceId: string,
): void {
  const found = findInstance(state, instanceId);
  if (!found || found.zone !== "field") return;
  // Most Disdain texts are "During your turn, whenever this takes ability damage…"
  if (state.activePlayer !== found.player) return;
  if (isBoxed(found.card, state)) return;
  const cardNo = resolveCardNo(state, found.card);
  const def = getCardDef(cardNo);
  for (const [idx, ability] of (def?.abilities ?? []).entries()) {
    if (ability.timing !== "onAbilityDamageTaken") continue;
    const key = `onAbilityDamageTaken:${idx}`;
    if (!canFireLimitedTrigger(found.card, key, ability)) continue;
    pushTrigger(
      state,
      found.card.instanceId,
      found.player,
      cardNo,
      ability,
      "onAbilityDamageTaken",
      "adt",
      key,
    );
  }
}

export function onCardEntersExAreaTriggers(
  state: GameState,
  instanceId: string,
  player: PlayerId,
): void {
  const entered = findInstance(state, instanceId);
  if (!entered || entered.zone !== "exArea") return;
  const enteredNo = resolveCardNo(state, entered.card);
  for (const fieldCard of getPlayer(state, player).zones.field) {
    if (isBoxed(fieldCard, state)) continue;
    const def = getCardDef(resolveCardNo(state, fieldCard));
    for (const ability of def?.abilities ?? []) {
      if (!matchesExAreaEntryFilter(ability, enteredNo)) continue;
      pushTrigger(
        state,
        fieldCard.instanceId,
        player,
        fieldCard.name,
        ability,
        "onExAreaEntry",
        `ex_${instanceId}`,
      );
    }
  }
}
