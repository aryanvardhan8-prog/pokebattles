// "Add to home screen" popup. Android/Chrome: real install button. iPhone: how-to steps
// (Apple doesn't let websites install themselves). Never shown once installed, and
// waits a week after "Not now".

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{outcome: string}> }

let deferred: InstallEvent | null = null;
const KEY = 'pokebattles:install-dismissed';

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferred = e as InstallEvent;
});

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as unknown as {standalone?: boolean}).standalone === true;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function recentlyDismissed() {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < 7 * 864e5;
  } catch {
    return false;
  }
}

/** Shows the popup if it makes sense right now. */
export function maybeShowInstall(delay = 1500) {
  if (isStandalone() || recentlyDismissed() || !matchMedia('(pointer: coarse)').matches) return;
  if (!deferred && !isIOS()) return;
  setTimeout(show, delay);
}

function show() {
  if (document.getElementById('install')) return;
  const ios = !deferred;
  const el = document.createElement('div');
  el.id = 'install';
  el.innerHTML = `
    <div class="install-card" role="dialog" aria-labelledby="install-title">
      <img src="icons/icon-192.png" alt="" width="64" height="64">
      <p class="ip-eyebrow">Add to home screen</p>
      <h2 id="install-title">Play every day!</h2>
      <p>Keep DailyBattles on your home screen. A new island waits each morning.</p>
      ${ios ? `
        <ol>
          <li><span class="step">1</span>Tap <b>Share</b> <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg> in your browser bar</li>
          <li><span class="step">2</span>Tap <b>Add to Home Screen</b></li>
        </ol>
        <button class="install-ok">Got it</button>` : `
        <button class="install-ok">Add to home screen</button>`}
      <button class="install-later">Not now</button>
    </div>`;
  document.body.appendChild(el);
  const close = (dismissed: boolean) => {
    if (dismissed) {
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
    }
    el.remove();
  };
  el.querySelector('.install-later')!.addEventListener('click', () => close(true));
  el.querySelector('.install-ok')!.addEventListener('click', async () => {
    if (deferred) {
      await deferred.prompt();
      deferred = null;
    }
    close(true);
  });
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('sw.js'));
  }
}

/** Shows the popup right away (used for previews). */
export const showInstallPopup = show;
