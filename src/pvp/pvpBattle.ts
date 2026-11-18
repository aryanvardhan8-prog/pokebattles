// A live friend battle on the normal battle screen (canvas).
// The battle is rebuilt locally from the server's rounds (the engine is deterministic), so both players see
// exactly the same thing. The guest plays the engine's 'red' side, so a small mirror flips the sides
// for the battle screen: your POKéMON is always at the bottom.

import {Battle, type Action, type BattleEvent, type SideId, type PvpSetup} from '../engine/battle';
import {toMons} from '../engine/pvp';
import {RECHARGE_FROM_MS, NO_MISS_FROM_MS} from '../engine/daily';
import {BattleScene} from '../ui/battleScene';
import type {Gfx} from '../ui/gfx';
import type {Input} from '../ui/input';
import {audio} from '../audio';
import {trainerUrl} from '../trainers';
import {act, claimTimeout, matchState, type MatchView} from './api';
import {FIRST_TURN_EXTRA} from '../engine/matchCore';

const flip = (s: SideId): SideId => (s === 'player' ? 'red' : 'player');

/** The guest's view of the battle: 'player' (bottom of the screen) is their own side. */
function mirror(b: Battle): Battle {
  return {
    get sides() { return {player: b.sides.red, red: b.sides.player}; },
    get winner() { return b.winner ? flip(b.winner) : null; },
    get needSwitch() { return b.needSwitchRed; },
    validate: (a: Action) => b.validateFor('red', a),
    usableSlots: (s: SideId) => b.usableSlots(flip(s)),
    mon: (s: SideId) => b.mon(flip(s)),
    lockedMove: (s: SideId) => b.lockedMove(flip(s)),
    canUseItem: (s: SideId, item: string, t?: number, m?: number) => b.canUseItem(flip(s), item, t, m),
    itemError: (s: SideId, item: string, t?: number, m?: number) => b.itemError(flip(s), item, t, m),
    name: (s: SideId) => b.name(flip(s)),
  } as unknown as Battle;
}
const flipEvents = (ev: BattleEvent[]) => ev.map(e => ('side' in e ? {...e, side: flip(e.side)} : e.t === 'end' ? {...e, winner: flip(e.winner)} : e)) as BattleEvent[];

export function setupFor(v: MatchView): PvpSetup {
  const t = v.teams!;
  return {
    seed: v.seed,
    clauses: {sleep: v.options.clauses.sleep, freeze: v.options.clauses.freeze, alwaysRecharge: v.created >= RECHARGE_FROM_MS, sureHit: v.created >= NO_MISS_FROM_MS},
    host: {name: v.host.name, team: toMons(t.host), bag: t.host.bag ?? {}},
    guest: {name: v.guest!.name, team: toMons(t.guest), bag: t.guest.bag ?? {}},
  };
}

export class PvpBattle {
  scene: BattleScene;
  battle: Battle;
  private view: MatchView;
  private guest: boolean;
  private timer = 0;
  private busy = false;
  private stopped = false;
  private timerEl = document.getElementById('timer')!;

  constructor(gfx: Gfx, input: Input, v: MatchView, private onDone: (v: MatchView) => void) {
    this.view = v;
    this.guest = v.side === 'guest';
    const viewer: SideId = this.guest ? 'red' : 'player';
    // Start from round 0 and catch up (lets a player rejoin a battle in progress).
    this.battle = Battle.pvp(setupFor(v), viewer);
    const shown = this.guest ? mirror(this.battle) : this.battle;
    this.scene = new BattleScene(shown, gfx, input, a => void this.choose(a));
    const mine = this.guest ? v.guest : v.host, theirs = this.guest ? v.host : v.guest;
    this.scene.trainerUrls = {me: trainerUrl(mine?.trainer), foe: trainerUrl(theirs?.trainer)};
    const opp = this.opponentName();
    this.scene.endLines = won => (won ? [`You beat ${opp}!`, 'A: see results'] : [`${opp} won this time.`, 'A: see results']);
    this.scene.waitText = () => (this.myDuty() === 'wait' ? `Waiting for ${opp}...` : null);
    this.scene.onEnd = () => { this.stop(); this.onDone(this.view); };
  }

  private opponentName() {
    return (this.guest ? this.view.host.name : this.view.guest?.name) ?? 'your friend';
  }

  /** What I must do now, from the local battle. */
  private myDuty(): 'act' | 'switch' | 'wait' {
    const b = this.battle;
    const mine = this.guest ? b.needSwitchRed : b.needSwitch;
    const theirs = this.guest ? b.needSwitch : b.needSwitchRed;
    return mine ? 'switch' : theirs ? 'wait' : 'act';
  }

  async load() {
    await this.scene.load();
  }

  /** Shows the opening and replays any rounds already played (rejoining). */
  begin() {
    audio.music('battle');
    const ev = this.battle.start();
    if (this.view.rounds.length) {
      // Rejoining: catch up silently and show the battle as it stands.
      for (const r of this.view.rounds) this.battle.stepPvp(r[0], r[1]);
      this.scene.resume();
    } else {
      this.scene.begin(this.guest ? flipEvents(ev) : ev);
    }
    this.timer = window.setInterval(() => void this.tick(), 1500);
    this.timerEl.classList.remove('dev', 'ready');
    document.body.classList.add('pvp-battle');
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timerEl.textContent = '';
    this.timerEl.classList.remove('ready');
    document.body.classList.remove('pvp-battle');
  }

  /** The player picked a move / switch / item on the battle screen. */
  private async choose(a: Action) {
    if (this.busy || this.battle.winner) return;
    this.busy = true;
    this.scene.setWaiting(`Waiting for ${this.opponentName()}...`);
    try {
      this.apply(await act(this.view.id, this.battle.pvpLog.length, a));
    } catch (e) {
      this.scene.play([{t: 'text', s: (e as Error).message}]);
    } finally {
      this.busy = false;
    }
  }

  /** Plays any new rounds from the server on the screen. */
  private apply(v: MatchView) {
    this.view = v;
    if (v.teams) {
      const fresh: BattleEvent[] = [];
      for (const r of v.rounds.slice(this.battle.pvpLog.length)) fresh.push(...this.battle.stepPvp(r[0], r[1]));
      if (fresh.length) this.scene.play(this.guest ? flipEvents(fresh) : fresh);
    }
    if (v.stage === 'done' && !this.battle.winner) {
      // Ended by a forfeit or timeouts rather than in battle.
      const won = v.winner === v.side;
      const opp = this.opponentName();
      const msg = v.how === 'forfeit' ? (won ? `${opp} forfeited!` : 'You forfeited.') : (won ? `${opp} ran out of time!` : 'You ran out of time.');
      this.scene.play([{t: 'text', s: msg}]);
      this.scene.endLines = () => [won ? 'You win!' : `${opp} wins.`, 'A: see results'];
      this.scene.setWaiting(msg);
      setTimeout(() => { this.stop(); this.onDone(v); }, 2500);
    }
  }

  private async tick() {
    if (this.stopped || this.busy) return;
    const v = this.view;
    const o = v.options;
    // Countdown bar above the screen.
    if (o.timer && v.stage === 'battle') {
      const limit = o.timer + (v.rounds.length === 0 ? FIRST_TURN_EXTRA : 0); // first turn: extra time for loading
      const left = Math.max(0, Math.ceil(limit - (Date.now() - v.roundStarted) / 1000));
      const mineToDo = this.myDuty() !== 'wait' && !v.chosen.me;
      this.timerEl.textContent = mineToDo ? `YOUR MOVE · ${left}s` : `WAITING FOR ${this.opponentName().toUpperCase()} · ${left}s`;
      this.timerEl.classList.toggle('ready', mineToDo && left <= 10);
    } else {
      this.timerEl.textContent = `BATTLE VS ${this.opponentName().toUpperCase()}`;
    }
    try {
      const late = o.timer && Date.now() - v.roundStarted > (o.timer + (v.rounds.length === 0 ? FIRST_TURN_EXTRA : 0) + 6) * 1000;
      const myPartDone = v.chosen.me || this.myDuty() === 'wait';
      this.apply(late && myPartDone ? await claimTimeout(v.id) : await matchState(v.id, true));
    } catch { /* offline for a moment: try again next tick */ }
  }
}
