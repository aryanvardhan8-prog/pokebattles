import speciesJson from '../data/species.json';
import movesJson from '../data/moves.json';
import learnsetsJson from '../data/learnsets.json';
import typesJson from '../data/types.json';
import levelMovesJson from '../data/levelmoves.json';
import newMovesJson from '../data/newmoves.json';

export type StatName = 'hp' | 'atk' | 'def' | 'spc' | 'spe';
export type Stats = Record<StatName, number>;

export interface Species { num: number; name: string; types: string[]; height: number; base: Stats } // height in metres
export interface Move {
  name: string; type: string; power: number; acc: number | null; pp: number;
  priority: number; category: 'Physical' | 'Special' | 'Status'; target: string;
  secondary?: {chance: number; status?: string; boosts?: Record<string, number>; volatileStatus?: string};
  status?: string; boosts?: Record<string, number>; volatileStatus?: string;
  drain?: [number, number]; recoil?: [number, number]; multihit?: number | [number, number];
  ohko?: boolean; selfdestruct?: string; damage?: number | 'level'; heal?: [number, number];
  highCrit?: boolean; charge?: boolean; recharge?: boolean; thrash?: boolean; trap?: boolean;
  later?: boolean; // from a later Pokémon game (extra TM in the team builder only)
}

export const SPECIES = speciesJson as Record<string, Species>;
/** The 165 Gen 1 moves (Metronome picks from these, so old battles replay the same). */
export const GEN1_MOVE_IDS = Object.keys(movesJson);
/** Moves from later games added as extra TMs (scripts/new-moves.mts), and the Gen 1 Pokémon that learn them. */
export const LATER_MOVES = Object.keys(newMovesJson.moves);
export const LATER_LEARNERS = newMovesJson.learners as Record<string, string[]>;
export const MOVES = {...movesJson, ...newMovesJson.moves} as unknown as Record<string, Move>;
export const LEARNSETS = learnsetsJson as Record<string, string[]>;
/** Moves learned by levelling up. Everything else in LEARNSETS is TM/HM only. */
export const LEVEL_MOVES = levelMovesJson as Record<string, string[]>;
// TYPES[attacking][defending] = multiplier (missing = 1)
export const TYPES = typesJson as Record<string, Record<string, number>>;
