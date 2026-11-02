// =============================================================
// config.js
// Semua konfigurasi aplikasi dibaca dari ENVIRONMENT VARIABLE.
// Tidak ada nilai rahasia (password/token) yang ditulis di kode.
// =============================================================

function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0 || value > 65535) {
    throw new Error(`Environment variable ${name} tidak valid: "${raw}"`);
  }
  return value;
}

const config = {
  // Port yang didengarkan API di DALAM container
  port: readInt('PORT', 3000),

  // Identitas aplikasi (ditampilkan di halaman Info Sistem)
  appName: process.env.APP_NAME || 'Todo App',
  appEnv: process.env.APP_ENV || 'development',
  appVersion: process.env.APP_VERSION || 'dev',

  // Folder data STATEFUL. Di container, folder ini dipasang sebagai volume.
  dataDir: process.env.DATA_DIR || './data',

  // Format log: "text" (mudah dibaca manusia) atau "json" (terstruktur)
  logFormat: (process.env.LOG_FORMAT || 'text').toLowerCase() === 'json' ? 'json' : 'text',

  // KHUSUS MODE DEVELOPMENT (npm run dev): folder frontend yang ikut
  // disajikan oleh Express, supaya bisa dicoba tanpa Nginx/container.
  // Di container variabel ini TIDAK diset: frontend disajikan container web.
  serveStatic: process.env.SERVE_STATIC || '',

  // SECRET: hanya diberikan saat container dijalankan (podman secret / env).
  // Tidak pernah ditulis di Containerfile, sehingga tidak ikut tersimpan di image.
  // trim(): membuang spasi/enter yang tidak sengaja ikut saat secret dibuat.
  adminToken: (process.env.ADMIN_TOKEN || '').trim(),
};

module.exports = config;
