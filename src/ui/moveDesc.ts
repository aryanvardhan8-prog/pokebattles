// Move descriptions for the battle FIGHT menu, from the list Aryan supplied (move-descriptions-frlg.csv),
// saved in src/data/movedesc.json.
import DESC from '../data/movedesc.json';

export const moveDesc = (id: string): string => (DESC as Record<string, string>)[id] ?? '';
