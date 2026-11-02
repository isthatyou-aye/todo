// =============================================================
// common.js - fungsi bersama untuk semua halaman
// (request ke API, ikon, tema, toast, format tanggal, info aplikasi)
// Semua request ke /api/... diterima Nginx (container web) lalu
// diteruskan ke container api.
// =============================================================
(function () {
  'use strict';

  // ---------- Ikon SVG (digambar sendiri, tanpa library) ----------
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    flag: '<path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6M12 16.8h.01"/>',
    checkAll: '<path d="M2 12.5l4 4 8.5-9M10.5 16l.5.5 9-9.5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
    notes: '<path d="M5 6h14M5 12h14M5 18h9"/>',
    subtasks: '<path d="M4 6l2 2 3-3M12 7h8M4 15l2 2 3-3M12 16h8"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
    today: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4M12 17h.01"/>',
    done: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    nodate: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M9 14l6 5M15 14l-6 5"/>',
    logo: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>',
  };

  function icon(name, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon' + (className ? ' ' + className : ''));
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  // Mengganti semua <i data-icon="nama"></i> di HTML dengan SVG
  function hydrateIcons(root) {
    (root || document).querySelectorAll('i[data-icon]').forEach((el) => {
      el.replaceWith(icon(el.dataset.icon, el.className));
    });
  }

  // Membuat elemen DOM dengan aman (teks lewat textContent, bukan innerHTML)
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child);
    }
    return node;
  }

  // ---------- Request ke API ----------
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function api(path, options) {
    const opts = Object.assign({ method: 'GET' }, options);
    const init = { method: opts.method, headers: {}, keepalive: opts.keepalive };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }

    let res;
    try {
      res = await fetch('/api' + path, init);
    } catch (err) {
      throw new ApiError('Tidak bisa terhubung ke server. Periksa apakah container masih berjalan.', 0);
    }

    if (res.status === 204) return null;
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json().catch(() => null) : null;

    if (!res.ok) {
      if (body && body.error) throw new ApiError(body.error, res.status);
      if (res.status >= 502) {
        throw new ApiError('Service api sedang tidak bisa dihubungi (' + res.status + '). Pastikan container todo-api berjalan.', res.status);
      }
      throw new ApiError('Request gagal (' + res.status + ').', res.status);
    }
    return body;
  }

  // ---------- Tema terang/gelap ----------
  function currentTheme() {
    const forced = document.documentElement.getAttribute('data-theme');
    if (forced) return forced;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setupThemeToggle(button) {
    if (!button) return;
    const paint = () => {
      const dark = currentTheme() === 'dark';
      button.replaceChildren(icon(dark ? 'sun' : 'moon'));
      button.setAttribute('aria-label', dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap');
      button.title = dark ? 'Tema terang' : 'Tema gelap';
    };
    button.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('todo-theme', next); } catch (err) { /* abaikan */ }
      paint();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
    paint();
  }

  // ---------- Toast (notifikasi kecil di bawah layar) ----------
  function toast(message, options) {
    const opts = Object.assign({ duration: 4000 }, options);
    let container = document.querySelector('.toasts');
    if (!container) {
      container = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.append(container);
    }

    const node = el('div', { class: 'toast' + (opts.error ? ' is-error' : '') }, el('span', { text: message }));
    let timer;
    const close = () => {
      clearTimeout(timer);
      if (!node.isConnected) return;
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 200);
    };

    if (opts.action) {
      node.append(el('button', {
        class: 'toast-action',
        type: 'button',
        text: opts.action.label,
        onclick: () => { opts.action.onClick(); close(); },
      }));
    }

    container.append(node);
    timer = setTimeout(() => { close(); if (opts.onTimeout) opts.onTimeout(); }, opts.duration);
    return { close };
  }

  // ---------- Tanggal (semua memakai zona waktu lokal pengguna) ----------
  const pad = (n) => String(n).padStart(2, '0');

  function toISODate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function parseISODate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function addDays(iso, n) {
    const date = parseISODate(iso);
    date.setDate(date.getDate() + n);
    return toISODate(date);
  }

  function daysBetween(fromIso, toIso) {
    const a = parseISODate(fromIso);
    const b = parseISODate(toIso);
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  }

  const WEEKDAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  function formatShortDate(iso) {
    const date = parseISODate(iso);
    const opts = { day: 'numeric', month: 'short' };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString('id-ID', opts);
  }

  function formatLongDate(iso) {
    return parseISODate(iso).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  // Label tenggat yang mudah dibaca: "Terlambat 2 hari", "Hari ini", "Besok", "Kamis", "12 Nov"
  function describeDue(iso) {
    const diff = daysBetween(todayISO(), iso);
    if (diff < 0) return { label: 'Terlambat ' + -diff + ' hari', kind: 'overdue' };
    if (diff === 0) return { label: 'Hari ini', kind: 'today' };
    if (diff === 1) return { label: 'Besok', kind: 'soon' };
    if (diff < 7) return { label: WEEKDAYS[parseISODate(iso).getDay()], kind: 'soon' };
    return { label: formatShortDate(iso), kind: 'later' };
  }

  function formatDateTime(isoTimestamp) {
    return new Date(isoTimestamp).toLocaleString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function formatRelative(isoTimestamp) {
    const seconds = Math.round((Date.now() - Date.parse(isoTimestamp)) / 1000);
    if (seconds < 60) return 'baru saja';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' menit lalu';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + ' jam lalu';
    const days = daysBetween(toISODate(new Date(isoTimestamp)), todayISO());
    if (days === 1) return 'kemarin';
    if (days < 7) return days + ' hari lalu';
    return formatShortDate(toISODate(new Date(isoTimestamp)));
  }

  const PRIORITY_LABEL = { none: 'Tanpa prioritas', low: 'Rendah', medium: 'Sedang', high: 'Tinggi' };

  // ---------- Info aplikasi (nama dari environment variable APP_NAME) ----------
  async function loadAppInfo() {
    try {
      const info = await api('/info');
      document.querySelectorAll('[data-app-name]').forEach((node) => { node.textContent = info.appName; });
      const footer = document.querySelector('[data-app-footer]');
      if (footer) {
        footer.textContent = info.appName + ', versi ' + info.appVersion + ' (' + info.appEnv + ').';
      }
      const page = document.body.dataset.pageTitle;
      if (page) document.title = page + ' | ' + info.appName;
      return info;
    } catch (err) {
      return null;
    }
  }

  function isTypingTarget(target) {
    return target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  hydrateIcons();
  setupThemeToggle(document.getElementById('theme-toggle'));
  loadAppInfo();

  window.App = {
    icon,
    hydrateIcons,
    el,
    api,
    ApiError,
    toast,
    todayISO,
    addDays,
    daysBetween,
    toISODate,
    parseISODate,
    describeDue,
    formatShortDate,
    formatLongDate,
    formatDateTime,
    formatRelative,
    PRIORITY_LABEL,
    WEEKDAYS,
    isTypingTarget,
  };
})();
