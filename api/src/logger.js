// =============================================================
// logger.js
// Semua log ditulis ke STDOUT/STDERR (bukan ke file), sesuai
// best practice container: Podman yang menampung log, dan
// kita membacanya dengan perintah `podman logs`.
// =============================================================
const config = require('./config');

function write(level, message, fields = {}) {
  const time = new Date().toISOString();
  const stream = level === 'ERROR' ? process.stderr : process.stdout;

  if (config.logFormat === 'json') {
    stream.write(JSON.stringify({ time, level, message, ...fields }) + '\n');
    return;
  }

  const extra = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  stream.write(`${time} ${level.padEnd(5)} ${message}${extra ? ' ' + extra : ''}\n`);
}

const logger = {
  info: (message, fields) => write('INFO', message, fields),
  warn: (message, fields) => write('WARN', message, fields),
  error: (message, fields) => write('ERROR', message, fields),
};

// Middleware Express: mencatat SETIAP request yang diterima
// (method, path, status, durasi, dan request id dari Nginx).
function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.originalUrl} ${res.statusCode}`, {
      duration_ms: Math.round(durationMs * 10) / 10,
      request_id: req.id,
      client_ip: req.get('x-real-ip') || req.ip,
    });
  });

  next();
}

module.exports = { logger, requestLogger };
