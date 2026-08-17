import { getCardDef } from "../cards/registry";
import { describeAbility } from "./trigger-labels";
import { cardMatchesFilter, evalCondition } from "../state/conditions";
import { isBoxed } from "../state/passives";
import { findInstance, getPlayer, isEquippedAttachment, isFollowerCard, resolveCardNo } from "../state/queries";
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
  /** Instance that was just played — never lets that card watch its own play. */
  playedInstanceId?: string,
): void {
  if (isBoxed(fieldCard, state)) return;
  // Defensive: a card's own on-play watchers are not active for its own play.
  if (playedInstanceId && fieldCard.instanceId === playedInstanceId) return;
  const cardNo = resolveCardNo(state, fieldCard);
  const def = getCardDef(cardNo);

  for (const [idx, ability] of (def?.abilities ?? []).entries()) {
    if (!matchTimings.includes(ability.timing)) continue;
    if (ability.filter && !cardMatchesFilter(playedNo, ability.filter, state)) continue;
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
  /** Fallback when the played card was already eliminated (e.g. token spell). */
  playedCardName?: string,
): void {
  const played = findInstance(state, playedInstanceId);
  const playedNo = played
    ? resolveCardNo(state, played.card)
    : playedCardName
      ? (getCardDef(playedCardName)?.name ?? playedCardName)
      : undefined;
  if (!playedNo) return;
  const zones = getPlayer(state, player).zones;

  for (const fieldCard of zones.field) {
    // Equipment tokens grant their on-play watchers to the host on equip.
    // Skip them here so those abilities do not double-fire.
    if (isEquippedAttachment(fieldCard)) continue;
    queueOnCardPlayedForCard(
      state,
      playedNo,
      player,
      fieldCard,
      "ocp",
      undefined,
      undefined,
      playedInstanceId,
    );
  }
  // Crests live in EX and can watch plays; amulets/spells waiting in EX do not.
  for (const exCard of zones.exArea) {
    const def = getCardDef(resolveCardNo(state, exCard));
    if (def?.cardType !== "crest") continue;
    queueOnCardPlayedForCard(
      state,
      playedNo,
      player,
      exCard,
      "ocpx",
      undefined,
      undefined,
      playedInstanceId,
    );
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
    if (isEquippedAttachment(fieldCard)) continue;
    queueOnCardPlayedForCard(
      state,
      fusedNo,
      player,
      fieldCard,
      "ocf",
      ["onCardFused", "onCardPlayedOrFused"],
      "onCardFused",
      fusedInstanceId,
    );
  }
  for (const exCard of zones.exArea) {
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
      fusedInstanceId,
    );
  }
}

/** Queue "When this card is discarded" abilities for a card now in the cemetery. */
export function queueOnDiscard(state: GameState, instanceId: string, player: PlayerId): void {
  const found = findInstance(state, instanceId);
  if (!found || found.zone !== "cemetery") return;
  const cardNo = found.card.name;
  const def = getCardDef(cardNo);
  for (const ability of def?.abilities ?? []) {
    if (ability.timing !== "onDiscard") continue;
    pushTrigger(state, instanceId, player, cardNo, ability, "onDiscard", "od");
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

/** Queue On Evolve / On Super Evolve so Union Burst flags survive confirmation. */
export function queueOnEvolveAbilities(
  state: GameState,
  instanceId: string,
  player: PlayerId,
  includeSuperEvolve = false,
): void {
  const found = findInstance(state, instanceId);
  if (!found || isBoxed(found.card, state)) return;
  const def = getCardDef(resolveCardNo(state, found.card));
  for (const ability of def?.abilities ?? []) {
    if (ability.timing === "onEvolve") {
      pushTrigger(state, instanceId, player, found.card.name, ability, "onEvolve", "oe");
    }
    if (includeSuperEvolve && ability.timing === "onSuperEvolve") {
      pushTrigger(state, instanceId, player, found.card.name, ability, "onSuperEvolve", "ose");
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
    for (const [idx, granted] of (card.grantedStartOfEnd ?? []).entries()) {
      const ability: AbilityDefinition = {
        timing: "startOfEnd",
        effect: granted.effect,
        label: granted.label,
      };
      pushTrigger(
        state,
        card.instanceId,
        player,
        card.name,
        ability,
        "startOfEnd",
        `gsoe${idx}`,
      );
    }
  }
  // Start-of-end on EX cards, printed (e.g. Chain Lightning: bury itself) or
  // granted (e.g. Kyoka: bury if still in EX).
  for (const card of [...getPlayer(state, player).zones.exArea]) {
    if (isBoxed(card, state)) continue;
    const def = getCardDef(resolveCardNo(state, card));
    for (const ability of def?.abilities ?? []) {
      if (ability.timing !== "startOfEnd") continue;
      pushTrigger(state, card.instanceId, player, card.name, ability, "startOfEnd", "soe");
    }
    for (const [idx, granted] of (card.grantedStartOfEnd ?? []).entries()) {
      const ability: AbilityDefinition = {
        timing: "startOfEnd",
        effect: granted.effect,
        label: granted.label,
      };
      pushTrigger(
        state,
        card.instanceId,
        player,
        card.name,
        ability,
        "startOfEnd",
        `gsoe${idx}`,
      );
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

/** Queue onAbilityDamageTaken after a follower takes ability damage (even if it dies to it). */
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

/**
 * Queue onAbilityDamageDealt after a follower deals ability damage to an enemy follower.
 * Equipment attached to the dealer can also carry this timing (e.g. Dark Axe Nachtfang).
 */
export function queueOnAbilityDamageDealt(
  state: GameState,
  sourceInstanceId: string,
  damagedInstanceId: string,
): void {
  const damaged = findInstance(state, damagedInstanceId);
  if (!damaged || damaged.zone !== "field") return;
  if (!isFollowerCard(damaged.card, state)) return;

  const source = findInstance(state, sourceInstanceId);
  if (!source) return;

  let dealer = source;
  if (source.card.equippedToInstanceId) {
    const host = findInstance(state, source.card.equippedToInstanceId);
    if (!host || host.zone !== "field") return;
    dealer = host;
  }
  if (dealer.zone !== "field" || !isFollowerCard(dealer.card, state)) return;
  if (damaged.player === dealer.player) return;
  if (isBoxed(dealer.card, state)) return;

  const queueFrom = (card: CardInstance, idPrefix: string) => {
    const cardNo = resolveCardNo(state, card);
    const def = getCardDef(cardNo);
    for (const [idx, ability] of (def?.abilities ?? []).entries()) {
      if (ability.timing !== "onAbilityDamageDealt") continue;
      const key = `onAbilityDamageDealt:${idx}`;
      if (!canFireLimitedTrigger(card, key, ability)) continue;
      pushTrigger(
        state,
        card.instanceId,
        dealer.player,
        cardNo,
        ability,
        "onAbilityDamageDealt",
        idPrefix,
        key,
        damagedInstanceId,
      );
    }
  };

  queueFrom(dealer.card, "add");
  for (const eqId of dealer.card.equippedInstanceIds ?? []) {
    const eq = findInstance(state, eqId);
    if (!eq) continue;
    queueFrom(eq.card, "adde");
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

/** Queue onUnionBurstActivated abilities on other ally field followers. */
export function queueOnUnionBurstActivated(
  state: GameState,
  activatorInstanceId: string,
  player: PlayerId,
): void {
  const activator = findInstance(state, activatorInstanceId);
  // Card text is keyed off another follower's Union Burst.
  if (!activator || activator.zone !== "field" || !isFollowerCard(activator.card, state)) {
    return;
  }
  for (const fieldCard of getPlayer(state, player).zones.field) {
    if (fieldCard.instanceId === activatorInstanceId) continue;
    if (isEquippedAttachment(fieldCard)) continue;
    if (isBoxed(fieldCard, state)) continue;
    if (isEquippedAttachment(fieldCard)) continue;
    if (!isFollowerCard(fieldCard, state)) continue;
    const def = getCardDef(resolveCardNo(state, fieldCard));
    for (const [idx, ability] of (def?.abilities ?? []).entries()) {
      if (ability.timing !== "onUnionBurstActivated") continue;
      const key = `onUnionBurstActivated:${idx}`;
      if (!canFireLimitedTrigger(fieldCard, key, ability)) continue;
      if (ability.condition && !evalCondition(state, player, ability.condition)) continue;
      pushTrigger(
        state,
        fieldCard.instanceId,
        player,
        fieldCard.name,
        ability,
        "onUnionBurstActivated",
        "ub",
        key,
        activatorInstanceId,
      );
    }
  }
}
