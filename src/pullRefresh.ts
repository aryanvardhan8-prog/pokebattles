// Pull down to refresh on phones (the menu and web pages scroll inside #home, so the browser's own
// pull-to-refresh doesn't work there, and installed home-screen apps don't have one at all).
// Not during a battle (canvas) or while picking a friend-battle team (it would lose the picks).

const PULL = 70; // px of pull needed

export function initPullRefresh() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const home = document.getElementById('home');
  if (!home) return;
  const tip = document.createElement('div');
  tip.id = 'pull-tip';
  tip.innerHTML = '<i></i><span>Pull to refresh</span>';
  document.body.appendChild(tip);
  let startY = -1, dy = 0;
  const allowed = () => document.body.classList.contains('on-home') && !document.body.classList.contains('sheet-open')
    && !document.getElementById('invite-pop') && !home.querySelector('.steps');
  const show = (d: number) => {
    const p = Math.min(1, d / PULL);
    tip.style.transform = `translate(-50%, ${Math.min(d, PULL + 20) - 50}px)`;
    tip.style.opacity = String(p);
    tip.classList.toggle('ready', p >= 1);
    tip.querySelector('span')!.textContent = p >= 1 ? 'Release to refresh' : 'Pull to refresh';
    tip.querySelector<HTMLElement>('i')!.style.transform = `rotate(${p * 360}deg)`;
  };
  home.addEventListener('touchstart', e => {
    startY = home.scrollTop <= 0 && allowed() && e.touches.length === 1 ? e.touches[0].clientY : -1;
    dy = 0;
  }, {passive: true});
  home.addEventListener('touchmove', e => {
    if (startY < 0) return;
    dy = (e.touches[0].clientY - startY) * 0.55;
    if (dy <= 0 || home.scrollTop > 0) { dy = 0; tip.style.opacity = '0'; return; }
    show(dy);
  }, {passive: true});
  home.addEventListener('touchend', () => {
    if (startY >= 0 && dy >= PULL) {
      tip.classList.add('spin');
      tip.querySelector('span')!.textContent = 'Refreshing…';
      setTimeout(() => location.reload(), 150);
      return;
    }
    startY = -1;
    tip.style.transition = 'transform .2s, opacity .2s';
    tip.style.opacity = '0';
    tip.style.transform = 'translate(-50%, -50px)';
    setTimeout(() => { tip.style.transition = ''; }, 220);
  });
}
