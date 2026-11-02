// =============================================================
// validation.js
// Semua aturan validasi data tugas ada di satu tempat.
// Data dari luar (browser, file import) TIDAK pernah dipercaya
// mentah-mentah: selalu dibersihkan dan dicek di sini dulu.
// =============================================================
const crypto = require('node:crypto');

const LIMITS = {
  title: 200,
  notes: 2000,
  tags: 8,
  tagLength: 24,
  subtasks: 30,
  tasks: 2000,
};

const PRIORITIES = ['none', 'low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /^[\p{L}\p{N}_-]+$/u;

class ValidationError extends Error {}

function cleanTitle(value, field = 'Judul tugas') {
  if (typeof value !== 'string') throw new ValidationError(`${field} wajib diisi.`);
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title) throw new ValidationError(`${field} tidak boleh kosong.`);
  if (title.length > LIMITS.title) {
    throw new ValidationError(`${field} maksimal ${LIMITS.title} karakter.`);
  }
  return title;
}

function cleanNotes(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new ValidationError('Catatan harus berupa teks.');
  const notes = value.trim();
  if (notes.length > LIMITS.notes) {
    throw new ValidationError(`Catatan maksimal ${LIMITS.notes} karakter.`);
  }
  return notes;
}

function cleanPriority(value) {
  if (value === null || value === undefined || value === '') return 'none';
  if (!PRIORITIES.includes(value)) {
    throw new ValidationError('Prioritas harus salah satu dari: none, low, medium, high.');
  }
  return value;
}

function cleanDueDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new ValidationError('Tenggat harus berformat YYYY-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError('Tanggal tenggat tidak valid.');
  }
  return value;
}

function cleanTags(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError('Tag harus berupa daftar.');
  const tags = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new ValidationError('Setiap tag harus berupa teks.');
    const tag = raw.trim().replace(/^#+/, '').toLowerCase();
    if (!tag) continue;
    if (tag.length > LIMITS.tagLength || !TAG_RE.test(tag)) {
      throw new ValidationError(
        `Tag "${raw}" tidak valid: gunakan huruf, angka, - atau _ (maks ${LIMITS.tagLength} karakter).`
      );
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > LIMITS.tags) throw new ValidationError(`Maksimal ${LIMITS.tags} tag per tugas.`);
  return tags;
}

function cleanSubtasks(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError('Subtugas harus berupa daftar.');
  if (value.length > LIMITS.subtasks) {
    throw new ValidationError(`Maksimal ${LIMITS.subtasks} subtugas per tugas.`);
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new ValidationError('Format subtugas tidak valid.');
    const id = typeof item.id === 'string' && /^[\w-]{1,64}$/.test(item.id) ? item.id : crypto.randomUUID();
    return { id, title: cleanTitle(item.title, 'Judul subtugas'), done: item.done === true };
  });
}

function cleanBoolean(value, field) {
  if (typeof value !== 'boolean') throw new ValidationError(`Nilai "${field}" harus true atau false.`);
  return value;
}

// Membersihkan input untuk MEMBUAT tugas baru (title wajib)
function parseNewTask(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('Body request harus berupa objek JSON.');
  return {
    title: cleanTitle(body.title),
    notes: cleanNotes(body.notes),
    priority: cleanPriority(body.priority),
    dueDate: cleanDueDate(body.dueDate),
    tags: cleanTags(body.tags),
    subtasks: cleanSubtasks(body.subtasks),
  };
}

// Membersihkan input untuk MENGUBAH tugas (hanya field yang dikirim)
function parseTaskChanges(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('Body request harus berupa objek JSON.');
  const changes = {};
  if (body.title !== undefined) changes.title = cleanTitle(body.title);
  if (body.notes !== undefined) changes.notes = cleanNotes(body.notes);
  if (body.priority !== undefined) changes.priority = cleanPriority(body.priority);
  if (body.dueDate !== undefined) changes.dueDate = cleanDueDate(body.dueDate);
  if (body.tags !== undefined) changes.tags = cleanTags(body.tags);
  if (body.subtasks !== undefined) changes.subtasks = cleanSubtasks(body.subtasks);
  if (body.done !== undefined) changes.done = cleanBoolean(body.done, 'done');
  if (Object.keys(changes).length === 0) throw new ValidationError('Tidak ada perubahan yang dikirim.');
  return changes;
}

// Membersihkan daftar id (untuk urutan & aksi massal)
function parseIdList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('Daftar id tugas wajib diisi.');
  }
  if (value.length > LIMITS.tasks) throw new ValidationError('Daftar id terlalu panjang.');
  if (!value.every((id) => typeof id === 'string' && id.length <= 64)) {
    throw new ValidationError('Format id tugas tidak valid.');
  }
  return [...new Set(value)];
}

module.exports = {
  LIMITS,
  PRIORITIES,
  ValidationError,
  parseNewTask,
  parseTaskChanges,
  parseIdList,
  cleanDueDate,
};
