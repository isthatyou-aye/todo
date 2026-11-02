// =============================================================
// tasks.js - halaman Tugas
// Daftar pintar, tag, tambah cepat (#tag !prioritas @tanggal),
// panel detail, drag & drop, undo, pencarian, dan pintasan keyboard.
// =============================================================
(function () {
  'use strict';

  const {
    el, icon, api, toast, todayISO, addDays, describeDue, formatLongDate,
    formatDateTime, formatRelative, PRIORITY_LABEL, isTypingTarget, parseISODate, toISODate,
  } = window.App;

  const PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 };
  const VIEWS = [
    { id: 'all', label: 'Semua tugas', icon: 'inbox' },
    { id: 'today', label: 'Hari ini', icon: 'today' },
    { id: 'upcoming', label: '7 hari ke depan', icon: 'clock' },
    { id: 'overdue', label: 'Terlambat', icon: 'alert', danger: true },
    { id: 'nodate', label: 'Tanpa tenggat', icon: 'nodate' },
    { id: 'done', label: 'Selesai', icon: 'done' },
  ];
  const TAG_RE = /^[\p{L}\p{N}_-]{1,24}$/u;
  const UNDO_MS = 5000;

  // ---------- State ----------
  const prefs = readPrefs();
  const params = new URLSearchParams(location.search);
  const state = {
    tasks: [],
    loading: true,
    view: VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'all',
    tag: params.get('tag') || null,
    priority: 'any',
    search: '',
    sort: prefs.sort || 'manual',
    showDone: prefs.showDone !== false,
    selectedId: null,
    justAddedId: null,
    drawerId: null,
    pendingDeletes: new Set(),
    loadError: null,
  };
  let renderTimer = null;

  // ---------- Elemen ----------
  const $ = (id) => document.getElementById(id);
  const dom = {
    viewList: $('view-list'),
    tagList: $('tag-list'),
    tagEmpty: $('tag-empty'),
    title: $('list-title'),
    sub: $('list-sub'),
    banner: $('banner'),
    bannerText: $('banner-text'),
    composer: $('composer'),
    composerInput: $('composer-input'),
    composerPreview: $('composer-preview'),
    composerHint: $('composer-hint'),
    search: $('search'),
    priority: $('priority-filter'),
    sort: $('sort'),
    menuBtn: $('menu-btn'),
    menu: $('action-menu'),
    importFile: $('import-file'),
    list: $('task-list'),
    empty: $('list-empty'),
    doneGroup: $('done-group'),
    doneToggle: $('done-toggle'),
    doneLabel: $('done-label'),
    doneSheet: $('done-sheet'),
    doneList: $('done-list'),
    drawer: $('drawer'),
    backdrop: $('drawer-backdrop'),
    shortcutDialog: $('shortcut-dialog'),
  };

  function readPrefs() {
    try { return JSON.parse(localStorage.getItem('todo-prefs')) || {}; } catch (err) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem('todo-prefs', JSON.stringify({ sort: state.sort, showDone: state.showDone }));
    } catch (err) { /* abaikan */ }
  }

  function syncUrl() {
    const url = new URL(location.href);
    url.search = '';
    if (state.view !== 'all') url.searchParams.set('view', state.view);
    if (state.tag) url.searchParams.set('tag', state.tag);
    if (state.drawerId) url.searchParams.set('task', state.drawerId);
    history.replaceState(null, '', url);
  }

  const findTask = (id) => state.tasks.find((t) => t.id === id);
  const liveTasks = () => state.tasks.filter((t) => !state.pendingDeletes.has(t.id));

  // ---------- Filter & urutan ----------
  function matchesView(task, view, today) {
    switch (view) {
      case 'today': return Boolean(task.dueDate) && task.dueDate <= today;
      case 'upcoming': return Boolean(task.dueDate) && task.dueDate > today && task.dueDate <= addDays(today, 7);
      case 'overdue': return !task.done && Boolean(task.dueDate) && task.dueDate < today;
      case 'nodate': return !task.dueDate;
      case 'done': return task.done;
      default: return true;
    }
  }

  function matchesSearch(task, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return task.title.toLowerCase().includes(q) ||
      task.notes.toLowerCase().includes(q) ||
      task.tags.some((tag) => tag.includes(q.replace(/^#/, ''))) ||
      task.subtasks.some((s) => s.title.toLowerCase().includes(q));
  }

  function hasFilters() {
    return Boolean(state.tag || state.priority !== 'any' || state.search);
  }

  function sortTasks(list, mode) {
    const byOrder = (a, b) => a.order - b.order;
    const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    const byPriority = (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    const sorters = {
      manual: byOrder,
      due: (a, b) => byDue(a, b) || byPriority(a, b) || byOrder(a, b),
      priority: (a, b) => byPriority(a, b) || byDue(a, b) || byOrder(a, b),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      alpha: (a, b) => a.title.localeCompare(b.title, 'id', { sensitivity: 'base' }),
    };
    return [...list].sort(sorters[mode] || byOrder);
  }

  function visibleLists() {
    const today = todayISO();
    const filtered = liveTasks().filter((t) =>
      matchesView(t, state.view, today) &&
      (!state.tag || t.tags.includes(state.tag)) &&
      (state.priority === 'any' || t.priority === state.priority) &&
      matchesSearch(t, state.search));

    const byCompleted = (a, b) => (b.completedAt || '').localeCompare(a.completedAt || '');
    if (state.view === 'done') return { active: filtered.sort(byCompleted), done: [] };
    return {
      active: sortTasks(filtered.filter((t) => !t.done), state.sort),
      done: state.view === 'overdue' ? [] : filtered.filter((t) => t.done).sort(byCompleted),
    };
  }

  const canReorder = () => state.sort === 'manual' && state.view !== 'done';

  // ---------- Parser tambah cepat ----------
  const WEEKDAY_WORDS = { minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6 };

  function validDate(y, m, d) {
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? toISODate(date) : null;
  }

  function parseDueWord(word) {
    const w = word.toLowerCase();
    const today = todayISO();
    if (['hariini', 'hari-ini', 'today', 'hi'].includes(w)) return today;
    if (['besok', 'tomorrow', 'bsk'].includes(w)) return addDays(today, 1);
    if (w === 'lusa') return addDays(today, 2);
    if (['minggudepan', 'minggu-depan', 'nextweek'].includes(w)) return addDays(today, 7);
    if (w in WEEKDAY_WORDS) {
      const diff = (WEEKDAY_WORDS[w] - parseISODate(today).getDay() + 7) % 7 || 7;
      return addDays(today, diff);
    }
    let m = w.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = w.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
    if (m) {
      const now = new Date();
      let year = m[3] ? +m[3] : now.getFullYear();
      if (year < 100) year += 2000;
      let iso = validDate(year, +m[2], +m[1]);
      if (iso && !m[3] && iso < today) iso = validDate(year + 1, +m[2], +m[1]);
      return iso;
    }
    return null;
  }

  function parseQuickAdd(text) {
    const result = { title: '', tags: [], priority: null, dueDate: null };
    const words = [];
    for (const token of text.trim().split(/\s+/)) {
      if (!token) continue;
      const lower = token.toLowerCase();
      if (/^#/.test(token) && TAG_RE.test(lower.slice(1))) {
        if (!result.tags.includes(lower.slice(1))) result.tags.push(lower.slice(1));
      } else if (/^!(tinggi|t|1|high|penting)$/.test(lower)) {
        result.priority = 'high';
      } else if (/^!(sedang|s|2|medium)$/.test(lower)) {
        result.priority = 'medium';
      } else if (/^!(rendah|r|3|low)$/.test(lower)) {
        result.priority = 'low';
      } else if (token.startsWith('@') && parseDueWord(token.slice(1))) {
        result.dueDate = parseDueWord(token.slice(1));
      } else {
        words.push(token);
      }
    }
    result.title = words.join(' ');
    return result;
  }

  function renderComposerPreview() {
    const parsed = parseQuickAdd(dom.composerInput.value);
    const chips = [];
    if (parsed.dueDate) {
      chips.push(el('span', { class: 'badge badge-preview' }, [icon('calendar'), describeDue(parsed.dueDate).label]));
    }
    if (parsed.priority) {
      chips.push(el('span', { class: 'badge badge-preview' }, [icon('flag'), 'Prioritas ' + PRIORITY_LABEL[parsed.priority].toLowerCase()]));
    }
    parsed.tags.forEach((tag) => chips.push(el('span', { class: 'badge badge-preview', text: '#' + tag })));
    dom.composerPreview.replaceChildren(...chips);
    dom.composerHint.hidden = chips.length > 0;
  }

  // ---------- Render ----------
  function render() {
    clearTimeout(renderTimer);
    renderSidebar();
    const lists = visibleLists();
    renderHead(lists);
    renderList(lists);
    renderDone(lists);
    renderTagSuggestions();
  }

  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  function renderSidebar() {
    const today = todayISO();
    const tasks = liveTasks();
    dom.viewList.replaceChildren(...VIEWS.map((view) => {
      const count = view.id === 'done'
        ? tasks.filter((t) => t.done).length
        : tasks.filter((t) => !t.done && matchesView(t, view.id, today)).length;
      return el('li', null, el('button', {
        type: 'button',
        class: 'side-link' + (view.danger && count > 0 ? ' is-danger' : ''),
        'aria-current': state.view === view.id ? 'true' : 'false',
        onclick: () => setView(view.id),
      }, [icon(view.icon), el('span', { text: view.label }), el('span', { class: 'count' + (count ? '' : ' is-zero'), text: count })]));
    }));
    positionIndicator();

    const tagCounts = new Map();
    for (const task of tasks) {
      for (const tag of task.tags) {
        const entry = tagCounts.get(tag) || { active: 0, total: 0 };
        entry.total += 1;
        if (!task.done) entry.active += 1;
        tagCounts.set(tag, entry);
      }
    }
    const tags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b));
    dom.tagEmpty.hidden = tags.length > 0;
    dom.tagList.replaceChildren(...tags.map((tag) => el('li', null, el('button', {
      type: 'button',
      class: 'side-link',
      'aria-current': state.tag === tag ? 'true' : 'false',
      title: state.tag === tag ? 'Klik lagi untuk melepas filter tag' : 'Tampilkan tugas bertag ' + tag,
      onclick: () => setTag(state.tag === tag ? null : tag),
    }, [el('span', { class: 'tag-hash', text: '#' }), el('span', { text: tag }), el('span', { class: 'count' + (tagCounts.get(tag).active ? '' : ' is-zero'), text: tagCounts.get(tag).active })]))));
  }

  // Menggeser "pil" indikator ke item daftar yang sedang aktif
  let indicatorReady = false;
  function positionIndicator() {
    const indicator = $('view-indicator');
    const active = dom.viewList.querySelector('[aria-current="true"]');
    if (!indicator || !active) return;
    if (!indicatorReady) indicator.classList.add('no-anim');
    indicator.style.transform = 'translateY(' + active.offsetTop + 'px)';
    indicator.style.height = active.offsetHeight + 'px';
    indicator.classList.add('is-visible');
    if (!indicatorReady) {
      indicatorReady = true;
      requestAnimationFrame(() => requestAnimationFrame(() => indicator.classList.remove('no-anim')));
    }
  }

  // Animasi masuk singkat saat berpindah daftar/filter
  function playEnter() {
    for (const node of [$('main-sheet'), $('list-head')]) {
      node.classList.remove('is-entering');
      void node.offsetWidth; // memaksa browser memulai ulang animasi
      node.classList.add('is-entering');
    }
  }

  function renderHead(lists) {
    const view = VIEWS.find((v) => v.id === state.view);
    dom.title.textContent = state.tag && state.view === 'all' ? '#' + state.tag : view.label;

    const parts = [];
    if (state.view === 'all' || state.view === 'today') parts.push(formatLongDate(todayISO()) + '.');
    if (state.loading) {
      parts.push('Memuat tugas...');
    } else if (state.loadError && state.tasks.length === 0) {
      parts.push('Daftar tugas belum bisa dimuat.');
    } else if (state.view === 'done') {
      parts.push(lists.active.length + ' tugas sudah selesai.');
    } else {
      const overdue = lists.active.filter((t) => t.dueDate && t.dueDate < todayISO()).length;
      let text = lists.active.length + ' belum selesai';
      if (lists.done.length) text += ', ' + lists.done.length + ' selesai';
      if (overdue && state.view !== 'overdue') text += ', ' + overdue + ' terlambat';
      parts.push(text + '.');
    }

    const filters = [];
    if (state.tag && state.view !== 'all') filters.push('#' + state.tag);
    if (state.priority !== 'any') filters.push('prioritas ' + PRIORITY_LABEL[state.priority].toLowerCase());
    if (state.search) filters.push('kata "' + state.search + '"');

    const nodes = [parts.join(' ')];
    if (filters.length || state.tag) {
      nodes.push(' Filter: ' + (filters.length ? filters.join(', ') : '#' + state.tag) + '. ');
      nodes.push(el('button', { type: 'button', class: 'badge-tag', text: 'Hapus filter', onclick: clearFilters }));
    }
    dom.sub.replaceChildren(...nodes);
  }

  function renderList(lists) {
    const focusedId = document.activeElement?.closest?.('.task')?.dataset.id;

    if (state.loading) {
      dom.list.replaceChildren(...[1, 2, 3].map(() => el('li', { class: 'skeleton-row', 'aria-hidden': 'true' })));
      dom.empty.hidden = true;
      return;
    }

    if (!lists.active.some((t) => t.id === state.selectedId)) {
      state.selectedId = lists.active[0]?.id || null;
    }
    dom.list.replaceChildren(...lists.active.map((task) => renderTask(task, !task.done && canReorder())));
    dom.list.setAttribute('aria-label', state.view === 'done' ? 'Tugas selesai' : 'Tugas belum selesai');
    state.justAddedId = null;

    const empty = emptyState(lists);
    dom.empty.hidden = !empty;
    dom.empty.replaceChildren(...(empty ? [empty] : []));

    if (focusedId) {
      const row = document.querySelector('.task[data-id="' + CSS.escape(focusedId) + '"]');
      if (row) row.focus({ preventScroll: true });
    }
  }

  function renderDone(lists) {
    const show = !state.loading && lists.done.length > 0;
    dom.doneGroup.hidden = !show;
    if (!show) return;
    dom.doneLabel.textContent = 'Selesai (' + lists.done.length + ')';
    dom.doneToggle.setAttribute('aria-expanded', String(state.showDone));
    dom.doneSheet.hidden = !state.showDone;
    if (state.showDone) dom.doneList.replaceChildren(...lists.done.map((task) => renderTask(task, false)));
  }

  function renderTagSuggestions() {
    const tags = new Set(liveTasks().flatMap((t) => t.tags));
    $('tag-suggestions').replaceChildren(...[...tags].sort().map((tag) => el('option', { value: tag })));
  }

  // Judul dengan kata pencarian ditandai <mark>
  function titleNodes(title) {
    const q = state.search.trim();
    if (!q) return [title];
    const lower = title.toLowerCase();
    const needle = q.toLowerCase();
    const nodes = [];
    let start = 0;
    let index = lower.indexOf(needle);
    while (index !== -1) {
      nodes.push(title.slice(start, index), el('mark', { text: title.slice(index, index + needle.length) }));
      start = index + needle.length;
      index = lower.indexOf(needle, start);
    }
    nodes.push(title.slice(start));
    return nodes;
  }

  function renderTask(task, draggable) {
    const due = task.dueDate && !task.done ? describeDue(task.dueDate) : null;
    const subDone = task.subtasks.filter((s) => s.done).length;

    const meta = el('div', { class: 'task-meta' }, [
      due && el('span', {
        class: 'badge ' + (due.kind === 'overdue' ? 'badge-overdue' : due.kind === 'today' ? 'badge-today' : 'badge-due'),
        title: 'Tenggat ' + formatLongDate(task.dueDate),
      }, [icon('calendar'), due.label]),
      task.done && task.completedAt && el('span', { class: 'meta-item', text: 'Selesai ' + formatRelative(task.completedAt) }),
      task.priority !== 'none' && el('span', { class: 'badge badge-' + task.priority }, [icon('flag'), PRIORITY_LABEL[task.priority]]),
      task.subtasks.length > 0 && el('span', { class: 'meta-item', title: 'Subtugas' }, [icon('subtasks'), subDone + '/' + task.subtasks.length]),
      task.notes && el('span', { class: 'meta-item', title: 'Ada catatan' }, [icon('notes'), el('span', { class: 'sr-only', text: 'Ada catatan' })]),
      ...task.tags.map((tag) => el('button', { type: 'button', class: 'badge badge-tag', dataset: { tag }, text: '#' + tag })),
    ]);

    const selected = task.id === state.selectedId;
    return el('li', {
      class: 'task prio-' + task.priority + (task.done ? ' is-done' : '') + (task.id === state.justAddedId ? ' is-new' : ''),
      dataset: { id: task.id },
      tabindex: selected ? '0' : '-1',
      'aria-label': task.title + (task.done ? ', selesai' : ''),
    }, [
      draggable && el('span', { class: 'drag-handle', title: 'Seret untuk mengurutkan', 'aria-hidden': 'true' }, icon('grip')),
      el('div', { class: 'task-check-cell' }, el('input', {
        type: 'checkbox',
        class: 'check',
        checked: task.done,
        'aria-label': (task.done ? 'Batal selesai: ' : 'Tandai selesai: ') + task.title,
        tabindex: '-1',
      })),
      el('div', { class: 'task-body' }, [
        el('span', { class: 'task-title' }, el('span', { class: 'ink' }, titleNodes(task.title))),
        meta,
      ]),
      el('div', { class: 'task-actions' }, [
        el('button', { type: 'button', class: 'icon-btn btn-edit', dataset: { act: 'open' }, title: 'Buka detail', 'aria-label': 'Buka detail ' + task.title, tabindex: '-1' }, icon('edit')),
        el('button', { type: 'button', class: 'icon-btn is-danger', dataset: { act: 'delete' }, title: 'Hapus', 'aria-label': 'Hapus ' + task.title, tabindex: '-1' }, icon('trash')),
      ]),
    ]);
  }

  function emptyState(lists) {
    if (lists.active.length > 0) return null;
    // API tidak bisa dihubungi: jangan tampilkan "kosong", karena datanya
    // sebenarnya tetap aman di volume, hanya belum bisa dimuat.
    if (state.loadError && state.tasks.length === 0) {
      return el('div', { class: 'empty' }, [
        el('div', { class: 'empty-mark' }, icon('alert')),
        el('h2', { class: 'empty-title', text: 'Daftar tugas belum bisa dimuat' }),
        el('p', { text: 'Datamu tetap aman tersimpan. Service api sedang tidak bisa dihubungi, jadi pastikan container todo-api berjalan, lalu coba lagi.' }),
        el('button', { type: 'button', class: 'btn btn-quiet', text: 'Coba lagi', onclick: () => loadTasks() }),
      ]);
    }
    const total = liveTasks().length;
    const box = (title, text, button, iconName) => el('div', { class: 'empty' }, [
      el('div', { class: 'empty-mark' }, icon(iconName || 'inbox')),
      el('h2', { class: 'empty-title', text: title }),
      el('p', { text }),
      button,
    ]);

    if (total === 0) {
      return box('Halaman masih kosong', 'Tulis tugas pertamamu di kolom di atas. Coba ketik: Kerjakan laporan #uts !tinggi @besok',
        el('button', { type: 'button', class: 'btn', text: 'Tulis tugas pertama', onclick: () => dom.composerInput.focus() }), 'edit');
    }
    if (hasFilters() && lists.done.length === 0) {
      return box('Tidak ada tugas yang cocok', 'Coba kata kunci lain, atau lepas filter untuk melihat semua tugas.',
        el('button', { type: 'button', class: 'btn btn-quiet', text: 'Hapus filter', onclick: clearFilters }), 'search');
    }
    switch (state.view) {
      case 'done': return box('Belum ada yang selesai', 'Tugas yang kamu centang akan muncul di sini.', null, 'done');
      case 'overdue': return box('Tidak ada yang terlambat', 'Semua tugas masih sesuai jadwal. Pertahankan.', null, 'done');
      case 'today':
        return lists.done.length
          ? box('Beres untuk hari ini', 'Semua tugas bertenggat hari ini sudah selesai.', null, 'done')
          : box('Hari ini kosong', 'Tidak ada tugas bertenggat hari ini. Tugas yang kamu tambah dari sini otomatis bertenggat hari ini.', null, 'today');
      case 'upcoming': return box('Minggu ini lowong', 'Tidak ada tenggat dalam 7 hari ke depan. Tugas yang kamu tambah dari sini otomatis bertenggat besok.', null, 'clock');
      case 'nodate': return box('Semua sudah terjadwal', 'Setiap tugas yang belum selesai sudah punya tenggat.', null, 'calendar');
      default: return box('Semua beres', 'Tidak ada tugas yang tersisa. Tambahkan yang baru, atau lihat progresmu di Ringkasan.', null, 'done');
    }
  }

  // ---------- Banner error koneksi ----------
  function showBanner(message) {
    dom.bannerText.textContent = message;
    dom.banner.hidden = false;
  }
  function hideBanner() { dom.banner.hidden = true; }

  // ---------- Navigasi & filter ----------
  function setView(view) {
    if (state.view === view) return;
    state.view = view;
    syncUrl();
    render();
    playEnter();
  }
  function setTag(tag) {
    state.tag = tag;
    syncUrl();
    render();
    playEnter();
  }
  function clearFilters() {
    state.tag = null;
    state.priority = 'any';
    state.search = '';
    dom.priority.value = 'any';
    dom.search.value = '';
    syncUrl();
    render();
  }

  // ---------- Aksi tugas ----------
  async function loadTasks(quiet) {
    try {
      state.tasks = await api('/tasks');
      state.loading = false;
      // Baru pulih dari error: muat ulang juga nama aplikasi (dari APP_NAME)
      if (state.loadError) window.App.loadAppInfo();
      state.loadError = null;
      hideBanner();
      render();
      return true;
    } catch (err) {
      state.loading = false;
      state.loadError = err.message;
      if (!quiet) showBanner(err.message);
      render();
      return false;
    }
  }

  async function addTask() {
    const parsed = parseQuickAdd(dom.composerInput.value);
    if (!parsed.title) {
      toast('Tulis judul tugasnya dulu, tidak hanya tag atau tanggal.', { error: true });
      return;
    }
    // Isi otomatis sesuai daftar yang sedang dibuka
    if (!parsed.dueDate && state.view === 'today') parsed.dueDate = todayISO();
    if (!parsed.dueDate && state.view === 'upcoming') parsed.dueDate = addDays(todayISO(), 1);
    if (state.tag && !parsed.tags.includes(state.tag)) parsed.tags.push(state.tag);
    if (!parsed.priority && state.priority !== 'any') parsed.priority = state.priority;

    const submit = $('composer-submit');
    submit.disabled = true;
    try {
      const task = await api('/tasks', { method: 'POST', body: { ...parsed, priority: parsed.priority || 'none' } });
      state.tasks.push(task);
      state.justAddedId = task.id;
      state.selectedId = task.id;
      dom.composerInput.value = '';
      renderComposerPreview();
      revealTask(task);
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      submit.disabled = false;
      dom.composerInput.focus();
    }
  }

  // Tugas baru tidak boleh "hilang": kalau tidak cocok dengan filter atau
  // daftar yang sedang dibuka, filter dilepas atau pindah ke Semua tugas.
  function revealTask(task) {
    const isVisible = () => visibleLists().active.some((t) => t.id === task.id);
    const changed = [];
    if (!isVisible() && (state.search || state.priority !== 'any')) {
      state.search = '';
      state.priority = 'any';
      dom.search.value = '';
      dom.priority.value = 'any';
      changed.push('filter dilepas');
    }
    if (!isVisible() && state.view !== 'all') {
      state.view = 'all';
      changed.push('pindah ke Semua tugas');
    }
    if (!isVisible() && state.tag) {
      state.tag = null;
    }
    syncUrl();
    render();
    if (changed.length) {
      playEnter();
      state.justAddedId = null;
      toast('Tugas ditambahkan (' + changed.join(', ') + ' supaya terlihat).');
    }
    const row = document.querySelector('.task[data-id="' + CSS.escape(task.id) + '"]');
    if (row) {
      row.classList.add('is-new');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Ubah tugas secara optimistis: tampilan langsung berubah, lalu disimpan ke server
  async function patchTask(id, changes, options) {
    const task = findTask(id);
    if (!task) return;
    const before = { ...task, subtasks: task.subtasks.map((s) => ({ ...s })), tags: [...task.tags] };
    Object.assign(task, changes);
    if (changes.done !== undefined) task.completedAt = changes.done ? new Date().toISOString() : null;
    if (options && options.delay) scheduleRender(options.delay); else render();
    if (state.drawerId === id) fillDrawer(task, true);

    try {
      const saved = await api('/tasks/' + encodeURIComponent(id), { method: 'PATCH', body: changes });
      Object.assign(task, saved);
      if (state.drawerId === id) fillDrawer(task, true);
      return saved;
    } catch (err) {
      Object.assign(task, before);
      render();
      if (state.drawerId === id) fillDrawer(task, true);
      toast(err.message, { error: true });
      throw err;
    }
  }

  function toggleDone(id, done) {
    const row = document.querySelector('.task[data-id="' + CSS.escape(id) + '"]');
    if (row) row.classList.toggle('is-done', done);
    // Beri waktu animasi coretan selesai sebelum tugas pindah ke grup "Selesai"
    patchTask(id, { done }, { delay: 700 }).catch(() => {});
  }

  function deleteTasks(ids, message) {
    if (!ids.length) return;
    ids.forEach((id) => state.pendingDeletes.add(id));
    if (ids.includes(state.drawerId)) closeDrawer(false);
    render();

    let undone = false;
    toast(message, {
      duration: UNDO_MS,
      action: {
        label: 'Batalkan',
        onClick: () => {
          undone = true;
          ids.forEach((id) => state.pendingDeletes.delete(id));
          render();
        },
      },
      onTimeout: () => { if (!undone) commitDeletes(ids); },
    });
  }

  async function commitDeletes(ids, keepalive) {
    const targets = ids.filter((id) => state.pendingDeletes.has(id));
    if (!targets.length) return;
    try {
      await api('/tasks/bulk', { method: 'POST', body: { action: 'delete', ids: targets }, keepalive });
      state.tasks = state.tasks.filter((t) => !targets.includes(t.id));
    } catch (err) {
      toast('Gagal menghapus: ' + err.message, { error: true });
    }
    targets.forEach((id) => state.pendingDeletes.delete(id));
    render();
  }

  // Simpan urutan manual: id dipindah ke sebelum/sesudah targetId
  function moveTask(id, targetId, after) {
    const ordered = [...state.tasks].sort((a, b) => a.order - b.order).map((t) => t.id).filter((x) => x !== id);
    let index = ordered.indexOf(targetId);
    if (index === -1) return;
    if (after) index += 1;
    ordered.splice(index, 0, id);
    ordered.forEach((taskId, i) => { findTask(taskId).order = i; });
    state.selectedId = id;
    render();
    const row = document.querySelector('.task[data-id="' + CSS.escape(id) + '"]');
    if (row) row.focus();
    api('/tasks/order', { method: 'PUT', body: { ids: ordered } }).catch((err) => {
      toast('Urutan gagal disimpan: ' + err.message, { error: true });
      loadTasks(true);
    });
  }

  function moveSelected(direction) {
    if (!canReorder()) {
      toast('Ubah urutan hanya bisa saat diurutkan "Urutan saya".');
      return;
    }
    const list = visibleLists().active;
    const index = list.findIndex((t) => t.id === state.selectedId);
    const target = list[index + direction];
    if (index === -1 || !target) return;
    moveTask(state.selectedId, target.id, direction > 0);
  }

  function startInlineEdit(id) {
    const row = document.querySelector('.task[data-id="' + CSS.escape(id) + '"]');
    const task = findTask(id);
    if (!row || !task) return;
    const titleEl = row.querySelector('.task-title');
    const input = el('input', { class: 'task-edit', type: 'text', value: task.title, maxlength: '200', 'aria-label': 'Ubah judul tugas' });
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.replace(/\s+/g, ' ').trim();
      if (save && value && value !== task.title) {
        patchTask(id, { title: value }).catch(() => {});
      } else {
        render();
      }
      const fresh = document.querySelector('.task[data-id="' + CSS.escape(id) + '"]');
      if (fresh) fresh.focus();
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (event) => event.stopPropagation());
    titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  // ---------- Event daftar tugas (delegasi) ----------
  function onListClick(event) {
    const row = event.target.closest('.task');
    if (!row) return;
    const id = row.dataset.id;
    state.selectedId = id;

    const tagBtn = event.target.closest('[data-tag]');
    if (tagBtn) { setTag(tagBtn.dataset.tag); return; }
    const act = event.target.closest('[data-act]');
    if (act && act.dataset.act === 'delete') {
      deleteTasks([id], 'Tugas dihapus.');
      return;
    }
    if (event.target.matches('.check')) return; // ditangani oleh event change
    if (act || event.target.closest('.task-body')) openDrawer(id);
  }

  function onListChange(event) {
    if (!event.target.matches('.check')) return;
    toggleDone(event.target.closest('.task').dataset.id, event.target.checked);
  }

  function onListDblClick(event) {
    const title = event.target.closest('.task-title');
    if (title) {
      clearTimeout(drawerOpenTimer);
      closeDrawer(false);
      startInlineEdit(title.closest('.task').dataset.id);
    }
  }

  function onListKeydown(event) {
    const row = event.target.closest('.task');
    if (!row || event.target !== row) return;
    const id = row.dataset.id;
    const rows = [...document.querySelectorAll('#task-list .task, #done-list .task')];
    const index = rows.indexOf(row);
    const focusRow = (r) => {
      if (!r) return;
      rows.forEach((x) => x.setAttribute('tabindex', '-1'));
      r.setAttribute('tabindex', '0');
      state.selectedId = r.dataset.id;
      r.focus();
    };
    const task = findTask(id);

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      state.selectedId = id;
      moveSelected(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    switch (event.key) {
      case 'ArrowDown': case 'j': event.preventDefault(); focusRow(rows[index + 1]); break;
      case 'ArrowUp': case 'k': event.preventDefault(); focusRow(rows[index - 1]); break;
      case 'Home': event.preventDefault(); focusRow(rows[0]); break;
      case 'End': event.preventDefault(); focusRow(rows[rows.length - 1]); break;
      case ' ': case 'x': event.preventDefault(); toggleDone(id, !task.done); break;
      case 'Enter': event.preventDefault(); openDrawer(id); break;
      case 'e': event.preventDefault(); startInlineEdit(id); break;
      case 'Delete': case 'Backspace': {
        event.preventDefault();
        const next = rows[index + 1] || rows[index - 1];
        state.selectedId = next ? next.dataset.id : null;
        deleteTasks([id], 'Tugas dihapus.');
        break;
      }
      case '1': case '2': case '3': case '0': {
        event.preventDefault();
        const priority = { 1: 'high', 2: 'medium', 3: 'low', 0: 'none' }[event.key];
        patchTask(id, { priority }).then(() => toast('Prioritas: ' + PRIORITY_LABEL[priority].toLowerCase() + '.')).catch(() => {});
        break;
      }
      default: break;
    }
  }

  // ---------- Drag & drop ----------
  let dragId = null;

  function onPointerDown(event) {
    const handle = event.target.closest('.drag-handle');
    if (handle) handle.closest('.task').setAttribute('draggable', 'true');
  }
  function onDragStart(event) {
    const row = event.target.closest('.task');
    if (!row) return;
    dragId = row.dataset.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
    requestAnimationFrame(() => row.classList.add('is-dragging'));
  }
  function clearDropMarks() {
    dom.list.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
  }
  function onDragOver(event) {
    if (!dragId) return;
    const row = event.target.closest('.task');
    if (!row || row.dataset.id === dragId) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    clearDropMarks();
    row.classList.add(after ? 'drop-after' : 'drop-before');
  }
  function onDrop(event) {
    const row = event.target.closest('.task');
    if (!dragId || !row) return;
    event.preventDefault();
    const after = row.classList.contains('drop-after');
    clearDropMarks();
    if (row.dataset.id !== dragId) moveTask(dragId, row.dataset.id, after);
  }
  function onDragEnd() {
    clearDropMarks();
    dom.list.querySelectorAll('[draggable]').forEach((r) => { r.removeAttribute('draggable'); r.classList.remove('is-dragging'); });
    dragId = null;
  }

  // ---------- Panel detail (drawer) ----------
  const drawerEls = {
    title: $('drawer-title'),
    done: $('drawer-done'),
    doneBtn: $('drawer-done-btn'),
    priority: $('drawer-priority'),
    due: $('drawer-due'),
    tags: $('drawer-tags'),
    tagInput: $('drawer-tag-input'),
    subtasks: $('drawer-subtasks'),
    subtaskForm: $('subtask-form'),
    subtaskInput: $('drawer-subtask-input'),
    progress: $('subtask-progress'),
    notes: $('drawer-notes'),
    notesCount: $('notes-count'),
    meta: $('drawer-meta'),
    saveState: $('save-state'),
  };
  let drawerOpenTimer = null;
  let lastFocus = null;
  let textTimer = null;
  let pendingText = {};

  function openDrawer(id) {
    // Tunda sebentar supaya dobel-klik (ubah judul langsung) tidak ikut membuka panel
    clearTimeout(drawerOpenTimer);
    drawerOpenTimer = setTimeout(() => reallyOpenDrawer(id), 180);
  }

  function reallyOpenDrawer(id) {
    const task = findTask(id);
    if (!task) return;
    if (state.drawerId && state.drawerId !== id) flushText();
    lastFocus = document.querySelector('.task[data-id="' + CSS.escape(id) + '"]') || document.activeElement;
    state.drawerId = id;
    state.selectedId = id;
    fillDrawer(task, false);
    setSaveState('');
    dom.drawer.classList.add('is-open');
    dom.backdrop.classList.add('is-open');
    syncUrl();
    setTimeout(() => dom.drawer.focus(), 60);
  }

  function closeDrawer(restoreFocus) {
    if (!state.drawerId) return;
    flushText();
    state.drawerId = null;
    dom.drawer.classList.remove('is-open');
    dom.backdrop.classList.remove('is-open');
    syncUrl();
    if (restoreFocus !== false && lastFocus && lastFocus.isConnected) lastFocus.focus();
  }

  // keepFocused: jangan menimpa field yang sedang diketik pengguna
  function fillDrawer(task, keepFocused) {
    const active = document.activeElement;
    if (!(keepFocused && active === drawerEls.title) && !pendingText.title) drawerEls.title.value = task.title;
    if (!(keepFocused && active === drawerEls.notes) && pendingText.notes === undefined) drawerEls.notes.value = task.notes;
    drawerEls.notesCount.textContent = drawerEls.notes.value.length + ' / 2000';
    drawerEls.done.checked = task.done;
    drawerEls.doneBtn.textContent = task.done ? 'Buka lagi' : 'Tandai selesai';
    drawerEls.priority.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === task.priority)));
    drawerEls.due.value = task.dueDate || '';

    drawerEls.tags.querySelectorAll('.tag-chip').forEach((chip) => chip.remove());
    task.tags.forEach((tag) => {
      drawerEls.tags.insertBefore(el('span', { class: 'tag-chip' }, [
        '#' + tag,
        el('button', { type: 'button', 'aria-label': 'Hapus tag ' + tag, onclick: () => setTags(task.tags.filter((t) => t !== tag)) }, icon('x')),
      ]), drawerEls.tagInput);
    });

    const focusedSub = active && active.closest && active.closest('.subtask') ? active.closest('.subtask').dataset.id : null;
    if (!(keepFocused && focusedSub)) {
      drawerEls.subtasks.replaceChildren(...task.subtasks.map((sub) => el('li', {
        class: 'subtask' + (sub.done ? ' is-done' : ''),
        dataset: { id: sub.id },
      }, [
        el('input', { type: 'checkbox', class: 'check', checked: sub.done, 'aria-label': 'Selesai: ' + sub.title }),
        el('input', { type: 'text', value: sub.title, maxlength: '200', 'aria-label': 'Judul subtugas' }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hapus subtugas ' + sub.title, dataset: { remove: '' } }, icon('x')),
      ])));
    }
    const doneCount = task.subtasks.filter((s) => s.done).length;
    drawerEls.progress.hidden = task.subtasks.length === 0;
    drawerEls.progress.firstElementChild.style.width = task.subtasks.length
      ? Math.round((doneCount / task.subtasks.length) * 100) + '%' : '0%';

    const rows = [
      ['Dibuat', formatDateTime(task.createdAt)],
      ['Terakhir diubah', formatRelative(task.updatedAt)],
    ];
    if (task.completedAt) rows.push(['Diselesaikan', formatDateTime(task.completedAt)]);
    if (task.dueDate) rows.push(['Tenggat', formatLongDate(task.dueDate)]);
    drawerEls.meta.replaceChildren(...rows.map(([k, v]) => el('div', null, [el('dt', { text: k }), el('dd', { text: v })])));
  }

  function setSaveState(text, kind) {
    drawerEls.saveState.textContent = text;
    drawerEls.saveState.className = 'save-state' + (kind ? ' is-' + kind : '');
  }

  async function saveFromDrawer(changes) {
    const id = state.drawerId;
    if (!id) return;
    setSaveState('Menyimpan...', 'saving');
    try {
      await patchTask(id, changes);
      if (state.drawerId === id) setSaveState('Tersimpan');
    } catch (err) {
      if (state.drawerId === id) setSaveState('Gagal menyimpan', 'error');
    }
  }

  // Teks (judul & catatan) disimpan setelah berhenti mengetik 600 ms
  function queueText(field, value) {
    pendingText[field] = value;
    setSaveState('Belum tersimpan', 'saving');
    clearTimeout(textTimer);
    textTimer = setTimeout(flushText, 600);
  }

  function flushText() {
    clearTimeout(textTimer);
    const changes = pendingText;
    pendingText = {};
    if (changes.title !== undefined) {
      changes.title = changes.title.replace(/\s+/g, ' ').trim();
      if (!changes.title) {
        delete changes.title;
        const task = findTask(state.drawerId);
        if (task) drawerEls.title.value = task.title;
        toast('Judul tugas tidak boleh kosong.', { error: true });
      }
    }
    if (Object.keys(changes).length) saveFromDrawer(changes);
    else if (drawerEls.saveState.textContent === 'Belum tersimpan') setSaveState('');
  }

  function setTags(tags) {
    saveFromDrawer({ tags });
  }

  function addTagFromInput() {
    const task = findTask(state.drawerId);
    const raw = drawerEls.tagInput.value.trim().replace(/^#+/, '').toLowerCase();
    drawerEls.tagInput.value = '';
    if (!task || !raw) return;
    if (!TAG_RE.test(raw)) {
      toast('Tag hanya boleh huruf, angka, - atau _ (tanpa spasi).', { error: true });
      return;
    }
    if (task.tags.includes(raw)) return;
    if (task.tags.length >= 8) { toast('Maksimal 8 tag per tugas.', { error: true }); return; }
    setTags([...task.tags, raw]);
  }

  function updateSubtasks(mutator) {
    const task = findTask(state.drawerId);
    if (!task) return;
    const subtasks = task.subtasks.map((s) => ({ ...s }));
    mutator(subtasks);
    saveFromDrawer({ subtasks });
  }

  function setupDrawer() {
    dom.backdrop.addEventListener('click', () => closeDrawer());
    $('drawer-close').addEventListener('click', () => closeDrawer());

    drawerEls.title.addEventListener('input', () => queueText('title', drawerEls.title.value));
    drawerEls.title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); flushText(); }
    });
    drawerEls.notes.addEventListener('input', () => {
      drawerEls.notesCount.textContent = drawerEls.notes.value.length + ' / 2000';
      queueText('notes', drawerEls.notes.value);
    });
    drawerEls.title.addEventListener('blur', flushText);
    drawerEls.notes.addEventListener('blur', flushText);

    drawerEls.done.addEventListener('change', () => saveFromDrawer({ done: drawerEls.done.checked }));
    drawerEls.doneBtn.addEventListener('click', () => {
      const task = findTask(state.drawerId);
      if (task) saveFromDrawer({ done: !task.done });
    });

    drawerEls.priority.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (button) saveFromDrawer({ priority: button.dataset.value });
    });

    drawerEls.due.addEventListener('change', () => saveFromDrawer({ dueDate: drawerEls.due.value || null }));
    document.querySelectorAll('[data-due]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.dataset.due;
        saveFromDrawer({ dueDate: value === 'clear' ? null : addDays(todayISO(), Number(value)) });
      });
    });

    drawerEls.tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
        event.preventDefault();
        addTagFromInput();
      } else if (event.key === 'Backspace' && !drawerEls.tagInput.value) {
        const task = findTask(state.drawerId);
        if (task && task.tags.length) setTags(task.tags.slice(0, -1));
      }
    });
    drawerEls.tagInput.addEventListener('change', () => {
      // memilih dari daftar saran (datalist)
      if (drawerEls.tagInput.value) addTagFromInput();
    });
    drawerEls.tags.addEventListener('click', (event) => {
      if (event.target === drawerEls.tags) drawerEls.tagInput.focus();
    });

    drawerEls.subtaskForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const title = drawerEls.subtaskInput.value.replace(/\s+/g, ' ').trim();
      if (!title) return;
      const task = findTask(state.drawerId);
      if (task && task.subtasks.length >= 30) { toast('Maksimal 30 subtugas.', { error: true }); return; }
      drawerEls.subtaskInput.value = '';
      updateSubtasks((subs) => subs.push({ title, done: false }));
    });
    drawerEls.subtasks.addEventListener('change', (event) => {
      const item = event.target.closest('.subtask');
      if (!item) return;
      if (event.target.matches('.check')) {
        updateSubtasks((subs) => { const s = subs.find((x) => x.id === item.dataset.id); if (s) s.done = event.target.checked; });
      } else if (event.target.type === 'text') {
        const title = event.target.value.replace(/\s+/g, ' ').trim();
        if (!title) { fillDrawer(findTask(state.drawerId), false); return; }
        updateSubtasks((subs) => { const s = subs.find((x) => x.id === item.dataset.id); if (s) s.title = title; });
      }
    });
    drawerEls.subtasks.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.type === 'text') { event.preventDefault(); event.target.blur(); }
    });
    drawerEls.subtasks.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove]');
      if (!button) return;
      const id = button.closest('.subtask').dataset.id;
      updateSubtasks((subs) => { const i = subs.findIndex((x) => x.id === id); if (i > -1) subs.splice(i, 1); });
    });

    $('drawer-delete').addEventListener('click', () => {
      const id = state.drawerId;
      if (id) deleteTasks([id], 'Tugas dihapus.');
    });

    // Tab tetap berputar di dalam panel saat panel terbuka
    dom.drawer.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusables = [...dom.drawer.querySelectorAll('button, input, textarea, select')].filter((x) => !x.disabled && x.offsetParent !== null);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  // ---------- Menu aksi ----------
  function toggleMenu(open) {
    const show = open !== undefined ? open : dom.menu.hidden;
    dom.menu.hidden = !show;
    dom.menuBtn.setAttribute('aria-expanded', String(show));
    if (show) dom.menu.querySelector('button').focus();
  }

  async function runMenuAction(action) {
    toggleMenu(false);
    const lists = visibleLists();
    if (action === 'complete-visible') {
      const ids = lists.active.filter((t) => !t.done).map((t) => t.id);
      if (!ids.length) { toast('Tidak ada tugas yang belum selesai di daftar ini.'); return; }
      try {
        await api('/tasks/bulk', { method: 'POST', body: { action: 'complete', ids } });
        await loadTasks(true);
        toast(ids.length + ' tugas ditandai selesai.', {
          action: {
            label: 'Batalkan',
            onClick: async () => {
              await api('/tasks/bulk', { method: 'POST', body: { action: 'reopen', ids } }).catch((err) => toast(err.message, { error: true }));
              loadTasks(true);
            },
          },
        });
      } catch (err) { toast(err.message, { error: true }); }
    } else if (action === 'clear-done') {
      const done = state.view === 'done' ? lists.active : lists.done;
      if (!done.length) { toast('Tidak ada tugas selesai di daftar ini.'); return; }
      deleteTasks(done.map((t) => t.id), done.length + ' tugas selesai dihapus.');
    } else if (action === 'export') {
      window.location.href = '/api/tasks/export';
      toast('Cadangan sedang diunduh.');
    } else if (action === 'import') {
      dom.importFile.click();
    }
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      let data;
      try { data = JSON.parse(text); } catch (err) { throw new Error('File ini bukan JSON yang valid.'); }
      const result = await api('/tasks/import', { method: 'POST', body: Array.isArray(data) ? data : data.tasks || data });
      await loadTasks(true);
      toast(result.imported + ' tugas dipulihkan dari cadangan.');
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      dom.importFile.value = '';
    }
  }

  // ---------- Pintasan keyboard global ----------
  function onGlobalKeydown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;

    if (event.key === 'Escape') {
      if (!dom.menu.hidden) { toggleMenu(false); dom.menuBtn.focus(); return; }
      if (state.drawerId) { closeDrawer(); return; }
      if (document.activeElement === dom.search && dom.search.value) {
        dom.search.value = '';
        state.search = '';
        render();
        return;
      }
      if (isTypingTarget(document.activeElement)) document.activeElement.blur();
      return;
    }

    if (isTypingTarget(event.target) || dom.shortcutDialog.open || state.drawerId) return;
    if (event.altKey) return;

    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      dom.composerInput.focus();
    } else if (event.key === '/') {
      event.preventDefault();
      dom.search.focus();
    } else if (event.key === '?') {
      event.preventDefault();
      dom.shortcutDialog.showModal();
    } else if ((event.key === 'ArrowDown' || event.key === 'j') && !event.target.closest('.task')) {
      const first = document.querySelector('#task-list .task');
      if (first) { event.preventDefault(); first.focus(); }
    }
  }

  // ---------- Inisialisasi ----------
  function setup() {
    dom.sort.value = state.sort;

    dom.composer.addEventListener('submit', (event) => { event.preventDefault(); addTask(); });
    dom.composerInput.addEventListener('input', renderComposerPreview);

    let searchTimer;
    dom.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = dom.search.value.trim(); render(); }, 120);
    });
    dom.priority.addEventListener('change', () => { state.priority = dom.priority.value; render(); });
    dom.sort.addEventListener('change', () => { state.sort = dom.sort.value; savePrefs(); render(); });

    dom.menuBtn.addEventListener('click', (event) => { event.stopPropagation(); toggleMenu(); });
    dom.menu.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button) runMenuAction(button.dataset.action);
    });
    dom.menu.addEventListener('keydown', (event) => {
      const items = [...dom.menu.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    document.addEventListener('click', (event) => {
      if (!dom.menu.hidden && !event.target.closest('.menu-wrap')) toggleMenu(false);
    });
    dom.importFile.addEventListener('change', () => { if (dom.importFile.files[0]) importBackup(dom.importFile.files[0]); });

    for (const list of [dom.list, dom.doneList]) {
      list.addEventListener('click', onListClick);
      list.addEventListener('change', onListChange);
      list.addEventListener('dblclick', onListDblClick);
      list.addEventListener('keydown', onListKeydown);
    }
    dom.list.addEventListener('pointerdown', onPointerDown);
    dom.list.addEventListener('pointerup', () => { if (!dragId) onDragEnd(); });
    dom.list.addEventListener('dragstart', onDragStart);
    dom.list.addEventListener('dragover', onDragOver);
    dom.list.addEventListener('drop', onDrop);
    dom.list.addEventListener('dragend', onDragEnd);

    dom.doneToggle.addEventListener('click', () => {
      state.showDone = !state.showDone;
      savePrefs();
      render();
    });

    $('banner-retry').addEventListener('click', () => loadTasks());
    $('shortcut-btn').addEventListener('click', () => dom.shortcutDialog.showModal());
    dom.shortcutDialog.addEventListener('click', (event) => {
      if (event.target === dom.shortcutDialog || event.target.closest('[data-close]')) dom.shortcutDialog.close();
    });

    setupDrawer();
    document.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('resize', positionIndicator);

    // Sinkron ulang saat tab kembali dibuka (misalnya data diubah dari tab lain)
    document.addEventListener('visibilitychange', () => {
      const editing = document.activeElement && document.activeElement.classList.contains('task-edit');
      if (document.visibilityState === 'visible' && !state.drawerId && !state.pendingDeletes.size && !editing) loadTasks(true);
    });
    // Hapus yang tertunda tetap dikirim kalau halaman ditutup sebelum toast hilang
    window.addEventListener('pagehide', () => {
      if (state.pendingDeletes.size) commitDeletes([...state.pendingDeletes], true);
    });

    render();
    loadTasks().then((ok) => {
      const taskId = params.get('task');
      if (ok && taskId && findTask(taskId)) reallyOpenDrawer(taskId);
    });
  }

  setup();
})();
