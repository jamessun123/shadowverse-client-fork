export type PlayerId = 0 | 1;
export type CardType = "follower" | "spell" | "amulet" | "crest" | "leader";
export type SpecialType = "evolved" | "advanced" | "token";
export type Phase = "mulligan" | "start" | "main" | "end" | "combat" | "quickWindow" | "gameOver";
export type QuickWindow = "afterAttack" | "endPhase" | null;
export type Keyword = "fanfare" | "lastWords" | "evolve" | "quick" | "ward" | "storm" | "rush" | "assail" | "intimidate" | "drain" | "bane" | "aura" | "onEvolve" | "onSuperEvolve" | "strike" | "advanced" | "stack";
export interface CardDefinition {
    cardNo: string;
    name: string;
    class: string;
    cardType: CardType;
    /** Scraped deck role: base / evolved / token (distinct from cardType spell/follower). */
    printingType?: "base" | "evolved" | "token";
    specialType?: SpecialType;
    cost: number;
    attack?: number;
    defense?: number;
    traits: string[];
    keywords: Keyword[];
    cardText: string;
    evolvesFrom?: string;
    evolvesTo?: string;
    /** PP cost to evolve this follower (defaults to 2, or parsed from [costNN] in card text). */
    evolveCost?: number;
    abilities?: AbilityDefinition[];
}
export type TriggerTiming = "fanfare" | "lastWords" | "onEvolve" | "onSuperEvolve" | "onCardPlayed"
/** Fires when a card is fused into EX (and for abilities that also watch plays). */
 | "onCardFused"
/** Fires on either play or fuse of a matching card. */
 | "onCardPlayedOrFused" | "strike" | "startOfMain" | "startOfEnd" | "passive" | "aura" | "onExAreaEntry" | "onAllyFollowerEnter"
/** Fires when a card moves from an opponent's deck to cemetery during your turn. */
 | "onOpponentDeckToCemetery"
/** Fires on a follower during its controller's turn after it takes ability damage and survives. */
 | "onAbilityDamageTaken" | "evolve";
export interface AbilityDefinition {
    timing: TriggerTiming | "activated" | "spell";
    cost?: {
        pp?: number;
        engage?: boolean;
        banishFromCemetery?: DeckFilter;
        banishFromExArea?: DeckFilter;
        banishCount?: number;
        buryFromField?: DeckFilter;
        buryFieldCount?: number;
        excludeSelfFromBury?: boolean;
        burySelf?: boolean;
        /** Engage N matching ally field cards (does not bury them). */
        engageFromField?: DeckFilter;
        engageFieldCount?: number;
        excludeSelfFromEngage?: boolean;
        /**
         * Fuse cost: discard from hand or bury from EX matching cards, then the
         * activate effect typically moves this card into EX.
         */
        fuse?: {
            filter: DeckFilter;
            count?: number;
            /** Default true — cannot use the fuse source as its own material. */
            excludeSelf?: boolean;
        };
    };
    quick?: boolean;
    condition?: Condition;
    filter?: DeckFilter;
    activateFrom?: "field" | "cemetery" | "exArea" | "hand";
    /**
     * When true, onAllyFollowerEnter supplies the entered follower as
     * forcedTargetId (e.g. "give that follower +1/+1"). Leave false when the
     * effect should prompt (e.g. "select a follower and deal damage").
     */
    useEnteredTarget?: boolean;
    /** Human-readable label for trigger ordering UI. */
    label?: string;
    oncePerTurn?: boolean;
    /** Max times this trigger can fire per turn (e.g. Tetra Rebel Evo). */
    maxPerTurn?: number;
    effect: Effect;
}
export interface GrantedOnCardPlayed {
    filter?: DeckFilter;
    effect: Effect;
    untilEndOfTurn?: boolean;
    oncePerTurn?: boolean;
    maxPerTurn?: number;
    label?: string;
}
export type TargetSelector = {
    type: "self";
} | {
    type: "selfLeader";
} | {
    type: "enemyLeader";
} | {
    type: "enemyFollower";
    count?: number;
    minCount?: number;
    maxCount?: number;
    trait?: string;
    cardType?: CardType;
    excludeSelf?: boolean;
}
/** Enemy leader or an enemy follower (player chooses). */
 | {
    type: "enemyLeaderOrFollower";
    count?: number;
    minCount?: number;
    maxCount?: number;
    trait?: string;
    cardType?: CardType;
    excludeSelf?: boolean;
} | {
    type: "anyFollower";
    count?: number;
    minCount?: number;
    maxCount?: number;
    trait?: string;
    cardType?: CardType;
    excludeSelf?: boolean;
} | {
    type: "selfFollower";
    count?: number;
    minCount?: number;
    maxCount?: number;
    trait?: string;
    cardType?: CardType;
    excludeSelf?: boolean;
    includeSelf?: boolean;
}
/** Ally field card (follower or amulet), optionally trait-filtered. */
 | {
    type: "selfFieldCard";
    count?: number;
    minCount?: number;
    maxCount?: number;
    trait?: string;
    cardType?: CardType;
    excludeSelf?: boolean;
    includeSelf?: boolean;
};
export type DeckFilter = {
    /** Exact card name (gameplay identity). */
    name?: string;
    /** @deprecated Use `name`. Still accepted for one release. */
    cardNo?: string;
    trait?: string;
    /** Require every listed trait (e.g. Omen + Idolatry). */
    allTraits?: string[];
    cardClass?: string;
    maxCost?: number;
    minCost?: number;
    cardType?: CardType;
    /** Exact match on normalized identity name (ignores Evolved/TOKEN suffixes). */
    identityName?: string;
    /** Match cards whose normalized name contains this substring (case-insensitive). */
    identityNameContains?: string;
    /** Exclude cards whose normalized identity name equals this value. */
    excludeIdentityName?: string;
};
export type Condition = {
    type: "always";
} | {
    type: "overflow";
} | {
    type: "combo";
    count: number;
} | {
    type: "namedFollowerOnField";
    name: string;
} | {
    type: "namedFollowerOnFieldByName";
    identityName: string;
}
/** True when an ally field follower's normalized name contains the substring. */
 | {
    type: "namedFollowerOnFieldContains";
    identityNameContains: string;
}
/** True when forcedTargetId's card has every listed trait. */
 | {
    type: "selectedTargetHasTraits";
    allTraits: string[];
}
/** True when the source instance has at least `count` of the named persistent counter. */
 | {
    type: "sourcePersistentCounterMin";
    key: string;
    count: number;
}
/** True when the most recently revealed card's name contains this substring. */
 | {
    type: "lastRevealedIdentityContains";
    identityNameContains: string;
} | {
    type: "notEnteredFromHand";
} | {
    type: "enteredFromCemetery";
} | {
    type: "opponentCemeteryMin";
    count: number;
} | {
    type: "exAreaTraitMin";
    trait: string;
    count: number;
} | {
    type: "ownCemeteryTraitMin";
    trait: string;
    count: number;
} | {
    type: "ownDeckTraitMin";
    trait: string;
    count: number;
} | {
    type: "fieldTraitMin";
    trait: string;
    count: number;
} | {
    type: "handTraitMin";
    trait: string;
    count: number;
} | {
    type: "ownCemeteryClassMin";
    cardClass: string;
    count: number;
} | {
    type: "ownDeckClassMin";
    cardClass: string;
    count: number;
} | {
    type: "exAreaNamedMin";
    identityName: string;
    count: number;
} | {
    type: "fieldFollowerMinCost";
    trait: string;
    minCost: number;
    count: number;
} | {
    type: "buriedExactCost";
    cost: number;
} | {
    type: "buriedAtLeastCost";
    cost: number;
} | {
    type: "discardedCardType";
    cardType: CardType;
} | {
    type: "handMin";
    count: number;
} | {
    type: "ownCemeteryMin";
    count: number;
} | {
    type: "fieldTraitMax";
    trait: string;
    count: number;
}
/** Count all field cards (followers + amulets) with the trait. */
 | {
    type: "fieldCardTraitMin";
    trait: string;
    count: number;
}
/** True when the player's leader defense is at most `count`. */
 | {
    type: "leaderDefMax";
    count: number;
};
export type DamageAmount = number | {
    op: "otherFieldTraitCount";
    trait: string;
} | {
    op: "fieldTraitCount";
    trait: string;
    multiplier?: number;
} | {
    op: "engagedFieldTraitCount";
    trait: string;
    multiplier?: number;
}
/** Cards engaged via engageFromFieldAsCost during this resolution. */
 | {
    op: "engagedAsCostCount";
    multiplier?: number;
};
export type Effect = {
    op: "draw";
    count: number;
} | {
    op: "dealDamage";
    amount: DamageAmount;
    targets: TargetSelector;
} | {
    op: "buff";
    atk?: number;
    def?: number;
    targets: TargetSelector;
} | {
    op: "buffFieldTrait";
    trait: string;
    atk?: number;
    def?: number;
    keyword?: Keyword;
    excludeSelf?: boolean;
} | {
    op: "grantKeyword";
    keyword: Keyword;
    targets: TargetSelector;
}
/** Grant a keyword to every ally field card matching filter. */
 | {
    op: "grantKeywordMatching";
    keyword: Keyword;
    filter: DeckFilter;
} | {
    op: "destroy";
    targets: TargetSelector;
}
/** Summon a token by name without a trailing " TOKEN" suffix (e.g. "Assembly Droid"). */
 | {
    op: "summon";
    tokenName: string;
    count: number;
    zone: "field" | "exArea";
    tokenCardNo?: string;
} | {
    op: "recoverPp";
    amount: number;
} | {
    op: "spendPp";
    amount: number;
}
/** Increase max PP (capped at 10). Does not fill current PP — pair with recoverPp. */
 | {
    op: "increaseMaxPp";
    amount: number;
} | {
    op: "rollDie";
    sides: number;
    outcomes: {
        on: number[];
        effect: Effect;
    }[];
} | {
    op: "buryOpponentMaxAttackFollower";
} | {
    op: "healLeader";
    amount: number;
} | {
    op: "discard";
    count: number;
} | {
    op: "discardOpponentRandom";
    count: number;
} | {
    op: "choose";
    options: {
        label: string;
        effect: Effect;
        additionalPpCost?: number;
    }[];
    min: number;
    max: number;
    /** Exclude option indices already chosen this turn on the source instance. */
    excludeChosenThisTurn?: boolean;
    /** Key for chosen-option tracking (default "default"). */
    trackKey?: string;
} | {
    op: "chooseMultiple";
    options: {
        label: string;
        effect: Effect;
        additionalPpCost?: number;
    }[];
    min: number;
    max: number;
} | {
    op: "if";
    condition: Condition;
    then: Effect;
    else?: Effect;
} | {
    op: "sequence";
    steps: Effect[];
} | {
    op: "mill";
    count: number;
} | {
    op: "millOpponent";
    count: number;
} | {
    op: "damageFollowerAndLeader";
    followerAmount: number;
    leaderAmount: number;
} | {
    op: "tutorFromDeck";
    filter: DeckFilter;
    to: "hand" | "exArea" | "field";
    playCostReduction?: number;
    /** Reveal to opponent before adding to hand (default true for deck → hand). */
    reveal?: boolean;
} | {
    op: "tutorFromCemetery";
    filter: DeckFilter;
    to: "hand" | "field" | "exArea";
    playCostReduction?: number;
    reveal?: boolean;
} | {
    op: "tutorFromOpponentCemetery";
    filter?: DeckFilter;
    to: "hand" | "field" | "exArea";
    playCostReduction?: number;
} | {
    /** Select a card in an opponent's cemetery and play it for 0 PP. */
    op: "playFromOpponentCemetery";
    filter?: DeckFilter;
}
/** Select a card in your cemetery and play it for 0 PP. */
 | {
    op: "playFromCemetery";
    filter?: DeckFilter;
} | {
    op: "addPersistentCounter";
    key: string;
    amount?: number;
} | {
    op: "returnSourceToHand";
} | {
    op: "autoEvolveIf";
    condition: Condition;
    triggerOnEvolve?: boolean;
} | {
    op: "banishSelf";
} | {
    op: "burySelf";
} | {
    op: "summonFromEvolveDeck";
    filter?: DeckFilter;
} | {
    op: "summonFromCemetery";
    filter: DeckFilter;
    count: number;
    maxTotalCost?: number;
} | {
    op: "putHandCardOnDeck";
    position: "top" | "bottom";
} | {
    op: "grantLastWords";
    effect: Effect;
} | {
    op: "noop";
} | {
    op: "optionalCost";
    label?: string;
    cost: Effect;
    then: Effect;
} | {
    op: "exAreaPlayCostReduction";
    amount: number;
} | {
    op: "searchDeckChoose";
    filter: DeckFilter;
    lookAt: number;
    to: "hand" | "exArea" | "field";
    optional?: boolean;
    playCostReduction?: number;
    /** Only apply playCostReduction when the chosen card matches this filter. */
    playCostReductionFilter?: DeckFilter;
    /** Where unchosen cards from the search go (default cemetery). */
    remainderTo?: "cemetery" | "deckBottom";
    /** Reveal to opponent before adding to hand (default true for deck → hand). */
    reveal?: boolean;
} | {
    op: "passiveKeywords";
    keywords: Keyword[];
} | {
    op: "playCostReduction";
    amount: number;
} | {
    op: "auraGrantKeyword";
    keyword: Keyword;
    trait?: string;
    excludeSelf?: boolean;
} | {
    op: "damageCap";
    maxPerHit: number;
} | {
    op: "engage";
    targets: TargetSelector;
} | {
    op: "box";
    targets: TargetSelector;
} | {
    op: "grantPlayCostReduction";
    amount: number;
    targets: TargetSelector;
} | {
    op: "banishFromCemetery";
    filter: DeckFilter;
    count: number;
} | {
    op: "banishFromExArea";
    filter: DeckFilter;
    count: number;
} | {
    op: "reviveSelfFromCemetery";
} | {
    op: "moveSourceToExArea";
} | {
    op: "selectFromHand";
    filter: DeckFilter;
    to: "exArea" | "hand";
    optional?: boolean;
    playCostReduction?: number;
} | {
    op: "triggerAbilities";
    timing: TriggerTiming;
} | {
    op: "discardFromHand";
    filter: DeckFilter;
    count: number;
} | {
    op: "searchDeckSummonMultiple";
    filter: DeckFilter;
    lookAt: number;
    /** Optional total play-cost budget across chosen cards. */
    maxTotalCost?: number;
    /** Cap how many cards may be chosen (default unlimited within cost). */
    maxCount?: number;
    /** Destination zone (default field). */
    to?: "field" | "exArea" | "hand";
    remainderTo?: "cemetery" | "deckBottom";
    /** Reveal when adding to hand (default true). */
    reveal?: boolean;
} | {
    op: "buryFieldFollowers";
    filter?: DeckFilter;
    minCost?: number;
    excludeSelf?: boolean;
    sourceOnly?: boolean;
} | {
    op: "dealDamageAllEnemies";
    amount: DamageAmount;
    followersOnly?: boolean;
    leadersOnly?: boolean;
}
/** Deal damage to every follower on both fields. */
 | {
    op: "dealDamageAllFollowers";
    amount: DamageAmount;
} | {
    op: "grantOnCardPlayed";
    filter?: DeckFilter;
    effect: Effect;
    untilEndOfTurn?: boolean;
    oncePerTurn?: boolean;
    maxPerTurn?: number;
    label?: string;
} | {
    op: "setSourceEvolveCostOverride";
    amount: number;
} | {
    /** Optional additional cost: engage between min and max matching field cards. */
    op: "engageFromFieldAsCost";
    filter: DeckFilter;
    min?: number;
    max?: number;
};
export interface Modifier {
    atk?: number;
    def?: number;
    sourceId: string;
    untilEndOfTurn?: boolean;
}
export interface CardInstance {
    instanceId: string;
    /** Exact card name (gameplay identity). */
    name: string;
    controller: PlayerId;
    owner: PlayerId;
    /** false = reserved (free to act); true = engaged (attacked, ward engaged, or [engage] activate) */
    engaged: boolean;
    modifiers: Modifier[];
    /** Turn-scoped counters (ability maxPerTurn keys); cleared each start phase. */
    counters: Record<string, number>;
    /** Persistent counters (e.g. Crest reversal); not cleared each turn. */
    persistentCounters?: Record<string, number>;
    /** Option indices chosen this turn for choose effects, keyed by trackKey. */
    chosenChooseOptionsThisTurn?: Record<string, number[]>;
    /** Option labels chosen this turn for choose effects, keyed by trackKey. */
    chosenChooseOptionLabelsThisTurn?: Record<string, string[]>;
    enteredFieldTurn: number;
    evolvedThisTurn: boolean;
    superEvolved: boolean;
    linkedEvoInstanceId?: string;
    onFieldSinceTurnStart: boolean;
    foughtWithBane: boolean;
    foughtWithInstanceId?: string;
    grantedKeywords: Keyword[];
    /** Set when the follower enters the field; cleared at end of turn resolution. */
    enteredFromHand?: boolean;
    /** True when this instance most recently entered the field from the cemetery. */
    enteredFromCemetery?: boolean;
    /** Follower is boxed until this turn number (exclusive end at start phase). */
    boxedUntilTurn?: number;
    /** PP reduction for the rest of this turn (tutor/search EX discounts; cleared end of turn). */
    playCostReduction: number;
    /** Permanent PP reduction on this instance (e.g. Nicola last words). */
    persistentPlayCostReduction: number;
    /** Keys `${timing}:${index}` for once-per-turn abilities used this turn. */
    abilitiesActivatedThisTurn: string[];
    /** Extra last-words effects granted while on field. */
    grantedLastWords?: Effect[];
    /** Granted "when you play a card" triggers (e.g. Tetra Serene super-evolve). */
    grantedOnCardPlayed?: GrantedOnCardPlayed[];
    /** Temporary evolve PP cost override for this instance (cleared end of turn). */
    evolveCostOverride?: number;
    /**
     * True when this evolve-deck card has already been used (evolved and the
     * follower left play). Face-up in the evolve deck; cannot be used again.
     */
    evolveUsed?: boolean;
}
export interface EvolveLink {
    fieldInstanceId: string;
    evolveInstanceId: string;
}
export interface PlayerZones {
    deck: CardInstance[];
    hand: CardInstance[];
    field: CardInstance[];
    exArea: CardInstance[];
    evolveDeck: CardInstance[];
    evolveZone: EvolveLink[];
    cemetery: CardInstance[];
    banish: CardInstance[];
    raceZone: CardInstance[];
    driveZone: CardInstance[];
    triggerZone: CardInstance[];
    resolutionZone: CardInstance[];
}
export interface PlayerFlags {
    evolvedThisTurn: boolean;
    cardsPlayedThisTurn: number;
    mulliganDone: boolean;
    leaderLostDefThisTurn: boolean;
    /** Unfulfilled draw obligations (checked for deck-out loss after rules handling). */
    owedDraws: number;
    /** Start-of-end abilities queued for the current end phase. */
    endStartAbilitiesQueued?: boolean;
    /**
     * Choose-option indices already taken this turn for excludeChosenThisTurn
     * effects, keyed by trackKey (e.g. Barbaros loot modes).
     */
    chosenChooseOptionTracksThisTurn?: Record<string, number[]>;
    /**
     * Choose-option labels already taken this turn (same keys as index tracks).
     * Labels survive any index remapping edge cases.
     */
    chosenChooseOptionLabelsThisTurn?: Record<string, string[]>;
}
export interface PlayerState {
    leaderDef: number;
    pp: number;
    maxPp: number;
    evoPoints: number;
    superEvoPoints: number;
    turnsPassed: number;
    handLimit: number;
    fieldLimit: number;
    exLimit: number;
    zones: PlayerZones;
    flags: PlayerFlags;
}
export interface PendingTrigger {
    id: string;
    controller: PlayerId;
    sourceInstanceId: string;
    ability: AbilityDefinition;
    timing: TriggerTiming;
    label: string;
    /** Key for once-per-turn / max-per-turn tracking on the source card. */
    abilityKey?: string;
    /** For onAllyFollowerEnter: the follower that just entered the field. */
    forcedTargetId?: string;
}
export interface ChoiceSourceContext {
    sourceCardNo?: string;
    sourceLabel?: string;
    reasonLabel?: string;
}
export type ChoicePrompt = ChoiceSourceContext & ({
    type: "mulligan";
    player: PlayerId;
} | {
    type: "selectTrigger";
    player: PlayerId;
    options: {
        triggerId: string;
        label: string;
    }[];
} | {
    type: "selectTarget";
    player: PlayerId;
    effect: Effect;
    candidates: {
        instanceId: string;
        label: string;
        name?: string;
        /** Relative to the choosing player. */
        side?: "ally" | "enemy";
    }[];
    /** Exact count when minCount/maxCount are omitted. Defaults to 1. */
    count?: number;
    minCount?: number;
    maxCount?: number;
} | {
    type: "selectZoneCard";
    player: PlayerId;
    fromZone: "deck" | "cemetery" | "hand" | "evolveDeck";
    /** Zone owner to select from (defaults to choosing player). */
    fromPlayer?: PlayerId;
    to: "hand" | "exArea" | "field";
    /** If true, play the selected card for 0 PP instead of moving to `to`. */
    playSelected?: boolean;
    options: {
        instanceId: string;
        label: string;
        name: string;
    }[];
    optional?: boolean;
    playCostReduction?: number;
    reveal?: boolean;
} | {
    type: "choose";
    player: PlayerId;
    options: {
        index: number;
        label: string;
        effect: Effect;
        additionalPpCost?: number;
    }[];
    min: number;
    max: number;
    /** When set, record chosen indices on the source under this track key. */
    trackChosenKey?: string;
    /** Source card for excludeChosenThisTurn tracking (survives nested prompts). */
    sourceInstanceId?: string;
} | {
    type: "chooseMultiple";
    player: PlayerId;
    options: {
        index: number;
        label: string;
        effect: Effect;
        additionalPpCost?: number;
    }[];
    min: number;
    max: number;
} | {
    type: "discard";
    player: PlayerId;
    count: number;
    candidates: {
        instanceId: string;
        label: string;
        name: string;
    }[];
} | {
    type: "wardEngage";
    player: PlayerId;
    candidates: {
        instanceId: string;
        label: string;
        name: string;
    }[];
} | {
    type: "searchDeckTop";
    player: PlayerId;
    to: "hand" | "exArea" | "field";
    filter: DeckFilter;
    topInstanceIds: string[];
    optional?: boolean;
    options: {
        instanceId: string;
        label: string;
        name: string;
        eligible: boolean;
    }[];
    playCostReduction?: number;
    playCostReductionFilter?: DeckFilter;
    remainderTo?: "cemetery" | "deckBottom";
    reveal?: boolean;
} | {
    type: "selectZoneCards";
    player: PlayerId;
    fromZone: "cemetery" | "hand" | "exArea" | "field";
    /** Exact count when minCount/maxCount are omitted. */
    count: number;
    /** Inclusive lower bound for variable selection (defaults to count). */
    minCount?: number;
    /** Inclusive upper bound for variable selection (defaults to count). */
    maxCount?: number;
    /** `fuse` = discard if in hand, bury if in EX. */
    action: "banish" | "discard" | "bury" | "engage" | "fuse";
    options: {
        instanceId: string;
        label: string;
        name: string;
    }[];
    /** Store selected count on resolutionContext.engagedAsCostCount. */
    recordEngagedAsCost?: boolean;
    resumeActivate?: {
        sourceInstanceId: string;
        zone: "field" | "cemetery" | "exArea" | "hand";
        abilityKey: string;
    };
} | {
    type: "putHandOnDeck";
    player: PlayerId;
    phase: "selectCard" | "selectPosition";
    position?: "top" | "bottom";
    selectedInstanceId?: string;
    options: {
        instanceId: string;
        label: string;
        name: string;
    }[];
} | {
    type: "selectCemeterySummon";
    player: PlayerId;
    count: number;
    maxTotalCost: number;
    filter: DeckFilter;
    options: {
        instanceId: string;
        label: string;
        name: string;
        cost: number;
    }[];
} | {
    type: "selectDeckSummon";
    player: PlayerId;
    maxTotalCost?: number;
    maxCount?: number;
    to?: "field" | "exArea" | "hand";
    filter: DeckFilter;
    topInstanceIds: string[];
    remainderTo: "cemetery" | "deckBottom";
    reveal?: boolean;
    options: {
        instanceId: string;
        label: string;
        name: string;
        cost: number;
        eligible: boolean;
    }[];
});
export interface CombatState {
    attackerId: string;
    targetId: string | "leader";
    targetPlayer: PlayerId;
    phase: "declared" | "quickWindow" | "damage" | "done";
    /** Resume strike resolution after a mid-combat target choice. */
    strikeAbilityIndex?: number;
}
export interface GameEvent {
    type: string;
    player?: PlayerId;
    data?: Record<string, unknown>;
}
/** One player action taken during a match (authoritative action history). */
export interface ActionLogEntry {
    seq: number;
    /** Acting player's personal turn count (1 on their first turn, even if they go second). */
    turnNumber: number;
    phase: Phase;
    player: PlayerId;
    actionType: string;
    /** Human-readable summary, e.g. "played Zealot of Destruction". */
    text: string;
    /** Optional card name for art in the UI. */
    cardName?: string;
}
export interface ResolutionContext {
    sourceInstanceId?: string;
    /**
     * Owner of a paused multi-step sequence (e.g. the spell in resolution).
     * Preserved when nested triggers temporarily replace sourceInstanceId.
     */
    resumeOwnerInstanceId?: string;
    effectStack: Effect[];
    forcedTargetId?: string;
    /** Multi-target selection (e.g. deal damage to up to N allies). */
    forcedTargetIds?: string[];
    /**
     * Last follower/target chosen in this resolution (survives resume steps).
     * Used by conditions like selectedTargetHasTraits; does not auto-target later effects.
     */
    lastSelectedTargetId?: string;
    resumeAfterChoice?: Effect[];
    /** While true, queued fanfare/LW/etc. wait until the current effect sequence finishes. */
    deferTriggers?: boolean;
    /** Costs of followers buried by the current buryFieldFollowers effect. */
    buriedCosts?: number[];
    /** Card no. of the most recently discarded card this effect sequence. */
    lastDiscardedCardName?: string;
    /** Number of cards engaged via engageFromFieldAsCost this resolution. */
    engagedAsCostCount?: number;
}
export interface RevealedCardInfo {
    owner: PlayerId;
    instanceId: string;
    name: string;
}
export interface GameState {
    players: [PlayerState, PlayerState];
    activePlayer: PlayerId;
    turnNumber: number;
    phase: Phase;
    firstPlayer: PlayerId;
    winner: PlayerId | "draw" | null;
    pendingTriggers: PendingTrigger[];
    pendingChoices: ChoicePrompt | null;
    combat: CombatState | null;
    quickWindow: QuickWindow;
    /** Player who may cast quick spells during the current quick window. */
    quickWindowPlayer?: PlayerId | null;
    eventLog: GameEvent[];
    /** Every successful player GameAction this match, in order. */
    actionLog: ActionLogEntry[];
    resolutionContext: ResolutionContext | null;
    /** Cards revealed to both players during the current effect resolution. */
    revealedCards?: RevealedCardInfo[];
    /** End phase: opponent quick window was offered or skipped after start-of-end. */
    endPhaseQuickResolved?: boolean;
}
export type GameAction = {
    type: "MULLIGAN";
    redraw: boolean;
} | {
    type: "PLAY_CARD";
    handInstanceId: string;
    targets?: string[];
} | {
    type: "ATTACK";
    attackerId: string;
    targetId: string | "leader";
} | {
    type: "EVOLVE";
    fieldInstanceId: string;
    evolveDeckInstanceId?: string;
    useSuperEvo?: boolean;
    useEvoPoint?: boolean;
} | {
    type: "ACTIVATE";
    fieldInstanceId: string;
    useEvoPoint?: boolean;
    abilityKey?: string;
} | {
    type: "ACTIVATE_CEMETERY";
    cemeteryInstanceId: string;
    abilityKey?: string;
} | {
    type: "ACTIVATE_EXAREA";
    exAreaInstanceId: string;
    abilityKey?: string;
} | {
    type: "ACTIVATE_HAND";
    handInstanceId: string;
    useEvoPoint?: boolean;
    abilityKey?: string;
} | {
    type: "END_MAIN";
} | {
    type: "QUICK_PLAY";
    handInstanceId: string;
    targets?: string[];
} | {
    type: "PASS_QUICK_WINDOW";
} | {
    type: "CHOICE_RESPONSE";
    payload: Record<string, unknown>;
} | {
    type: "CONCEDE";
};
export interface ActionResult {
    ok: boolean;
    state: GameState;
    error?: string;
}
export type UniverseId = "umamusume" | "idolmaster" | "vanguard";
export interface PlayerView {
    self: PlayerId;
    state: GameState;
    opponentHandCount: number;
    opponentDeckCount: number;
    opponentEvoDeckCount: number;
    legalActions: string[];
    /** Legal activated abilities with labels for multi-activate menus. */
    activateOptions: {
        instanceId: string;
        zone: "field" | "cemetery" | "exArea" | "hand";
        abilityKey: string;
        label: string;
        useEvoPoint: boolean;
    }[];
    /** Effective play cost from EX area, keyed by instance id (self). */
    exPlayCosts: Record<string, number>;
    /** Effective play cost from EX area, keyed by instance id (opponent). */
    opponentExPlayCosts: Record<string, number>;
    /**
     * Currently active combat keywords per field/EX instance id (self + opponent).
     * Reflects printed / granted / passive keywords (e.g. Storm only while Overflow).
     */
    activeKeywords?: Record<string, Keyword[]>;
    /** Auto-detected leader portrait for this player. */
    selfLeader?: string;
    /** Auto-detected leader portrait for the opponent. */
    opponentLeader?: string;
}
