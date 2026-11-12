// Gym Log — UI. Phase 1: logging. Phase 2: calendar + locked day view. Phase 3: exercise history. Phase 5: backup.
const APP_VERSION = '0.6.0';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  tab: 'log',
  logDate: todayISO(),
  unlocked: null,   // a past date the person chose to edit (past days are read-only until then)
  addDate: null,    // the date "+ Exercise" adds to
  dayOpen: null,    // the date shown in the calendar's day sheet
  mainScroll: 0,
  exCat: 'Chest',   // category chip selected on the Exercises tab
  exSearch: '',
  lastBackup: null, // ISO time of the last backup the person saved
};
const BACKUP_DAYS = 7;
const daysSince = iso => iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : Infinity;

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
  else if (ui.tab === 'calendar') v.innerHTML = calendarView();
  else if (ui.tab === 'exercises') v.innerHTML = exercisesView();
  else v.innerHTML = settingsView();
  if (ui.tab === 'settings') runChecks();
}

const placeholder = (h, p) => `<div class="card"><h2>${h}</h2><p class="muted">${p}</p></div>`;

// ---------- a day's workout (Log tab and calendar day sheet) ----------
const isLocked = date => date !== todayISO() && ui.unlocked !== date;

function dayContent(date) {
  const isToday = date === todayISO(), locked = isLocked(date);
  const w = Q.workoutByDate(date);
  const entries = w ? Q.entriesFor(w.id) : [];
  const tags = w ? Q.tagsFor(w.id) : [];
  const rows = entries.map(e => {
    const ex = DB.state.exercises.get(e.exerciseId);
    if (!ex) return '';
    const inner = `<span class="entry-name">${esc(ex.name)}</span>
      <span class="entry-sets">${esc(summarize(e, ex.type))}${e.note ? ` · ${esc(e.note)}` : ''}</span>`;
    return locked ? `<div class="entry locked">${inner}</div>`
                  : `<button class="entry" data-act="edit" data-id="${e.id}">${inner}</button>`;
  }).join('');
  const note = w?.note ? `<p class="muted small day-note">${esc(w.note).replace(/\n/g, '<br>')}</p>` : '';
  let controls;
  if (isToday) controls = `<button class="btn" data-act="add" data-date="${date}">+ Exercise</button>`;
  else if (locked) controls = `<button class="btn ghost" data-act="unlock" data-date="${date}">✎ Edit day</button>`;
  else controls = `<div class="edit-banner">Editing ${esc(prettyDate(date))}</div>
      <button class="btn" data-act="add" data-date="${date}">+ Exercise</button>
      <button class="btn ghost" data-act="lock">Done editing</button>`;
  return `
    ${tags.length ? `<div class="chips static">${tags.map(t => `<span class="chip on">${t}</span>`).join('')}</div>` : ''}
    ${note}
    ${rows || `<div class="empty">${isToday ? 'No exercises logged yet today.' : 'No workout this day.'}</div>`}
    ${controls}`;
}

// ---------- Log tab ----------
function backupBanner() {
  if (!DB.state.entries.size || daysSince(ui.lastBackup) < BACKUP_DAYS) return '';
  const when = ui.lastBackup ? `Last backup ${daysSince(ui.lastBackup)} days ago.` : 'Your data has never been backed up.';
  return `<button class="backup-banner" data-act="backup"><strong>Back up now</strong><span>${when} Saves a file to iCloud Drive.</span></button>`;
}

function logView() {
  const date = ui.logDate, isToday = date === todayISO();
  return `${backupBanner()}
    <div class="datebar">
      <button class="icon-btn" data-act="day" data-d="-1" aria-label="Previous day">‹</button>
      <div class="datebar-mid">
        <div class="datebar-day">${isToday ? 'Today' : esc(prettyDate(date, { weekday: 'long' }))}</div>
        <div class="muted small">${esc(prettyDate(date, { month: 'long', day: 'numeric', year: 'numeric' }))}</div>
      </div>
      <button class="icon-btn" data-act="day" data-d="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
    </div>
    ${dayContent(date)}
    ${!isToday ? `<button class="btn ghost" data-act="today">Back to today</button>` : ''}`;
}

// ---------- Calendar tab ----------
function workoutDates() {
  const set = new Set();
  for (const e of DB.state.entries.values()) {
    const w = DB.state.workouts.get(e.workoutId);
    if (w) set.add(w.date);
  }
  return set;
}

function calendarView() {
  const days = workoutDates(), today = todayISO();
  const [ty, tm] = today.split('-').map(Number);
  const first = [...days].sort()[0] || today;
  const [fy, fm] = first.split('-').map(Number);
  const thisYear = [...days].filter(d => d.startsWith(String(ty))).length;
  const months = [];
  for (let y = ty, m = tm; y > fy || (y === fy && m >= fm); m === 1 ? (y--, m = 12) : m--) months.push([y, m]);
  const head = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="cal-wd">${d}</span>`).join('');
  const p = n => String(n).padStart(2, '0');
  const grids = months.map(([y, m]) => {
    const lead = new Date(y, m - 1, 1).getDay(), count = new Date(y, m, 0).getDate();
    let n = 0, cells = '<span></span>'.repeat(lead);
    for (let d = 1; d <= count; d++) {
      const iso = `${y}-${p(m)}-${p(d)}`, on = days.has(iso), future = iso > today;
      if (on) n++;
      cells += `<button class="cal-day ${on ? 'on' : ''} ${iso === today ? 'today' : ''} ${future ? 'future' : ''}" data-act="open-day" data-date="${iso}" ${future ? 'disabled' : ''} aria-label="${esc(prettyDate(iso))}${on ? ', workout' : ''}">${d}</button>`;
    }
    const name = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `<section class="cal-month">
      <div class="cal-title"><h2>${name}</h2><span class="muted small">${n} workout${n === 1 ? '' : 's'}</span></div>
      <div class="cal-grid">${head}${cells}</div>
    </section>`;
  }).join('');
  return `
    <div class="cal-legend muted small">
      <span><i class="sw on"></i>Workout</span><span><i class="sw"></i>Rest</span>
      <span class="cal-total">${thisYear} this year · ${days.size} total</span>
    </div>
    ${grids}`;
}

// ---------- Exercises tab ----------
// One pass over all entries: sessions per exercise, newest first.
function exerciseStats() {
  const map = new Map();
  for (const e of DB.state.entries.values()) {
    const w = DB.state.workouts.get(e.workoutId);
    if (!w) continue;
    if (!map.has(e.exerciseId)) map.set(e.exerciseId, []);
    map.get(e.exerciseId).push({ entry: e, date: w.date });
  }
  const out = new Map();
  for (const x of DB.state.exercises.values()) {
    const sessions = (map.get(x.id) || []).sort((a, b) => b.date.localeCompare(a.date));
    out.set(x.id, { sessions, times: new Set(sessions.map(s => s.date)).size, pr: personalRecord(x, sessions) });
  }
  return out;
}

// Heaviest weight ever (earliest date it was first lifted). Timed/cardio/bodyweight fall back to their best measure.
function personalRecord(ex, sessions) {
  const best = (key) => {
    let v = 0, date = null;
    for (const s of [...sessions].reverse()) for (const set of s.entry.sets) if ((+set[key] || 0) > v) { v = +set[key]; date = s.date; }
    return v > 0 ? { v, date } : null;
  };
  if (ex.type === 'weighted') { const b = best('w'); return b && { label: 'Heaviest', text: `${num(b.v)} lb`, date: b.date }; }
  if (ex.type === 'bodyweight') {
    const w = best('w'); if (w) return { label: 'Heaviest added', text: `+${num(w.v)} lb`, date: w.date };
    const r = best('r'); return r && { label: 'Most reps', text: `${num(r.v)} reps`, date: r.date };
  }
  if (ex.type === 'timed') { const w = best('w'); if (w) return { label: 'Heaviest', text: `${num(w.v)} lb`, date: w.date };
    const t = best('sec'); return t && { label: 'Longest', text: `${num(t.v)} sec`, date: t.date }; }
  if (ex.type === 'cardio') { const d = best('mi'); if (d) return { label: 'Longest', text: `${num(d.v)} mi`, date: d.date };
    const t = best('min'); return t && { label: 'Longest', text: `${num(t.v)} min`, date: t.date }; }
  return null;
}

const shortDate = iso => prettyDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });

function exercisesView() {
  return `
    <input class="search" id="exlist-search" type="search" placeholder="Search all exercises" value="${esc(ui.exSearch)}" autocomplete="off">
    <div class="chips cat-chips">${CATEGORIES.map(c => `<button class="chip ${c === ui.exCat && !ui.exSearch ? 'on' : ''}" data-act="ex-cat" data-c="${c}">${c}</button>`).join('')}</div>
    <div class="list" id="exlist">${exerciseRows()}</div>`;
}

function exerciseRows() {
  const stats = exerciseStats(), f = ui.exSearch.trim().toLowerCase();
  const list = [...DB.state.exercises.values()]
    .filter(x => f ? x.name.toLowerCase().includes(f) : x.category === ui.exCat)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  if (!list.length) return `<div class="empty">${f ? 'No exercise matches.' : 'No exercises in this category yet.'}</div>`;
  return list.map(x => {
    const s = stats.get(x.id);
    const sub = [s.pr ? `PR ${s.pr.text}` : '', `${s.times}×`, f ? x.category : ''].filter(Boolean).join(' · ');
    return `<button class="row" data-act="open-ex" data-id="${x.id}"><span>${esc(x.name)}</span><span class="muted small nowrap">${esc(sub)}</span></button>`;
  }).join('');
}

function openExercise(id) {
  const ex = DB.state.exercises.get(id), s = exerciseStats().get(id);
  const last = s.sessions[0];
  // One row per day, even if the exercise was logged twice that day.
  const byDay = [];
  for (const { entry, date } of s.sessions) {
    const prev = byDay[byDay.length - 1];
    if (prev && prev.date === date) prev.entries.push(entry); else byDay.push({ date, entries: [entry] });
  }
  const log = byDay.map(({ date, entries }) => {
    const isPR = s.pr && date === s.pr.date;
    return `<div class="log-row ${isPR ? 'pr' : ''}">
      <div class="log-date">${esc(shortDate(date))}${isPR ? ' <span class="pr-tag">PR</span>' : ''}</div>
      ${entries.sort((a, b) => a.order - b.order).map(entry => `<div class="log-sets">${esc(summarize(entry, ex.type))}${entry.note ? `<span class="muted"> · ${esc(entry.note)}</span>` : ''}</div>`).join('')}
    </div>`;
  }).join('');
  openSheet(`${sheetHead('<button class="link" data-act="close">‹ Exercises</button>', ex.name, `<button class="link" data-act="ex-edit" data-id="${id}">Edit</button>`)}
    <div class="sheet-body">
      <p class="muted small">${esc(ex.category)} · ${TYPES[ex.type].label}</p>
      <div class="stat-grid">
        <div class="stat"><span class="stat-label">${s.pr ? esc(s.pr.label) : 'Record'}</span><span class="stat-val">${s.pr ? esc(s.pr.text) : '—'}</span><span class="stat-sub">${s.pr ? esc(shortDate(s.pr.date)) : 'No weight logged'}</span></div>
        <div class="stat"><span class="stat-label">Times done</span><span class="stat-val">${s.times}</span><span class="stat-sub">${last ? 'Last ' + esc(shortDate(last.date)) : 'Never'}</span></div>
      </div>
      <h3 class="section-h">Full log</h3>
      <div class="log">${log || '<div class="empty">Not logged yet.</div>'}</div>
    </div>`);
}

function editExerciseForm(id, msg = '') {
  const ex = DB.state.exercises.get(id);
  openSheet(`${sheetHead(`<button class="link" data-act="open-ex" data-id="${id}">Cancel</button>`, 'Edit exercise', `<button class="link strong" data-act="ex-save" data-id="${id}">Save</button>`)}
    <div class="sheet-body">
      <label class="field">Name<input id="xe-name" type="text" value="${esc(ex.name)}" autocomplete="off"></label>
      <div class="field">Category<div class="chips" id="xe-cat">${CATEGORIES.map(c => `<button class="chip ${c === ex.category ? 'on' : ''}" data-act="nx-cat" data-c="${c}">${c}</button>`).join('')}</div></div>
      <p class="muted small">Type: ${TYPES[ex.type].label}. Renaming to an existing exercise's name merges the two, keeping every session.</p>
      ${msg ? `<p class="edit-banner">${esc(msg)}</p>` : ''}
    </div>`);
}

async function saveExerciseEdit(id) {
  const ex = DB.state.exercises.get(id);
  const name = $('#xe-name').value.trim(), category = $('#xe-cat .on').dataset.c;
  if (!name) return editExerciseForm(id, 'Name can’t be empty.');
  const other = [...DB.state.exercises.values()].find(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase());
  if (other) {
    if (other.type !== ex.type) return editExerciseForm(id, `“${other.name}” exists but is ${TYPES[other.type].label}, not ${TYPES[ex.type].label}, so they can’t be merged.`);
    const n = [...DB.state.entries.values()].filter(e => e.exerciseId === id).length;
    if (!confirm(`Merge “${ex.name}” into “${other.name}”? Its ${n} logged entr${n === 1 ? 'y moves' : 'ies move'} over and “${ex.name}” is removed.`)) return;
    await M.mergeExercise(id, other.id);
    return openExercise(other.id);
  }
  await M.updateExercise(id, { name, category });
  return openExercise(id);
}

// ---------- backup ----------
async function backup() {
  const json = JSON.stringify(M.exportData());
  const name = `gym-log-backup-${todayISO()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Gym Log backup' });  // share sheet → Save to Files → iCloud Drive
    } else {
      const url = URL.createObjectURL(file), link = document.createElement('a');
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } catch (e) {
    if (e.name === 'AbortError') return false;  // closed the share sheet without saving
    alert('Backup failed: ' + (e.message || e));
    return false;
  }
  ui.lastBackup = new Date().toISOString();
  await DB.setMeta('lastBackup', ui.lastBackup);
  render();
  return true;
}

function openDay(date) {
  ui.dayOpen = date;
  openSheet(`${sheetHead('<button class="link" data-act="close-day">‹ Calendar</button>', prettyDate(date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}
    <div class="sheet-body">${dayContent(date)}</div>`);
}

// ---------- full-screen sheet ----------
function openSheet(html) {
  const s = $('#sheet');
  if (s.hidden) ui.mainScroll = window.scrollY;
  s.innerHTML = html;
  s.hidden = false;
  document.body.classList.add('sheet-open');
}
// Closing a step returns to the calendar's day sheet if that is where it started.
function closeSheet() {
  if (ui.dayOpen) return openDay(ui.dayOpen);
  const s = $('#sheet');
  s.hidden = true;
  s.innerHTML = '';
  document.body.classList.remove('sheet-open');
  render();
  window.scrollTo(0, ui.mainScroll);
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
  openSheet(`${sheetHead('<button class="link" data-act="ed-done">‹ Back</button>', ex.name, '<button class="link strong" data-act="ed-done">Done</button>')}
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
      <h2>Backup</h2>
      <p class="muted">Saves all your workouts as one file. In the share sheet, tap <strong>Save to Files</strong>, then <strong>iCloud Drive</strong>.</p>
      <p class="muted small">${ui.lastBackup ? `Last backup: ${esc(prettyDate(todayISO(new Date(ui.lastBackup)), { month: 'short', day: 'numeric', year: 'numeric' }))}` : 'No backup yet.'}</p>
      <button class="btn" data-act="backup">Back up now</button>
    </div>
    <div class="card">
      <h2>Restore or import</h2>
      <p class="muted">Load a backup or history file. Adds what is missing and never duplicates. To restore exactly, erase first, then restore.</p>
      <label class="btn ghost file-btn">Choose file<input type="file" id="import-file" hidden></label>
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

  if (act === 'tab') { ui.unlocked = null; return show(t.dataset.tab); }
  if (act === 'day') { ui.logDate = shiftISO(ui.logDate, +t.dataset.d); if (ui.logDate > todayISO()) ui.logDate = todayISO(); ui.unlocked = null; return render(); }
  if (act === 'today') { ui.logDate = todayISO(); ui.unlocked = null; return render(); }
  if (act === 'unlock') { ui.unlocked = t.dataset.date; return ui.dayOpen ? openDay(ui.dayOpen) : render(); }
  if (act === 'lock') { ui.unlocked = null; return ui.dayOpen ? openDay(ui.dayOpen) : render(); }
  if (act === 'ex-cat') { ui.exCat = t.dataset.c; ui.exSearch = ''; return render(); }
  if (act === 'open-ex') return openExercise(t.dataset.id);
  if (act === 'ex-edit') return editExerciseForm(t.dataset.id);
  if (act === 'ex-save') return saveExerciseEdit(t.dataset.id);
  if (act === 'backup') return backup();
  if (act === 'open-day') { ui.unlocked = null; return openDay(t.dataset.date); }
  if (act === 'close-day') { ui.dayOpen = null; ui.unlocked = null; return closeSheet(); }
  if (act === 'add') { ui.addDate = t.dataset.date || ui.logDate; return pickCategory(); }
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
    const entry = await M.addEntry(ui.addDate || ui.logDate, ex.id);
    return openEditor(entry.id);
  }
  if (act === 'pick') { const entry = await M.addEntry(ui.addDate || ui.logDate, t.dataset.id); return openEditor(entry.id); }
  if (act === 'edit') {
    const e = DB.state.entries.get(t.dataset.id), w = e && DB.state.workouts.get(e.workoutId);
    if (!w || isLocked(w.date)) return;  // past days stay read-only until "Edit day"
    return openEditor(t.dataset.id);
  }

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
  if (t.id === 'exlist-search') {
    ui.exSearch = t.value;
    $('#exlist').innerHTML = exerciseRows();
    document.querySelectorAll('.cat-chips .chip').forEach(c => c.classList.toggle('on', !ui.exSearch && c.dataset.c === ui.exCat));
    return;
  }
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
  try { await DB.load(); ui.lastBackup = await DB.getMeta('lastBackup') || null; } catch (e) { console.error(e); }
  let start = 'log';
  try { start = localStorage.getItem('lastTab') || 'log'; } catch (e) {}
  show(titles[start] ? start : 'log');
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
