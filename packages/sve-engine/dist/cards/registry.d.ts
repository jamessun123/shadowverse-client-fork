import { CardDefinition } from "../types";
/**
 * Look up a card definition by exact card name.
 * Also accepts a legacy printing code (BP07-069EN).
 * Token DSL refs may omit the trailing " TOKEN" suffix (e.g. "Assembly Droid").
 */
export declare function getCardDef(nameOrCardNo: string): CardDefinition | undefined;
/**
 * Resolve a summon/token reference to the registry card name.
 * Prefers the "… TOKEN" printing when both a base card and token share a name
 * (e.g. Assault Tentacle).
 */
export declare function resolveTokenName(nameOrCardNo: string): string;
/** Resolve a printing code to its gameplay card name. */
export declare function getNameForCardNo(cardNo: string): string | undefined;
/**
 * @deprecated Prefer comparing names directly. Kept for call sites that still
 * pass printing codes; returns the gameplay name for both sides.
 */
export declare function getGameplayCardNo(nameOrCardNo: string): string;
export declare function getAllCardDefs(): CardDefinition[];
export declare function registerCard(def: CardDefinition): void;
export declare function getCardByName(name: string): CardDefinition | undefined;
