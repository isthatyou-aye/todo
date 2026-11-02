// =============================================================
// stats.js
// Menghitung statistik untuk halaman Ringkasan.
// Server berjalan dalam UTC, jadi browser mengirim selisih zona
// waktunya (tzOffset, dalam menit, sama seperti
// Date.getTimezoneOffset()) supaya "hari ini" sesuai jam pengguna.
// =============================================================
const DAY_MS = 24 * 60 * 60 * 1000;

function localDay(isoOrMs, tzOffset) {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  return new Date(ms - tzOffset * 60000).toISOString().slice(0, 10);
}

function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function summarize(task) {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
    tags: task.tags,
    completedAt: task.completedAt,
  };
}

function computeStats(tasks, tzOffset = 0, now = Date.now()) {
  const today = localDay(now, tzOffset);
  const weekAhead = addDays(today, 7);

  const done = tasks.filter((t) => t.done);
  const active = tasks.filter((t) => !t.done);

  const completedDays = new Set(done.map((t) => localDay(t.completedAt, tzOffset)));
  const createdDays = tasks.map((t) => localDay(t.createdAt, tzOffset));

  // Aktivitas 7 hari terakhir (dari 6 hari lalu sampai hari ini)
  const last7Days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    last7Days.push({
      date,
      completed: done.filter((t) => localDay(t.completedAt, tzOffset) === date).length,
      created: createdDays.filter((d) => d === date).length,
    });
  }

  // Streak: jumlah hari berturut-turut (sampai hari ini atau kemarin)
  // yang punya minimal satu tugas diselesaikan
  let streak = 0;
  let cursor = completedDays.has(today) ? today : addDays(today, -1);
  while (completedDays.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const byPriority = ['high', 'medium', 'low', 'none'].map((priority) => {
    const group = tasks.filter((t) => t.priority === priority);
    return { priority, total: group.length, done: group.filter((t) => t.done).length };
  });

  const tagMap = new Map();
  for (const task of tasks) {
    for (const tag of task.tags) {
      const entry = tagMap.get(tag) || { tag, total: 0, done: 0 };
      entry.total += 1;
      if (task.done) entry.done += 1;
      tagMap.set(tag, entry);
    }
  }
  const byTag = [...tagMap.values()]
    .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag))
    .slice(0, 8);

  const upcoming = active
    .filter((t) => t.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6)
    .map(summarize);

  const recentlyCompleted = [...done]
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
    .slice(0, 6)
    .map(summarize);

  const subtasks = tasks.flatMap((t) => t.subtasks);

  return {
    today,
    total: tasks.length,
    done: done.length,
    active: active.length,
    completionRate: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
    overdue: active.filter((t) => t.dueDate && t.dueDate < today).length,
    dueToday: active.filter((t) => t.dueDate === today).length,
    dueThisWeek: active.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate < weekAhead).length,
    createdToday: createdDays.filter((d) => d === today).length,
    completedToday: done.filter((t) => localDay(t.completedAt, tzOffset) === today).length,
    streak,
    subtasks: { total: subtasks.length, done: subtasks.filter((s) => s.done).length },
    last7Days,
    byPriority,
    byTag,
    upcoming,
    recentlyCompleted,
  };
}

function parseTzOffset(raw) {
  const value = Number.parseInt(raw, 10);
  // Zona waktu di dunia berada di antara UTC-12 dan UTC+14
  if (Number.isNaN(value) || value < -840 || value > 720) return 0;
  return value;
}

module.exports = { computeStats, parseTzOffset };
