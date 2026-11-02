// =============================================================
// store.js
// Bagian STATEFUL aplikasi: daftar tugas disimpan di satu file
// JSON (<DATA_DIR>/tasks.json). Di container, DATA_DIR = /data
// dan dipasang sebagai VOLUME, sehingga data tetap ada walaupun
// container dihapus lalu dibuat ulang.
// =============================================================
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { LIMITS, PRIORITIES, ValidationError, parseNewTask } = require('./validation');

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

// Melengkapi tugas lama/hasil import supaya selalu punya semua field.
// (Versi awal aplikasi hanya punya id, title, done.)
function normalizeStored(task, index) {
  const now = new Date().toISOString();
  const createdAt = isIsoDate(task.createdAt) ? task.createdAt : now;
  return {
    id: typeof task.id === 'string' ? task.id : crypto.randomUUID(),
    title: String(task.title ?? 'Tanpa judul').slice(0, LIMITS.title),
    notes: typeof task.notes === 'string' ? task.notes : '',
    done: task.done === true,
    priority: PRIORITIES.includes(task.priority) ? task.priority : 'none',
    dueDate: typeof task.dueDate === 'string' ? task.dueDate : null,
    tags: Array.isArray(task.tags) ? task.tags.filter((t) => typeof t === 'string') : [],
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    order: Number.isFinite(task.order) ? task.order : index,
    createdAt,
    updatedAt: isIsoDate(task.updatedAt) ? task.updatedAt : createdAt,
    completedAt: task.done === true ? (isIsoDate(task.completedAt) ? task.completedAt : createdAt) : null,
  };
}

class TaskStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, 'tasks.json');
    this.tasks = [];
    // Antrean tulis: memastikan penulisan file dilakukan satu per satu
    this.writeQueue = Promise.resolve();
  }

  // Dipanggil sekali saat aplikasi start
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    let recovered = null;

    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('isi file bukan array');
      this.tasks = parsed.map(normalizeStored);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // File rusak: simpan cadangan, lalu mulai dari daftar kosong
        const backup = `${this.file}.corrupt-${Date.now()}`;
        await fs.rename(this.file, backup).catch(() => {});
        recovered = { recoveredFrom: backup, reason: err.message };
      }
      this.tasks = [];
    }

    // Sekaligus mengecek bahwa folder data bisa ditulis (izin volume benar)
    await this.persist();
    return recovered;
  }

  // Tulis atomik: tulis ke file sementara dulu, lalu rename.
  // Jadi file tasks.json tidak pernah setengah tertulis.
  persist() {
    const snapshot = JSON.stringify(this.tasks, null, 2);
    const tmp = `${this.file}.tmp`;
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await fs.writeFile(tmp, snapshot, 'utf8');
        await fs.rename(tmp, this.file);
      });
    return this.writeQueue;
  }

  // ---------- Baca ----------

  list() {
    return [...this.tasks].sort((a, b) => a.order - b.order);
  }

  count() {
    return this.tasks.length;
  }

  get(id) {
    return this.tasks.find((t) => t.id === id) || null;
  }

  ensureCapacity(extra) {
    if (this.tasks.length + extra > LIMITS.tasks) {
      throw new ValidationError(`Jumlah tugas maksimal ${LIMITS.tasks}.`);
    }
  }

  // Tugas baru selalu muncul paling atas (order terkecil)
  nextTopOrder() {
    return this.tasks.reduce((min, t) => Math.min(min, t.order), 0) - 1;
  }

  // ---------- Tulis ----------

  async add(input) {
    this.ensureCapacity(1);
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      ...input,
      done: false,
      order: this.nextTopOrder(),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.tasks.push(task);
    await this.persist();
    return task;
  }

  applyChanges(task, changes, now) {
    Object.assign(task, changes);
    if (changes.done !== undefined) task.completedAt = changes.done ? now : null;
    task.updatedAt = now;
  }

  async update(id, changes) {
    const task = this.get(id);
    if (!task) return null;
    this.applyChanges(task, changes, new Date().toISOString());
    await this.persist();
    return task;
  }

  async remove(id) {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;
    this.tasks.splice(index, 1);
    await this.persist();
    return true;
  }

  // Menyusun ulang urutan manual sesuai daftar id dari drag & drop
  async reorder(ids) {
    const position = new Map(ids.map((id, i) => [id, i]));
    const rest = this.list().filter((t) => !position.has(t.id));
    for (const task of this.tasks) {
      if (position.has(task.id)) task.order = position.get(task.id);
    }
    rest.forEach((task, i) => { task.order = ids.length + i; });
    await this.persist();
    return this.list();
  }

  // Aksi massal: complete | reopen | delete
  async bulk(action, ids) {
    const targets = new Set(ids);
    const now = new Date().toISOString();
    let affected = 0;

    if (action === 'delete') {
      const before = this.tasks.length;
      this.tasks = this.tasks.filter((t) => !targets.has(t.id));
      affected = before - this.tasks.length;
    } else {
      const done = action === 'complete';
      for (const task of this.tasks) {
        if (targets.has(task.id) && task.done !== done) {
          this.applyChanges(task, { done }, now);
          affected += 1;
        }
      }
    }

    if (affected > 0) await this.persist();
    return affected;
  }

  // Import dari file backup: data divalidasi ulang dan diberi id baru
  async importTasks(items) {
    if (!Array.isArray(items)) throw new ValidationError('File import harus berisi daftar tugas.');
    this.ensureCapacity(items.length);

    const now = new Date().toISOString();
    let order = this.nextTopOrder() - items.length;
    const imported = items.map((item, i) => {
      let clean;
      try {
        clean = parseNewTask(item);
      } catch (err) {
        throw new ValidationError(`Tugas ke-${i + 1} di file import tidak valid: ${err.message}`);
      }
      const done = item.done === true;
      const createdAt = isIsoDate(item.createdAt) ? item.createdAt : now;
      return {
        id: crypto.randomUUID(),
        ...clean,
        done,
        order: order++,
        createdAt,
        updatedAt: now,
        completedAt: done ? (isIsoDate(item.completedAt) ? item.completedAt : now) : null,
      };
    });

    this.tasks.push(...imported);
    await this.persist();
    return imported.length;
  }

  async clear() {
    const removed = this.tasks.length;
    this.tasks = [];
    await this.persist();
    return removed;
  }
}

module.exports = { TaskStore };
