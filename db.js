// Gym Log — on-device data store (IndexedDB), with an in-memory copy for speed.
// Records:
//   exercise { id, name, category, type: weighted|bodyweight|timed|cardio, aliases: [] }
//   workout  { id, date: 'YYYY-MM-DD', note }
//   entry    { id, workoutId, exerciseId, order, note, sets: [{ w, r, sec, mi, min }] }
const CATEGORIES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Core', 'Cardio'];
const TYPES = {
  weighted:   { label: 'Weighted',   fields: [['w', 'lb', 5], ['r', 'reps', 1]] },
  bodyweight: { label: 'Bodyweight', fields: [['r', 'reps', 1], ['w', '+lb', 5]] },
  timed:      { label: 'Timed',      fields: [['sec', 'sec', 5], ['w', 'lb', 5]] },
  cardio:     { label: 'Cardio',     fields: [['mi', 'miles', 0.25], ['min', 'min', 1]] },
};

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

  async function getMeta(key) { return req((await store('meta', 'readonly')).get(key)); }
  async function setMeta(key, val) { return req((await store('meta', 'readwrite')).put(val, key)); }

  return { open, load, put, del, clearAll, getMeta, setMeta, state };
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
  exercisesIn(category) {
    return [...DB.state.exercises.values()].filter(x => x.category === category)
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
  async addExercise({ name, category, type }) {
    return DB.put('exercises', { id: uid(), name: name.trim(), category, type, aliases: [] });
  },
  async addEntry(date, exerciseId) {
    const w = await M.ensureWorkout(date);
    const order = Q.entriesFor(w.id).length;
    const last = Q.lastEntry(exerciseId, { before: date }) || Q.lastEntry(exerciseId);
    const ex = DB.state.exercises.get(exerciseId);
    const sets = last ? last.entry.sets.map(s => ({ ...s })) : [blankSet(ex.type)];
    return DB.put('entries', { id: uid(), workoutId: w.id, exerciseId, order, note: '', sets });
  },
  async saveEntry(entry) { return DB.put('entries', entry); },
  async deleteEntry(id) {
    const e = DB.state.entries.get(id);
    await DB.del('entries', id);
    if (e && Q.entriesFor(e.workoutId).length === 0) await DB.del('workouts', e.workoutId);
  },
};

function blankSet(type) {
  return type === 'cardio' ? { mi: 0, min: 0 } : type === 'timed' ? { sec: 30, w: 0 } : type === 'bodyweight' ? { r: 10, w: 0 } : { w: 0, r: 10 };
}

// One-line summary of an entry's sets, e.g. "135×8 ×3 · 135×4".
function summarize(entry, type) {
  const fmt = s => {
    if (type === 'cardio') return [s.mi ? `${num(s.mi)} mi` : '', s.min ? `${num(s.min)} min` : ''].filter(Boolean).join(' · ') || 'done';
    if (type === 'timed') return `${num(s.sec)}s${s.w ? ` @${num(s.w)}` : ''}`;
    if (type === 'bodyweight') return `${num(s.r)} reps${s.w ? ` +${num(s.w)} lb` : ''}`;
    return `${num(s.w)}×${num(s.r)}`;
  };
  const parts = [];
  for (const s of entry.sets) {
    const t = fmt(s), last = parts[parts.length - 1];
    if (last && last.t === t) last.n++; else parts.push({ t, n: 1 });
  }
  return parts.map(p => p.n > 1 ? `${p.t} ×${p.n}` : p.t).join(' · ');
}

function num(v) { return Number.isInteger(+v) ? String(+v) : String(+(+v).toFixed(2)); }
