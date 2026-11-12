// Gym Log — on-device data store (IndexedDB), with an in-memory copy for speed.
// Records:
//   exercise { id, name, category, type: weighted|bodyweight|timed|cardio|done, tags: ['Kettlebell'], aliases: [] }
//   workout  { id, date: 'YYYY-MM-DD', note }
//   entry    { id, workoutId, exerciseId, order, note, sets: [{ w, r, sec, mi, min }] }
const CATEGORIES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Core', 'Cardio'];
// Extra tags an exercise can carry on top of its one category.
const TAGS = ['Kettlebell'];
const KETTLEBELL_DEFAULTS = ['One arm kettlebell press', 'Two arm kettlebell press', 'Kettlebell windmills', 'Kettlebell halos',
  'Kettlebell clean to press', 'Kettlebell cleans', 'Kettlebell swings', 'Kettlebell pull throughs', 'Kettlebell deadlifts',
  'Goblet squats', 'Kettlebell rows', 'Kettlebell pullovers', 'Kettlebell horn lift', 'Kettlebell sit-up thrusters',
  'Kettlebell zombie slides', 'Kettlebell trident'];
const TYPES = {
  weighted:   { label: 'Weighted',   fields: [['w', 'lb', 5], ['r', 'reps', 1]] },
  bodyweight: { label: 'Bodyweight', fields: [['r', 'reps', 1], ['w', '+lb', 5]] },
  timed:      { label: 'Timed',      fields: [['sec', 'sec', 5], ['w', 'lb', 5]] },
  cardio:     { label: 'Cardio',     fields: [['mi', 'miles', 0.25], ['min', 'min', 1]] },
  done:       { label: 'Done only',  fields: [] },
};
const HOLD_TYPES = ['weighted', 'bodyweight'];

const DB = (() => {
  const VERSION = 2;
  let dbp;
  const state = { exercises: new Map(), workouts: new Map(), entries: new Map() };

  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('gymlog', VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('exercises')) d.createObjectStore('exercises', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('workouts')) d.createObjectStore('workouts', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  async function store(name, mode) {
    const d = await open();
    return d.transaction(name, mode).objectStore(name);
  }

  async function load() {
    for (const name of ['exercises', 'workouts', 'entries']) {
      const rows = await req((await store(name, 'readonly')).getAll());
      state[name] = new Map(rows.map(r => [r.id, r]));
    }
    return state;
  }

  async function put(name, obj) {
    state[name].set(obj.id, obj);
    await req((await store(name, 'readwrite')).put(obj));
    return obj;
  }

  async function del(name, id) {
    state[name].delete(id);
    await req((await store(name, 'readwrite')).delete(id));
  }

  async function clearAll() {
    for (const name of ['exercises', 'workouts', 'entries']) {
      state[name].clear();
      await req((await store(name, 'readwrite')).clear());
    }
  }

  async function putMany(name, rows) {
    const d = await open();
    await new Promise((res, rej) => {
      const t = d.transaction(name, 'readwrite'), st = t.objectStore(name);
      for (const r of rows) { st.put(r); state[name].set(r.id, r); }
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  }

  async function getMeta(key) { return req((await store('meta', 'readonly')).get(key)); }
  async function setMeta(key, val) { return req((await store('meta', 'readwrite')).put(val, key)); }

  return { open, load, put, putMany, del, clearAll, getMeta, setMeta, state };
})();

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function todayISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + days));
}

function prettyDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', opts);
}

// ---- queries ----
const Q = {
  workoutByDate(date) {
    for (const w of DB.state.workouts.values()) if (w.date === date) return w;
    return null;
  },
  entriesFor(workoutId) {
    return [...DB.state.entries.values()].filter(e => e.workoutId === workoutId).sort((a, b) => a.order - b.order);
  },
  // A group is a category (Chest…) or a tag (Kettlebell).
  exercisesIn(group) {
    const isTag = TAGS.includes(group);
    return [...DB.state.exercises.values()].filter(x => isTag ? (x.tags || []).includes(group) : x.category === group)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  },
  // Most recent entry for an exercise, optionally only before a given date and excluding one entry.
  lastEntry(exerciseId, { before, excludeId } = {}) {
    let best = null, bestDate = '';
    for (const e of DB.state.entries.values()) {
      if (e.exerciseId !== exerciseId || e.id === excludeId) continue;
      const w = DB.state.workouts.get(e.workoutId);
      if (!w || (before && w.date >= before)) continue;
      if (w.date > bestDate) { best = e; bestDate = w.date; }
    }
    return best ? { entry: best, date: bestDate } : null;
  },
  // Day tags come from the categories logged that day, in a fixed order.
  tagsFor(workoutId) {
    const cats = new Set(Q.entriesFor(workoutId).map(e => DB.state.exercises.get(e.exerciseId)?.category).filter(Boolean));
    return CATEGORIES.filter(c => cats.has(c));
  },
};

// ---- mutations ----
const M = {
  async ensureWorkout(date) {
    return Q.workoutByDate(date) || DB.put('workouts', { id: uid(), date, note: '' });
  },
  async addExercise({ name, category, type, tags = [] }) {
    return DB.put('exercises', { id: uid(), name: name.trim(), category, type, tags, aliases: [] });
  },
  // One-time: tag the kettlebell exercises that came from the Notes history.
  async tagKettlebellDefaults() {
    if (await DB.getMeta('kbTagged')) return;
    const rows = [...DB.state.exercises.values()].filter(x => KETTLEBELL_DEFAULTS.includes(x.name) && !(x.tags || []).includes('Kettlebell'))
      .map(x => ({ ...x, tags: [...(x.tags || []), 'Kettlebell'] }));
    await DB.putMany('exercises', rows);
    // Only mark done once the history is here, so a fresh phone still gets tagged after its import.
    if ([...DB.state.exercises.values()].some(x => KETTLEBELL_DEFAULTS.includes(x.name))) await DB.setMeta('kbTagged', true);
  },
  async addEntry(date, exerciseId) {
    const w = await M.ensureWorkout(date);
    const order = Q.entriesFor(w.id).length;
    const last = Q.lastEntry(exerciseId, { before: date }) || Q.lastEntry(exerciseId);
    const ex = DB.state.exercises.get(exerciseId);
    const sets = ex.type === 'done' ? [] : last ? last.entry.sets.map(s => ({ ...s })) : [blankSet(ex.type)];
    return DB.put('entries', { id: uid(), workoutId: w.id, exerciseId, order, note: '', sets });
  },
  async saveEntry(entry) { return DB.put('entries', entry); },
  // Merge an import file into what is on the phone. Safe to run twice: records already here are skipped.
  async importData(data) {
    if (!data || data.app !== 'gymlog' || !Array.isArray(data.exercises) || !Array.isArray(data.workouts) || !Array.isArray(data.entries))
      throw new Error('This is not a Gym Log file.');
    const st = DB.state, exMap = new Map(), wMap = new Map();
    const byName = new Map([...st.exercises.values()].map(x => [x.name.toLowerCase(), x.id]));
    const byDate = new Map([...st.workouts.values()].map(w => [w.date, w.id]));
    const newEx = [], newW = [], newE = [];
    for (const x of data.exercises) {
      const have = st.exercises.has(x.id) ? x.id : byName.get(String(x.name).toLowerCase());
      if (have) { exMap.set(x.id, have); continue; }
      if (!TYPES[x.type] || !CATEGORIES.includes(x.category)) throw new Error(`Bad exercise: ${x.name}`);
      newEx.push({ id: x.id, name: x.name, category: x.category, type: x.type, tags: (x.tags || []).filter(t => TAGS.includes(t)), aliases: x.aliases || [] });
      exMap.set(x.id, x.id);
    }
    for (const w of data.workouts) {
      const have = byDate.get(w.date);
      if (have) { wMap.set(w.id, have); continue; }
      newW.push({ id: w.id, date: w.date, note: w.note || '' }); wMap.set(w.id, w.id);
    }
    let skipped = 0;
    for (const e of data.entries) {
      if (st.entries.has(e.id)) { skipped++; continue; }
      const workoutId = wMap.get(e.workoutId), exerciseId = exMap.get(e.exerciseId);
      if (!workoutId || !exerciseId) { skipped++; continue; }
      newE.push({ id: e.id, workoutId, exerciseId, order: e.order ?? 0, note: e.note || '', sets: e.sets || [] });
    }
    await DB.putMany('exercises', newEx);
    await DB.putMany('workouts', newW);
    await DB.putMany('entries', newE);
    return { exercises: newEx.length, workouts: newW.length, entries: newE.length, skipped };
  },
  exportData() {
    const st = DB.state;
    return { app: 'gymlog', kind: 'backup', version: 1, exportedAt: new Date().toISOString(),
      exercises: [...st.exercises.values()], workouts: [...st.workouts.values()], entries: [...st.entries.values()] };
  },
  async updateExercise(id, { name, category, tags }) {
    const x = { ...DB.state.exercises.get(id), name: name.trim(), category, tags };
    return DB.put('exercises', x);
  },
  // Move every session of one exercise onto another, then remove the first. Keeps the old name as an alias.
  async mergeExercise(fromId, toId) {
    const from = DB.state.exercises.get(fromId), to = DB.state.exercises.get(toId);
    const moved = [...DB.state.entries.values()].filter(e => e.exerciseId === fromId).map(e => ({ ...e, exerciseId: toId }));
    await DB.putMany('entries', moved);
    await DB.put('exercises', { ...to, aliases: [...new Set([...(to.aliases || []), from.name.toLowerCase(), ...(from.aliases || [])])] });
    await DB.del('exercises', fromId);
    return moved.length;
  },
  async deleteEntry(id) {
    const e = DB.state.entries.get(id);
    await DB.del('entries', id);
    if (e && Q.entriesFor(e.workoutId).length === 0) await DB.del('workouts', e.workoutId);
  },
};

function blankSet(type) {
  if (type === 'done') return {};
  return type === 'cardio' ? { mi: 0, min: 0 } : type === 'timed' ? { sec: 30, w: 0 } : type === 'bodyweight' ? { r: 10, w: 0 } : { w: 0, r: 10 };
}

// One-line summary of an entry's sets, e.g. "135×8 ×3 · 135×4".
function summarize(entry, type) {
  if (type === 'done' || !entry.sets.length) return 'Done';
  const hold = s => s.hold ? ` (${num(s.hold)}s hold)` : '';
  const fmt = s => {
    if (type === 'cardio') return [s.mi ? `${num(s.mi)} mi` : '', s.min ? `${num(s.min)} min` : ''].filter(Boolean).join(' · ') || 'done';
    if (type === 'timed') return `${num(s.sec)}s${s.w ? ` @${num(s.w)}` : ''}`;
    if (type === 'bodyweight') return `${num(s.r)} reps${s.w ? ` +${num(s.w)} lb` : ''}${hold(s)}`;
    return `${num(s.w)}×${num(s.r)}${hold(s)}`;
  };
  const parts = [];
  for (const s of entry.sets) {
    const t = fmt(s), last = parts[parts.length - 1];
    if (last && last.t === t) last.n++; else parts.push({ t, n: 1 });
  }
  return parts.map(p => p.n > 1 ? `${p.t} ×${p.n}` : p.t).join(' · ');
}

function num(v) { return Number.isInteger(+v) ? String(+v) : String(+(+v).toFixed(2)); }
