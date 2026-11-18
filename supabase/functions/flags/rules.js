// src/engine/badgeRules.ts
var UNCHECKED = ["friends", "duels", "duelWins"];
var RULES = [
  ["red-1", "redWins", 1],
  ["red-50", "redWins", 50],
  ["red-100", "redWins", 100],
  ["red-250", "redWins", 250],
  ["med-1", "mediumWins", 1],
  ["med-50", "mediumWins", 50],
  ["med-100", "mediumWins", 100],
  ["hard-1", "hardWins", 1],
  ["hard-10", "hardWins", 10],
  ["hard-50", "hardWins", 50],
  ["hard-100", "hardWins", 100],
  ["sweep-1", "sweeps", 1],
  ["sweep-25", "sweeps", 25],
  ["triple-1", "triples", 1],
  ["triple-25", "triples", 25],
  ["comeback-1", "comebacks", 1],
  ["comeback-10", "comebacks", 10],
  ["e4-lorelei", "eliteBest", 1],
  ["e4-agatha", "eliteBest", 2],
  ["champ-1", "champions", 1],
  ["champ-5", "champions", 5],
  ["champ-25", "champions", 25],
  ["champ-50", "champions", 50],
  ["champ-100", "champions", 100],
  ["light-1", "lightChampions", 1],
  ["light-10", "lightChampions", 10],
  ["buddy", "friends", 1],
  ["friends-10", "friends", 10],
  ["friends-25", "friends", 25],
  ["duel-1", "duels", 1],
  ["pvp-10", "duelWins", 10],
  ["pvp-50", "duelWins", 50],
  ["pvp-100", "duelWins", 100],
  ["streak-3", "streak", 3],
  ["streak-7", "streak", 7],
  ["streak-30", "streak", 30],
  ["streak-100", "streak", 100],
  ["days-7", "days", 7],
  ["days-30", "days", 30],
  ["days-100", "days", 100],
  ["days-365", "days", 365],
  ["top10-1", "top10", 1],
  ["top10-25", "top10", 25],
  ["first-1", "firsts", 1],
  ["first-10", "firsts", 10]
];
function fromRow(r, extra = {}) {
  const n = (k) => Number(r?.[k] ?? 0);
  return {
    redWins: n("red_wins"),
    mediumWins: n("medium_wins"),
    hardWins: n("hard_wins"),
    sweeps: n("sweeps"),
    triples: n("triples"),
    comebacks: n("comebacks"),
    eliteBest: n("elite_best"),
    champions: n("champions"),
    lightChampions: n("light_champions"),
    friends: 0,
    duels: 0,
    duelWins: 0,
    streak: n("streak"),
    days: n("days"),
    top10: n("top10"),
    firsts: n("firsts"),
    ...extra
  };
}
function verified(ids, s) {
  return ids.filter((id) => {
    const r = RULES.find((x) => x[0] === id);
    return !!r && (UNCHECKED.includes(r[1]) || s[r[1]] >= r[2]);
  });
}
export {
  RULES,
  UNCHECKED,
  fromRow,
  verified
};
