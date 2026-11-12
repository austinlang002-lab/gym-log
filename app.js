// Gym Log — Phase 0 shell: tabs, offline support, storage check.
const APP_VERSION = '0.1.0';

const views = {
  log: () => `
    <div class="card">
      <h2>Today's workout</h2>
      <p class="muted">Logging arrives in Phase 1.</p>
    </div>
    <button class="btn" disabled style="opacity:.5">+ Exercise</button>`,
  calendar: () => `
    <div class="card">
      <h2>Year heatmap</h2>
      <p class="muted">Calendar arrives in Phase 2.</p>
    </div>`,
  exercises: () => `
    <div class="card">
      <h2>Exercises by category</h2>
      <p class="muted">Chest · Back · Shoulders · Biceps · Triceps · Legs · Core · Cardio</p>
    </div>`,
  settings: () => `
    <div class="card">
      <h2>App status</h2>
      <p class="status"><span class="dot" id="dot-mode"></span><span id="st-mode">Checking…</span></p>
      <p class="status"><span class="dot" id="dot-offline"></span><span id="st-offline">Checking…</span></p>
      <p class="status"><span class="dot" id="dot-db"></span><span id="st-db">Checking…</span></p>
    </div>
    <p class="muted">Version ${APP_VERSION}</p>`,
};

const titles = { log: 'Log', calendar: 'Calendar', exercises: 'Exercises', settings: 'Settings' };

function show(tab) {
  document.getElementById('view').innerHTML = views[tab]();
  document.getElementById('title').textContent = titles[tab];
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  try { localStorage.setItem('lastTab', tab); } catch (e) {}
  if (tab === 'settings') runChecks();
}

function setStatus(key, ok, text) {
  const dot = document.getElementById('dot-' + key);
  const label = document.getElementById('st-' + key);
  if (!dot || !label) return;
  dot.classList.toggle('ok', ok);
  label.textContent = text;
}

// Phase 0 acceptance checks, shown in Settings.
async function runChecks() {
  const standalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  setStatus('mode', standalone, standalone ? 'Running from Home Screen' : 'Running in browser (add to Home Screen)');

  const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  setStatus('offline', !!sw, sw ? 'Offline ready' : 'Offline not ready yet (reopen app once)');

  try {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('gymlog', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('meta');
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    setStatus('db', true, 'On-device storage working');
  } catch (e) {
    setStatus('db', false, 'Storage unavailable');
  }
}

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));

let start = 'log';
try { start = localStorage.getItem('lastTab') || 'log'; } catch (e) {}
show(views[start] ? start : 'log');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
