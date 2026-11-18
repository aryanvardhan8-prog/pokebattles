import {describe, it, expect} from 'vitest';
import {handleMatch, type Store} from '../src/engine/matchCore';
import {startingMoves, levelsFor, randomTeam, DEFAULT_OPTIONS, type PickedTeam, type MatchOptions} from '../src/engine/pvp';
import {Battle} from '../src/engine/battle';

function memoryStore(): Store {
  const files = new Map<string, string>();
  return {
    async read(path, fallback) { return files.has(path) ? JSON.parse(files.get(path)!) : fallback; },
    async write(path, value) { files.set(path, JSON.stringify(value)); },
    async remove(paths) { paths.forEach(p => files.delete(p)); },
  };
}
const ASH = {id: 'u-ash', name: 'ASH', country: 'IN'}, MISTY = {id: 'u-misty', name: 'MISTY', country: 'GB'};
let n = 0;
const ids = () => `M${++n}`;
const call = (store: Store, who: typeof ASH, body: object) => handleMatch(store, who, body, ids, () => 'seed');

function pick(levels: number[], species: string[]): PickedTeam {
  return {mons: species.map((s, i) => ({species: s, level: levels[i], moves: startingMoves(s, levels[i], DEFAULT_OPTIONS.clauses)})), bag: {'POTION': 1}};
}

async function setUp(options: Partial<MatchOptions> = {}) {
  const store = memoryStore();
  const [, created] = await call(store, ASH, {action: 'create', options}) as [number, {id: string}];
  const id = created.id;
  await call(store, ASH, {action: 'state', id, here: true}); // host waiting on the match screen
  await call(store, MISTY, {action: 'join', id, here: true});
  await call(store, ASH, {action: 'roomReady', id});
  const [, joined] = await call(store, MISTY, {action: 'roomReady', id}) as [number, any];
  return {store, id, joined};
}

describe('friend match flow', () => {
  it('crossed challenges merge into one match, and old lobbies are replaced', async () => {
    const store = memoryStore();
    const [, a] = await call(store, ASH, {action: 'create', options: {}, invite: 'MISTY'}) as [number, any];
    const [, a2] = await call(store, ASH, {action: 'create', options: {}, invite: 'MISTY'}) as [number, any];
    const [, old] = await call(store, ASH, {action: 'state', id: a.id}) as [number, any];
    expect(old.stage).toBe('cancelled');
    const [, b] = await call(store, MISTY, {action: 'create', options: {}, invite: 'ASH'}) as [number, any];
    expect(b).toEqual({id: a2.id, merged: true});
    const [, inv] = await call(store, MISTY, {action: 'invites'}) as [number, any];
    expect(inv.invites.map((x: any) => x.id)).toEqual([a2.id]);
  });

  it('friends can be invited from the waiting screen of an open match', async () => {
    const store = memoryStore();
    const [, a] = await call(store, ASH, {action: 'create', options: {}}) as [number, any];
    const [, r] = await call(store, ASH, {action: 'invite', id: a.id, invite: 'MISTY'}) as [number, any];
    expect(r.invited).toEqual(['MISTY']);
    const [, inv] = await call(store, MISTY, {action: 'invites'}) as [number, any];
    expect(inv.invites.map((x: any) => x.id)).toEqual([a.id]);
    const [code] = await call(store, MISTY, {action: 'invite', id: a.id, invite: 'ASH'});
    expect(code).not.toBe(200); // only the host can invite
  });

  it('a lobby can be deleted, and is gone for both players', async () => {
    const store = memoryStore();
    const [, a] = await call(store, ASH, {action: 'create', options: {}, invite: 'MISTY'}) as [number, any];
    await call(store, ASH, {action: 'cancel', id: a.id});
    const [, inv] = await call(store, MISTY, {action: 'invites'}) as [number, any];
    expect(inv.invites).toEqual([]);
    const [, list] = await call(store, ASH, {action: 'list'}) as [number, any];
    expect(list.matches).toEqual([]);
    const [code] = await call(store, MISTY, {action: 'join', id: a.id});
    expect(code).toBe(410);
  });

  it('team picking only opens once both players are in the battle room', async () => {
    const store = memoryStore();
    const [, created] = await call(store, ASH, {action: 'create', options: {}}) as [number, {id: string}];
    const id = created.id;
    const [, joined] = await call(store, MISTY, {action: 'join', id, here: true}) as [number, any]; // host never looked
    expect(joined.stage).toBe('room');
    expect(joined.online).toEqual({host: false, guest: true});
    const [code] = await call(store, MISTY, {action: 'setTeam', id, team: {mons: [], bag: {}}});
    expect(code).toBe(400);
    const [, mistyReady] = await call(store, MISTY, {action: 'roomReady', id}) as [number, any];
    expect(mistyReady.stage).toBe('room'); // host isn't here
    const [, back] = await call(store, ASH, {action: 'state', id, here: true}) as [number, any]; // host comes back…
    expect(back.stage).toBe('room'); // …but hasn't tapped ready
    const [, go] = await call(store, ASH, {action: 'roomReady', id}) as [number, any];
    expect(go.stage).toBe('picking');
  });

  it('create → join → pick teams (hidden until both ready) → battle to the end', async () => {
    const {store, id, joined} = await setUp({level: 50});
    expect(joined.stage).toBe('picking');
    const seed = joined.seed;
    const o = {...DEFAULT_OPTIONS, level: 50 as const};
    const hostTeam = pick(levelsFor(o, seed, 'host'), ['charizard', 'blastoise', 'venusaur', 'pikachu', 'snorlax', 'gengar']);
    const guestTeam = pick(levelsFor(o, seed, 'guest'), ['charizard', 'lapras', 'jolteon', 'alakazam', 'machamp', 'onix']); // same Charizard is fine
    let [s1, v1] = await call(store, ASH, {action: 'setTeam', id, team: hostTeam}) as [number, any];
    expect(s1).toBe(200);
    expect(v1.teams).toBeNull(); // the guest's team stays hidden
    const [s2, v2] = await call(store, MISTY, {action: 'setTeam', id, team: guestTeam}) as [number, any];
    expect(s2).toBe(200);
    expect(v2.stage).toBe('battle');

    // Both play their first usable move every round (or switch when they have to) until someone wins.
    for (let i = 0; i < 400; i++) {
      const [, st] = await call(store, ASH, {action: 'state', id}) as [number, any];
      if (st.stage === 'done') break;
      const setup = {seed: st.seed, clauses: {sleep: true, freeze: true},
        host: {name: 'ASH', team: [], bag: {}}, guest: {name: 'MISTY', team: [], bag: {}}};
      void setup;
      for (const [who, side] of [[ASH, 'player'], [MISTY, 'red']] as const) {
        const [, v] = await call(store, who, {action: 'state', id}) as [number, any];
        if (!v.duty || v.duty === 'wait' || v.chosen.me) continue;
        const b = Battle.replayPvp({seed: v.seed, clauses: {sleep: true, freeze: true},
          host: {name: 'ASH', team: (await import('../src/engine/pvp')).toMons(v.teams.host), bag: v.teams.host.bag},
          guest: {name: 'MISTY', team: (await import('../src/engine/pvp')).toMons(v.teams.guest), bag: v.teams.guest.bag}}, v.rounds);
        const s = b.sides[side];
        const choice = v.duty === 'switch'
          ? {type: 'switch', index: s.team.findIndex((m, k) => m.hp > 0 && k !== s.active)}
          : {type: 'move', slot: b.usableSlots(side)[0] ?? -1};
        const [code, res] = await call(store, who, {action: 'act', id, round: v.rounds.length, choice}) as [number, any];
        expect(code, JSON.stringify(res)).toBe(200);
      }
    }
    const [, end] = await call(store, MISTY, {action: 'state', id}) as [number, any];
    expect(end.stage).toBe('done');
    expect(['host', 'guest']).toContain(end.winner);
    expect(end.how).toBe('battle');
  });

  it('rejects illegal teams and enforces random teams', async () => {
    const {store, id, joined} = await setUp({level: 70, randomTeams: 'guest'});
    const o = {...DEFAULT_OPTIONS, level: 70 as const, randomTeams: 'guest' as const};
    const bad = pick([50, 50, 50, 50, 50, 50], ['charizard', 'blastoise', 'venusaur', 'pikachu', 'snorlax', 'gengar']);
    const [code, res] = await call(store, ASH, {action: 'setTeam', id, team: bad}) as [number, any];
    expect(code).toBe(400);
    expect(res.error).toMatch(/level 70/);
    const own = pick(levelsFor(o, joined.seed, 'guest'), ['charizard', 'blastoise', 'venusaur', 'pikachu', 'snorlax', 'gengar']);
    const [c2, r2] = await call(store, MISTY, {action: 'setTeam', id, team: own}) as [number, any];
    expect(c2).toBe(400);
    expect(r2.error).toMatch(/Random teams/);
    const given = randomTeam(o, joined.seed, 'guest');
    const [c3] = await call(store, MISTY, {action: 'setTeam', id, team: given});
    expect(c3).toBe(200);
  });

  it('a third player can’t join, and forfeiting ends the match', async () => {
    const {store, id} = await setUp();
    const [code] = await call(store, {id: 'u-brock', name: 'BROCK', country: ''}, {action: 'join', id});
    expect(code).toBe(403);
    const [, v] = await call(store, MISTY, {action: 'forfeit', id}) as [number, any];
    expect(v.winner).toBe('host');
    expect(v.how).toBe('forfeit');
    const [, list] = await call(store, ASH, {action: 'list'}) as [number, any];
    expect(list.matches[0]).toMatchObject({id, won: true});
  });
});
