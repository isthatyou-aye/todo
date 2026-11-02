// =============================================================
// dev.js - MODE DEVELOPMENT (tanpa container)
// Dijalankan dengan `npm run dev` dari folder root proyek.
// File ini TIDAK ikut ke image (Containerfile hanya menyalin src/).
//
// Bedanya dengan mode container:
//   - Express ikut menyajikan frontend dari ../web/public (tanpa Nginx)
//   - data disimpan di folder api/data (bukan volume)
//   - kode api otomatis restart ketika file diubah (node --watch)
// =============================================================
const path = require('node:path');

process.env.SERVE_STATIC ??= path.join(__dirname, '..', 'web', 'public');
process.env.DATA_DIR ??= path.join(__dirname, 'data');
process.env.APP_ENV ??= 'development';
process.env.APP_VERSION ??= 'dev';
process.env.PORT ??= '3000';

require('./src/server');
