# PokeBattles: Friend battles plan

Status: **planning only, not started.** Agreed with the user on 2026-10-12. Build only when they say go.

## What the user wants
- **Two battle types:** *ghost* (fight your friend's team, played by the game's AI, anytime) **and** *live* (both online, real-time turns).
- **Three draft modes:**
  1. **Free pick:** choose from all 151, but no Pokémon can be picked twice across the two players.
  2. **Point budget:** each Pokémon has a cost, and 6 Pokémon must fit within a budget.
  3. **Snake draft:** take turns picking from a shared random pool.
- **Friends list** with stats: wins and losses against each friend, history of past matches.
- **All Gen 1 clauses:** sleep, freeze, OHKO ban, evasion ban, Wrap/Bind/Fire Spin/Clamp ban, species clause.

## Recommendations given (waiting on the user's answers where marked ❓)
- **Build order:** ghost battles first, live battles second. Live reuses everything else.
- **Free pick ❓:** snake turn order (A, B, B, A, A, B…) to offset first-pick advantage, plus an optional limit of one legendary per team (Mewtwo, Mew, Articuno, Zapdos, Moltres).
  - In ghost mode: the challenger drafts first from all 151, then the friend drafts from what's left. Works without waiting on each other.
- **Point budget ❓:** costs based on Gen 1 strength (Mewtwo ~30, Tauros/Chansey ~20, mid-tier ~10, Magikarp 1), 100 points for 6. Picks made secretly at the same time with duplicates allowed, or no duplicates like free pick.
- **Snake draft:** a shared random pool of about 18 Pokémon.
- **Moves for drafted Pokémon:** the player picks 4 from that Pokémon's real moves (level-up + TM/HM), each showing type, power and accuracy. A "Recommended" button fills a set using the daily rule. Clause-banned moves are greyed out.
- **Stats:** all Pokémon level 50 with perfect stats (max DVs, max stat exp).
- **Items ❓:** Gen 1 has no held items, and bag items such as Full Restore spam break player-vs-player. Default to no items, with an optional small budget (e.g. 3 picks, no Full Restore or Max Potion).
- **Accounts ❓:** Supabase Auth, starting with Google login plus email login codes. Skip Sign in with Apple at first (it needs a $99/yr developer account). Usernames need a bad-word filter.
  - Add friends by friend code (e.g. `ASH-4821`) or an invite link.
- **Replays:** every battle is already stored as a list of moves, so a "watch replay" button is cheap to add.
- **Ghost AI ❓:** starts as the smart Red AI. Later upgrade: copy the friend's habits from their past battles.
- **Live battles:**
  - Supabase Realtime, with the server resolving each turn only after both players have chosen, so choices stay hidden.
  - 45-second turn timer: a timeout picks a move automatically, and 3 timeouts lose the match.
  - Rejoin after a disconnect by replaying the move list.
- **Risks:** more visibility to Nintendo once there are accounts and social features; usernames need moderating.

## Clauses to enforce
- **Sleep clause:** only one opposing Pokémon put to sleep by you at a time.
- **Freeze clause:** only one Pokémon per team frozen at a time.
- **OHKO ban:** Fissure, Horn Drill, Guillotine.
- **Evasion ban:** Double Team, Minimize.
- **Trapping ban:** Wrap, Bind, Fire Spin, Clamp.
- **Species clause:** no duplicates on a team.

## Build phases
0. **Decisions:** answer the ❓ items above.
1. **Engine upgrade:**
   - The engine runs two human-built teams, not only player vs Red.
   - Battle text written from each viewer's side.
   - The clauses above.
   - Point costs, and level-50 perfect stats.
   - Server checks that each team is legal.
2. **Accounts and friends:** login, username, friend codes and invite links, friends list screen.
3. **Team builder:** Gen 1-style draft screens for the 3 modes, a move picker with "Recommended", an item picker, saved teams.
4. **Ghost battles:**
   - Send a challenge; the friend accepts and drafts.
   - Each player fights the other's team.
   - The server checks both battles.
   - A head-to-head results screen. **This is the first playable friend mode.**
5. **Stats and history:** record against each friend, match list, replays.
6. **Live battles:** real-time lobby, live drafting, hidden simultaneous turns, timers, rejoining, rematch.
7. **Notifications:** "You've been challenged" and "Your turn". These need the game added to the home screen on iPhone.

## Open questions for the user
1. Free pick: snake order? Limit of one legendary per team?
2. Point budget: picks made at the same time with duplicates allowed, or no duplicates?
3. Items in friend battles: none, a small budget, or chosen per match?
4. Login: Google plus email codes OK?
5. Ghost AI: Red's AI first, with "copy habits" later?
