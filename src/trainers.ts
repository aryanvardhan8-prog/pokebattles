// Trainer pictures players can choose (profile panel). Shown for you in battles and on the island,
// and to your friends in friend battles. Pictures: Pokémon Showdown trainer sprites (public/sprites/trainers/t-*.png).

import {currentUser, setProfileData} from './account';

export const TRAINERS: {id: string; name: string}[] = [
  ['hilbert', 'Hilbert'], ['hilda', 'Hilda'], ['red', 'Red'], ['leaf', 'Leaf'], ['blue', 'Blue'], ['ethan', 'Ethan'],
  ['lyra', 'Lyra'], ['kris', 'Kris'], ['brendan', 'Brendan'], ['may', 'May'], ['lucas', 'Lucas'], ['dawn', 'Dawn'],
  ['nate', 'Nate'], ['rosa', 'Rosa'], ['calem', 'Calem'], ['serena', 'Serena'], ['elio', 'Elio'], ['selene', 'Selene'],
  ['victor', 'Victor'], ['gloria', 'Gloria'], ['misty', 'Misty'], ['brock', 'Brock'], ['erika', 'Erika'], ['ltsurge', 'Lt. Surge'],
  ['sabrina', 'Sabrina'], ['blaine', 'Blaine'], ['giovanni', 'Giovanni'], ['lance', 'Lance'], ['steven', 'Steven'],
  ['cynthia', 'Cynthia'], ['n', 'N'],
].map(([id, name]) => ({id, name}));

export const DEFAULT_TRAINER = 'hilbert';
const KEY = 'pokebattles:trainer';
const valid = (id?: string | null) => (id && TRAINERS.some(t => t.id === id) ? id : DEFAULT_TRAINER);

export const trainerUrl = (id?: string | null) => `${import.meta.env.BASE_URL}sprites/trainers/t-${valid(id)}.png`;

/** Your trainer: from your account when logged in, else this browser. */
export function myTrainer(): string {
  const u = currentUser();
  if (u?.trainer) return valid(u.trainer);
  try { return valid(localStorage.getItem(KEY)); } catch { return DEFAULT_TRAINER; }
}

export async function setMyTrainer(id: string) {
  const t = valid(id);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  if (currentUser()) await setProfileData({trainer: t});
}

/** Where each picture's head is ([centre x, top y] in the 80×80 sprite), for the little faces on the leaderboard. */
const FACES: Record<string, [number, number]> = {hilbert:  [37, 8], hilda:  [38, 5], red:  [37, 8], leaf:  [40, 13], blue:  [37, 2], ethan:  [40, 12], lyra:  [41, 10], kris:  [38, 17], brendan:  [42, 9], may:  [39, 10], lucas:  [38, 13], dawn:  [40, 14], nate:  [38, 6], rosa:  [35, 10], calem:  [39, 4], serena:  [35, 8], elio:  [40, 12], selene:  [42, 10], victor:  [40, 5], gloria:  [43, 2], misty:  [35, 5], brock:  [39, 4], erika:  [40, 6], ltsurge:  [38, 0], sabrina:  [40, 3], blaine:  [45, 0], giovanni:  [40, 0], lance:  [39, 4], steven:  [40, 1], cynthia:  [45, 1], n:  [42, 0]};

/** A trainer's head popping out of a light circle (leaderboard rows). Option C, chosen by Aryan:
 *  no outline; the head breaks out above the circle; the picture is clipped at the circle's bottom half. */
export function trainerFace(id: string | null | undefined): string {
  const t = valid(id), [cx, top] = FACES[t] ?? [40, 4], k = 38 / 24, w = 32 + 16;
  return `<span class="face" aria-hidden="true"><span class="clip"><img src="${trainerUrl(t)}" alt="" loading="lazy"
    style="width:${80 * k}px;height:${80 * k}px;left:${w / 2 - cx * k}px;top:${2 - top * k}px"></span></span>`;
}
