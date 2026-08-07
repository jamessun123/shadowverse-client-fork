import { getCardDef } from "../cards/registry";
import { CardInstance, GameState, PlayerId, PlayerState } from "../types";

let idCounter = 0;
export function nextId(prefix = "c"): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Create a card instance. Accepts an exact card name, or a legacy printing
 * code which is resolved to the gameplay name.
 */
export function createCardInstance(
  nameOrCardNo: string,
  owner: PlayerId,
  controller?: PlayerId,
): CardInstance {
  const def = getCardDef(nameOrCardNo);
  const name = def?.name ?? nameOrCardNo;
  return {
    instanceId: nextId(),
    name,
    owner,
    controller: controller ?? owner,
    engaged: false,
    modifiers: [],
    counters: {},
    persistentCounters: {},
    chosenChooseOptionsThisTurn: {},
    enteredFieldTurn: 0,
    evolvedThisTurn: false,
    superEvolved: false,
    onFieldSinceTurnStart: false,
    foughtWithBane: false,
    grantedKeywords: [],
    playCostReduction: 0,
    persistentPlayCostReduction: 0,
    abilitiesActivatedThisTurn: [],
    grantedLastWords: [],
    grantedStartOfEnd: [],
    grantedOnCardPlayed: [],
  };
}

export function emptyPlayer(player: PlayerId): PlayerState {
  return {
    leaderDef: 20,
    pp: 0,
    maxPp: 0,
    evoPoints: player === 1 ? 3 : 0,
    superEvoPoints: 1,
    turnsPassed: 0,
    handLimit: 7,
    fieldLimit: 5,
    exLimit: 5,
    zones: {
      deck: [],
      hand: [],
      field: [],
      exArea: [],
      evolveDeck: [],
      evolveZone: [],
      cemetery: [],
      banish: [],
      raceZone: [],
      driveZone: [],
      triggerZone: [],
      resolutionZone: [],
    },
    flags: {
      evolvedThisTurn: false,
      cardsPlayedThisTurn: 0,
      spellsPlayedThisTurn: 0,
      unionBurstsActivatedThisTurn: 0,
      unionBurstSourceIdsThisTurn: [],
      mulliganDone: false,
      leaderLostDefThisTurn: false,
      owedDraws: 0,
    },
  };
}

export function createInitialGameState(firstPlayer: PlayerId = 0): GameState {
  const players: [PlayerState, PlayerState] = [emptyPlayer(0), emptyPlayer(1)];
  // Opening EP belongs to the second player, not always slot 1.
  players[0].evoPoints = firstPlayer === 0 ? 0 : 3;
  players[1].evoPoints = firstPlayer === 1 ? 0 : 3;
  return {
    players,
    activePlayer: firstPlayer,
    turnNumber: 0,
    phase: "mulligan",
    firstPlayer,
    winner: null,
    pendingTriggers: [],
    pendingChoices: { type: "mulligan", player: firstPlayer },
    combat: null,
    quickWindow: null,
    quickWindowPlayer: null,
    endPhaseQuickResolved: false,
    resolutionContext: null,
    eventLog: [],
    actionLog: [],
    revealedCards: [],
  };
}
