// =============================================================
// server.js
// Service "api": REST API untuk aplikasi To-Do List.
// Proses ini STATELESS: semua data disimpan lewat TaskStore ke
// volume /data, jadi container boleh dihapus/diganti kapan saja.
// =============================================================
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const config = require('./config');
const { logger, requestLogger } = require('./logger');
const { TaskStore } = require('./store');
const { computeStats, parseTzOffset } = require('./stats');
const { ValidationError, parseNewTask, parseTaskChanges, parseIdList } = require('./validation');

const store = new TaskStore(config.dataDir);
const startedAt = new Date();
const app = express();

// Jangan bocorkan informasi "X-Powered-By: Express" ke klien
app.disable('x-powered-by');
// Percayai header X-Forwarded-For dari Nginx (reverse proxy) di depan kita
app.set('trust proxy', 'loopback, uniquelocal');

// Setiap request diberi ID. Kalau Nginx sudah mengirim X-Request-ID,
// ID yang sama dipakai, sehingga log Nginx dan log API bisa dicocokkan.
app.use((req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.set('X-Request-ID', req.id);
  next();
});
app.use(requestLogger);

// Import file backup boleh lebih besar (1 MB); request lain cukup 128 KB.
// Route ini harus didaftarkan SEBELUM parser JSON umum di bawahnya.
app.post('/api/tasks/import', express.json({ limit: '1mb' }), async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.tasks;
  const imported = await store.importTasks(items);
  logger.info('Import tugas', { imported, request_id: req.id });
  res.status(201).json({ imported });
});

app.use(express.json({ limit: '128kb' }));

// ---------- Endpoint sistem ----------

// Dipakai HEALTHCHECK container untuk mengecek apakah aplikasi sehat
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

// Informasi runtime: nama aplikasi untuk header UI, dan data untuk monitoring
app.get('/api/info', (req, res) => {
  const user = os.userInfo();
  res.json({
    appName: config.appName,
    appEnv: config.appEnv,
    appVersion: config.appVersion,
    hostname: os.hostname(), // di container = ID container
    user: { name: user.username, uid: user.uid }, // membuktikan non-root
    nodeVersion: process.version,
    pid: process.pid,
    port: config.port,
    dataDir: store.dataDir,
    taskCount: store.count(),
    logFormat: config.logFormat,
    // Hanya memberi tahu ADA/TIDAK, nilai secret tidak pernah ditampilkan
    adminTokenConfigured: config.adminToken !== '',
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// Statistik untuk halaman Ringkasan
app.get('/api/stats', (req, res) => {
  res.json(computeStats(store.list(), parseTzOffset(req.query.tzOffset)));
});

// ---------- Endpoint tugas ----------

app.get('/api/tasks', (req, res) => {
  res.json(store.list());
});

app.post('/api/tasks', async (req, res) => {
  const task = await store.add(parseNewTask(req.body));
  res.status(201).json(task);
});

// Unduh semua tugas sebagai file JSON (backup)
app.get('/api/tasks/export', (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.set('Content-Disposition', `attachment; filename="todo-backup-${date}.json"`);
  res.type('application/json').send(JSON.stringify(store.list(), null, 2));
});

// Simpan urutan manual hasil drag & drop
app.put('/api/tasks/order', async (req, res) => {
  const ids = parseIdList(req.body?.ids);
  res.json(await store.reorder(ids));
});

// Aksi massal: tandai selesai, buka lagi, atau hapus banyak tugas sekaligus
app.post('/api/tasks/bulk', async (req, res) => {
  const action = req.body?.action;
  if (!['complete', 'reopen', 'delete'].includes(action)) {
    throw new ValidationError('Aksi harus salah satu dari: complete, reopen, delete.');
  }
  const affected = await store.bulk(action, parseIdList(req.body?.ids));
  res.json({ action, affected });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = store.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
  res.json(task);
});

app.patch('/api/tasks/:id', async (req, res) => {
  const task = await store.update(req.params.id, parseTaskChanges(req.body));
  if (!task) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
  res.json(task);
});

app.delete('/api/tasks/:id', async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
  res.status(204).end();
});

// ---------- Endpoint admin (dilindungi SECRET) ----------

// Membandingkan token dengan waktu konstan (mencegah timing attack)
function tokenMatches(given) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(config.adminToken).digest();
  return crypto.timingSafeEqual(a, b);
}

// Menghapus SEMUA tugas. Hanya bisa jika header X-Admin-Token benar.
app.delete('/api/admin/tasks', async (req, res) => {
  if (!config.adminToken) {
    return res.status(503).json({ error: 'Fitur admin nonaktif: ADMIN_TOKEN belum diberikan.' });
  }
  const given = req.get('x-admin-token');
  if (!given || !tokenMatches(given)) {
    return res.status(401).json({ error: 'Token admin salah atau tidak ada.' });
  }
  const removed = await store.clear();
  logger.warn('Semua tugas dihapus oleh admin', { removed, request_id: req.id });
  res.json({ removed });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Endpoint ${req.method} ${req.originalUrl} tidak ada.` });
});

// ---------- Mode development: sajikan frontend tanpa Nginx ----------

if (config.serveStatic) {
  const staticDir = path.resolve(config.serveStatic);
  // extensions: ['html'] membuat /ringkasan membuka ringkasan.html (sama seperti Nginx)
  app.use(express.static(staticDir, { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(staticDir, '404.html')));
}

// ---------- Penanganan error ----------

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Body request bukan JSON yang valid.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Body request terlalu besar.' });
  }
  logger.error('Terjadi error tak terduga', { error: err.message, request_id: req.id });
  res.status(500).json({ error: 'Terjadi kesalahan di server.' });
});

// ---------- Start & graceful shutdown ----------

async function main() {
  const recovered = await store.init();
  if (recovered) {
    logger.warn('File data rusak, dicadangkan dan dimulai dari kosong', recovered);
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`${config.appName} API berjalan`, {
      port: config.port,
      env: config.appEnv,
      version: config.appVersion,
      data_dir: store.dataDir,
      tasks: store.count(),
      admin_token: config.adminToken ? 'diset' : 'tidak diset',
      user: os.userInfo().username,
    });
    if (config.serveStatic) {
      logger.info(`Mode development: buka http://localhost:${config.port}`);
    }
  });

  // `podman stop` mengirim sinyal SIGTERM. Kita tangkap supaya aplikasi
  // berhenti dengan rapi: selesaikan request yang sedang jalan, lalu keluar.
  const shutdown = (signal) => {
    logger.info(`Menerima ${signal}, mematikan server dengan rapi...`);
    server.close(async () => {
      await store.writeQueue.catch(() => {});
      logger.info('Server berhenti. Sampai jumpa!');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Gagal menjalankan aplikasi', { error: err.message, data_dir: config.dataDir });
  process.exit(1);
});
