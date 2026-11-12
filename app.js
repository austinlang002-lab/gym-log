// Gym Log — UI. Phase 1: logging.
const APP_VERSION = '0.3.0';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  tab: 'log',
  logDate: todayISO(),
};

// ---------- tabs ----------
const titles = { log: 'Log', calendar: 'Calendar', exercises: 'Exercises', settings: 'Settings' };

function show(tab) {
  ui.tab = tab;
  $('#title').textContent = titles[tab];
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  try { localStorage.setItem('lastTab', tab); } catch (e) {}
  render();
}

function render() {
  const v = $('#view');
  if (ui.tab === 'log') v.innerHTML = logView();
  else if (ui.tab === 'calendar') v.innerHTML = placeholder('Year heatmap', 'Calendar arrives in Phase 2.');
  else if (ui.tab === 'exercises') v.innerHTML = placeholder('Exercise detail', 'PRs, times done and full history arrive in Phase 3.');
  else v.innerHTML = settingsView();
  if (ui.tab === 'settings') runChecks();
}

const placeholder = (h, p) => `<div class="card"><h2>${h}</h2><p class="muted">${p}</p></div>`;

// ---------- Log tab ----------
function logView() {
  const date = ui.logDate, isToday = date === todayISO();
  const w = Q.workoutByDate(date);
  const entries = w ? Q.entriesFor(w.id) : [];
  const tags = w ? Q.tagsFor(w.id) : [];
  const rows = entries.map(e => {
    const ex = DB.state.exercises.get(e.exerciseId);
    if (!ex) return '';
    return `<button class="entry" data-act="edit" data-id="${e.id}">
      <span class="entry-name">${esc(ex.name)}</span>
      <span class="entry-sets">${esc(summarize(e, ex.type))}</span>
    </button>`;
  }).join('');
  return `
    <div class="datebar">
      <button class="icon-btn" data-act="day" data-d="-1" aria-label="Previous day">‹</button>
      <div class="datebar-mid">
        <div class="datebar-day">${isToday ? 'Today' : esc(prettyDate(date, { weekday: 'long' }))}</div>
        <div class="muted small">${esc(prettyDate(date, { month: 'long', day: 'numeric', year: 'numeric' }))}</div>
      </div>
      <button class="icon-btn" data-act="day" data-d="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
    </div>
    ${tags.length ? `<div class="chips static">${tags.map(t => `<span class="chip on">${t}</span>`).join('')}</div>` : ''}
    ${rows || `<div class="empty">No exercises logged${isToday ? ' yet today' : ''}.</div>`}
    <button class="btn" data-act="add">+ Exercise</button>
    ${!isToday ? `<button class="btn ghost" data-act="today">Back to today</button>` : ''}`;
}

// ---------- full-screen sheet ----------
function openSheet(html) {
  const s = $('#sheet');
  s.innerHTML = html;
  s.hidden = false;
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  const s = $('#sheet');
  s.hidden = true;
  s.innerHTML = '';
  document.body.classList.remove('sheet-open');
  render();
}

function sheetHead(left, title, right = '') {
  return `<header class="sheet-head">${left}<h2>${esc(title)}</h2>${right || '<span class="head-spacer"></span>'}</header>`;
}

// Step 1: category
function pickCategory() {
  openSheet(`${sheetHead('<button class="link" data-act="close">Cancel</button>', 'Add exercise')}
    <div class="sheet-body">
      <div class="cat-grid">${CATEGORIES.map(c => `<button class="cat" data-act="cat" data-c="${c}">${c}<span>${Q.exercisesIn(c).length}</span></button>`).join('')}</div>
    </div>`);
}

// Step 2: exercise list, A–Z
function pickExercise(category, filter = '') {
  const f = filter.trim().toLowerCase();
  const list = Q.exercisesIn(category).filter(x => !f || x.name.toLowerCase().includes(f));
  const items = list.map(x => {
    const last = Q.lastEntry(x.id);
    return `<button class="row" data-act="pick" data-id="${x.id}">
      <span>${esc(x.name)}</span>
      <span class="muted small">${last ? esc(prettyDate(last.date, { month: 'short', day: 'numeric', year: '2-digit' })) : 'new'}</span>
    </button>`;
  }).join('');
  openSheet(`${sheetHead('<button class="link" data-act="back-cat">‹ Back</button>', category)}
    <div class="sheet-body">
      <input class="search" id="ex-search" type="search" placeholder="Search ${esc(category)}" value="${esc(filter)}" data-c="${category}" autocomplete="off">
      <div class="list" id="ex-list">${items || `<div class="empty">No ${esc(category.toLowerCase())} exercises yet.</div>`}</div>
      <button class="btn ghost" data-act="new-ex" data-c="${category}">+ New exercise</button>
    </div>`);
}

function refreshExerciseList(category, filter) {
  // Re-render only the list so the search box keeps focus.
  const tmp = document.createElement('div');
  const f = filter.trim().toLowerCase();
  const list = Q.exercisesIn(category).filter(x => !f || x.name.toLowerCase().includes(f));
  tmp.innerHTML = list.map(x => {
    const last = Q.lastEntry(x.id);
    return `<button class="row" data-act="pick" data-id="${x.id}"><span>${esc(x.name)}</span><span class="muted small">${last ? esc(prettyDate(last.date, { month: 'short', day: 'numeric', year: '2-digit' })) : 'new'}</span></button>`;
  }).join('') || `<div class="empty">No match. Tap “New exercise” to add “${esc(filter)}”.</div>`;
  $('#ex-list').innerHTML = tmp.innerHTML;
}

// Step 2b: new exercise
function newExerciseForm(category, name = '') {
  openSheet(`${sheetHead(`<button class="link" data-act="back-list" data-c="${category}">‹ Back</button>`, 'New exercise')}
    <div class="sheet-body">
      <label class="field">Name<input id="nx-name" type="text" value="${esc(name)}" placeholder="e.g. Incline bench" autocomplete="off"></label>
      <div class="field">Category<div class="chips" id="nx-cat">${CATEGORIES.map(c => `<button class="chip ${c === category ? 'on' : ''}" data-act="nx-cat" data-c="${c}">${c}</button>`).join('')}</div></div>
      <div class="field">Type<div class="chips" id="nx-type">${Object.entries(TYPES).map(([k, t]) => `<button class="chip ${k === defaultType(category) ? 'on' : ''}" data-act="nx-type" data-t="${k}">${t.label}</button>`).join('')}</div>
        <p class="muted small" id="nx-hint">${typeHint(defaultType(category))}</p></div>
      <button class="btn" data-act="nx-save">Create and log</button>
    </div>`);
  setTimeout(() => $('#nx-name')?.focus(), 50);
}
const defaultType = c => c === 'Cardio' ? 'cardio' : 'weighted';
const typeHint = t => ({
  weighted: 'Pounds × reps per set.',
  bodyweight: 'Reps per set, with optional added pounds (e.g. weighted dips).',
  timed: 'Seconds per set, with optional pounds (e.g. planks).',
  done: 'No sets. Just marks it done (e.g. Abs circuit).',
  cardio: 'Distance in miles and time in minutes.',
}[t]);

// Step 3: set editor
let editing = null; // { entry, ex }
let saveTimer = null;

function openEditor(entryId) {
  const entry = DB.state.entries.get(entryId);
  const ex = DB.state.exercises.get(entry.exerciseId);
  editing = { entry: structuredClone(entry), ex, holdOn: entry.sets.some(s => s.hold > 0) };
  drawEditor();
}

function drawEditor() {
  const { entry, ex } = editing;
  const w = DB.state.workouts.get(entry.workoutId);
  const last = Q.lastEntry(ex.id, { before: w.date, excludeId: entry.id });
  const fields = TYPES[ex.type].fields;
  const canHold = HOLD_TYPES.includes(ex.type);
  const showHold = canHold && (editing.holdOn || entry.sets.some(s => s.hold > 0));
  const rows = entry.sets.map((s, i) => `
    <div class="set-row">
      <span class="set-n">${i + 1}</span>
      ${fields.map(([k, unit, step]) => stepper(i, k, s[k] ?? 0, unit, step)).join('')}
      <button class="icon-btn small del" data-act="set-del" data-i="${i}" aria-label="Remove set ${i + 1}">✕</button>
      ${showHold ? `<div class="hold-row">${stepper(i, 'hold', s.hold ?? 0, 'sec hold', 5)}</div>` : ''}
    </div>`).join('');
  openSheet(`${sheetHead('<button class="link" data-act="ed-done">‹ Log</button>', ex.name, '<button class="link strong" data-act="ed-done">Done</button>')}
    <div class="sheet-body">
      <p class="muted small">${esc(ex.category)} · ${TYPES[ex.type].label}${last ? ` · Last ${esc(prettyDate(last.date, { month: 'short', day: 'numeric' }))}: ${esc(summarize(last.entry, ex.type))}` : ' · First time'}</p>
      ${ex.type === 'done' ? '<div class="empty">Logged as done. No sets to track.</div>' : `
      ${canHold ? `<div class="chips"><button class="chip ${showHold ? 'on' : ''}" data-act="hold-toggle">⏱ Hold</button></div>` : ''}
      <div class="sets">${rows || '<div class="empty">No sets.</div>'}</div>
      <button class="btn ghost" data-act="set-add">+ Add set</button>`}
      <label class="field">Note<input id="ed-note" type="text" value="${esc(entry.note)}" placeholder="Optional (e.g. each arm)"></label>
      <button class="btn danger" data-act="ed-delete">Remove from workout</button>
    </div>`);
}

function stepper(i, k, v, unit, step) {
  return `<div class="stepper">
    <button class="step" data-act="step" data-i="${i}" data-k="${k}" data-s="${-step}" aria-label="minus ${step} ${unit}">−</button>
    <label><input class="step-val" inputmode="decimal" data-i="${i}" data-k="${k}" value="${num(v)}" aria-label="${unit}"><span>${unit}</span></label>
    <button class="step" data-act="step" data-i="${i}" data-k="${k}" data-s="${step}" aria-label="plus ${step} ${unit}">+</button>
  </div>`;
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => M.saveEntry(structuredClone(editing.entry)), 250);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (editing) await M.saveEntry(structuredClone(editing.entry));
}

// ---------- Settings ----------
function settingsView() {
  const n = DB.state;
  return `
    <div class="card">
      <h2>App status</h2>
      <p class="status"><span class="dot" id="dot-mode"></span><span id="st-mode">Checking…</span></p>
      <p class="status"><span class="dot" id="dot-offline"></span><span id="st-offline">Checking…</span></p>
      <p class="status"><span class="dot" id="dot-db"></span><span id="st-db">Checking…</span></p>
    </div>
    <div class="card">
      <h2>Your data</h2>
      <p class="muted">${n.workouts.size} workouts · ${n.entries.size} exercise entries · ${n.exercises.size} exercises</p>
    </div>
    <div class="card">
      <h2>Import history</h2>
      <p class="muted">Load a Gym Log file (.json), such as your converted Notes history. Safe to run twice: nothing is duplicated.</p>
      <label class="btn ghost file-btn">Choose file<input type="file" id="import-file" accept=".json,application/json" hidden></label>
      <p class="muted small" id="import-msg"></p>
    </div>
    <button class="btn danger" data-act="erase">Erase all data</button>
    <p class="muted small center">Gym Log ${APP_VERSION}</p>`;
}

function setStatus(key, ok, text) {
  const dot = document.getElementById('dot-' + key), label = document.getElementById('st-' + key);
  if (!dot || !label) return;
  dot.classList.toggle('ok', ok);
  label.textContent = text;
}

async function runChecks() {
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  setStatus('mode', standalone, standalone ? 'Running from Home Screen' : 'Running in browser (add to Home Screen)');
  const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  setStatus('offline', !!sw, sw ? 'Offline ready' : 'Offline not ready yet (reopen app once)');
  try { await DB.open(); setStatus('db', true, 'On-device storage working'); }
  catch (e) { setStatus('db', false, 'Storage unavailable'); }
}

// ---------- events ----------
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const act = t.dataset.act;

  if (act === 'tab') return show(t.dataset.tab);
  if (act === 'day') { ui.logDate = shiftISO(ui.logDate, +t.dataset.d); if (ui.logDate > todayISO()) ui.logDate = todayISO(); return render(); }
  if (act === 'today') { ui.logDate = todayISO(); return render(); }
  if (act === 'add') return pickCategory();
  if (act === 'close') return closeSheet();
  if (act === 'cat') return pickExercise(t.dataset.c);
  if (act === 'back-cat') return pickCategory();
  if (act === 'back-list') return pickExercise(t.dataset.c);
  if (act === 'new-ex') return newExerciseForm(t.dataset.c, $('#ex-search')?.value || '');
  if (act === 'nx-cat' || act === 'nx-type') {
    t.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === t));
    if (act === 'nx-type') $('#nx-hint').textContent = typeHint(t.dataset.t);
    return;
  }
  if (act === 'nx-save') {
    const name = $('#nx-name').value.trim();
    if (!name) { $('#nx-name').focus(); return; }
    const category = $('#nx-cat .on').dataset.c, type = $('#nx-type .on').dataset.t;
    const dupe = [...DB.state.exercises.values()].find(x => x.name.toLowerCase() === name.toLowerCase());
    const ex = dupe || await M.addExercise({ name, category, type });
    const entry = await M.addEntry(ui.logDate, ex.id);
    return openEditor(entry.id);
  }
  if (act === 'pick') { const entry = await M.addEntry(ui.logDate, t.dataset.id); return openEditor(entry.id); }
  if (act === 'edit') return openEditor(t.dataset.id);

  // editor
  if (act === 'step') {
    const s = editing.entry.sets[+t.dataset.i], k = t.dataset.k;
    s[k] = Math.max(0, +((+(s[k] || 0) + +t.dataset.s).toFixed(2)));
    const input = document.querySelector(`.step-val[data-i="${t.dataset.i}"][data-k="${k}"]`);
    if (input) input.value = num(s[k]);
    return queueSave();
  }
  if (act === 'set-add') {
    const sets = editing.entry.sets;
    sets.push(sets.length ? { ...sets[sets.length - 1] } : blankSet(editing.ex.type));
    queueSave();
    return drawEditor();
  }
  if (act === 'hold-toggle') {
    editing.holdOn = !(editing.holdOn || editing.entry.sets.some(s => s.hold > 0));
    if (!editing.holdOn) { editing.savedHolds = editing.entry.sets.map(s => s.hold); editing.entry.sets.forEach(s => delete s.hold); }
    else editing.entry.sets.forEach((s, i) => { if (!s.hold) s.hold = editing.savedHolds?.[i] || 10; });
    queueSave();
    return drawEditor();
  }
  if (act === 'set-del') { editing.entry.sets.splice(+t.dataset.i, 1); queueSave(); return drawEditor(); }
  if (act === 'ed-done') { await flushSave(); editing = null; return closeSheet(); }
  if (act === 'ed-delete') {
    if (!confirm(`Remove ${editing.ex.name} from this workout?`)) return;
    clearTimeout(saveTimer);
    await M.deleteEntry(editing.entry.id);
    editing = null;
    return closeSheet();
  }

  if (act === 'erase') {
    if (!confirm('Erase ALL workouts and exercises on this phone? This cannot be undone.')) return;
    await DB.clearAll();
    return render();
  }
});

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'ex-search') return refreshExerciseList(t.dataset.c, t.value);
  if (t.classList.contains('step-val') && editing) {
    const v = parseFloat(t.value);
    editing.entry.sets[+t.dataset.i][t.dataset.k] = isNaN(v) ? 0 : Math.max(0, v);
    return queueSave();
  }
  if (t.id === 'ed-note' && editing) { editing.entry.note = t.value; return queueSave(); }
});

document.addEventListener('change', async ev => {
  if (ev.target.id !== 'import-file') return;
  const file = ev.target.files[0], msg = $('#import-msg');
  if (!file) return;
  try {
    msg.textContent = 'Importing…';
    const r = await M.importData(JSON.parse(await file.text()));
    render();
    $('#import-msg').textContent = `Imported ${r.workouts} workouts, ${r.entries} entries, ${r.exercises} exercises.` + (r.skipped ? ` ${r.skipped} already here, skipped.` : '');
  } catch (e) {
    msg.textContent = 'Import failed: ' + (e.message || e);
  }
  ev.target.value = '';
});

// Select the number when a value box is tapped, so typing replaces it.
document.addEventListener('focusin', ev => { if (ev.target.classList?.contains('step-val')) ev.target.select(); });

// Save if the app is backgrounded mid-edit.
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

// ---------- start ----------
(async () => {
  try { await DB.load(); } catch (e) { console.error(e); }
  let start = 'log';
  try { start = localStorage.getItem('lastTab') || 'log'; } catch (e) {}
  show(titles[start] ? start : 'log');
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
