// =============================================================
// summary.js - halaman Ringkasan
// Mengambil /api/stats (dihitung di container api) lalu
// menampilkannya sebagai angka, bar progres, dan grafik 7 hari.
// =============================================================
(function () {
  'use strict';

  const { el, api, describeDue, formatLongDate, formatRelative, PRIORITY_LABEL, WEEKDAYS, parseISODate } = window.App;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Angka besar menghitung naik dari 0 (satu momen animasi di halaman ini)
  function countUp(node, target) {
    if (reduceMotion || target === 0) { node.textContent = target; return; }
    const start = performance.now();
    const duration = 900;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      node.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Lebar/tinggi diubah setelah frame berikutnya supaya transisi CSS berjalan
  function afterPaint(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function renderHero(stats) {
    $('today-label').textContent = formatLongDate(stats.today);
    countUp($('rate'), stats.completionRate);
    $('rate-bar').setAttribute('aria-valuenow', String(stats.completionRate));
    afterPaint(() => { $('rate-fill').style.width = 'calc(' + stats.completionRate + '% - 8px)'; });
    if (stats.completionRate === 0) $('rate-fill').style.width = '0';

    const caption = $('rate-caption');
    if (stats.total === 0) {
      caption.replaceChildren('Belum ada tugas. Tambahkan tugas pertamamu, progresnya akan muncul di sini.');
    } else {
      caption.replaceChildren(
        el('strong', { text: stats.done + ' dari ' + stats.total }),
        ' tugas sudah selesai.',
        stats.active === 0 ? ' Semua beres.' : ''
      );
    }

    $('streak').textContent = stats.streak;
    const parts = [];
    parts.push(stats.streak > 0
      ? 'Hari berturut-turut kamu menyelesaikan minimal satu tugas.'
      : 'Selesaikan satu tugas hari ini untuk memulai rangkaian.');
    parts.push('Hari ini: ' + stats.completedToday + ' selesai, ' + stats.createdToday + ' ditambahkan.');
    $('streak-caption').textContent = parts.join(' ');
  }

  function renderFigures(stats) {
    $('f-active').textContent = stats.active;
    $('f-overdue').textContent = stats.overdue;
    $('f-overdue-box').classList.toggle('is-alert', stats.overdue > 0);
    $('f-week').textContent = stats.dueThisWeek;
    $('f-today').textContent = stats.completedToday;
    $('f-sub').textContent = stats.subtasks.total ? stats.subtasks.done + '/' + stats.subtasks.total : '0';
  }

  function renderChart(stats) {
    const max = Math.max(4, ...stats.last7Days.map((d) => Math.max(d.completed, d.created)));
    const bars = [];
    const labels = [];
    for (const day of stats.last7Days) {
      const date = parseISODate(day.date);
      const isToday = day.date === stats.today;
      const name = isToday ? 'Hari ini' : WEEKDAYS[date.getDay()];
      const done = el('div', { class: 'bar bar-done', dataset: { h: (day.completed / max) * 100 } });
      const created = el('div', { class: 'bar bar-created', dataset: { h: (day.created / max) * 100 } });
      const tip = name + ', ' + date.getDate() + '/' + (date.getMonth() + 1) + ': ' + day.completed + ' selesai, ' + day.created + ' ditambahkan';
      bars.push(el('div', { class: 'bar-col', role: 'listitem', tabindex: '0', 'aria-label': tip }, [
        done, created, el('span', { class: 'bar-tip', text: day.completed + ' selesai, ' + day.created + ' baru' }),
      ]));
      labels.push(el('span', { class: isToday ? 'is-today' : '', text: isToday ? 'Hari ini' : name.slice(0, 3) }));
    }
    $('chart').replaceChildren(...bars);
    $('chart-labels').replaceChildren(...labels);
    afterPaint(() => {
      document.querySelectorAll('.bar').forEach((bar) => {
        const h = Number(bar.dataset.h);
        bar.style.height = h > 0 ? 'max(6px, ' + h + '%)' : '0';
      });
    });

    const weekDone = stats.last7Days.reduce((sum, d) => sum + d.completed, 0);
    const weekCreated = stats.last7Days.reduce((sum, d) => sum + d.created, 0);
    $('chart-sub').textContent = 'Seminggu ini: ' + weekDone + ' tugas diselesaikan, ' + weekCreated + ' ditambahkan.';
  }

  function miniItem(task, done) {
    const when = done
      ? 'Selesai ' + formatRelative(task.completedAt)
      : describeDue(task.dueDate).label;
    const overdue = !done && describeDue(task.dueDate).kind === 'overdue';
    return el('li', { class: done ? 'is-done' : '' }, el('a', { href: '/?task=' + encodeURIComponent(task.id) }, [
      task.priority !== 'none' ? el('span', { class: 'dot dot-' + task.priority, title: 'Prioritas ' + PRIORITY_LABEL[task.priority].toLowerCase() }) : el('span', { class: 'dot', title: 'Tanpa prioritas' }),
      el('span', { class: 'mini-title' }, el('span', { class: 'ink', text: task.title })),
      el('span', { class: 'mini-when' + (overdue ? ' badge badge-overdue' : ''), text: when }),
    ]));
  }

  function renderLists(stats) {
    const upcoming = $('upcoming');
    upcoming.replaceChildren(...(stats.upcoming.length
      ? stats.upcoming.map((t) => miniItem(t, false))
      : [el('li', null, el('p', { class: 'mini-empty', text: 'Tidak ada tugas bertenggat yang belum selesai.' }))]));

    const recent = $('recent');
    recent.replaceChildren(...(stats.recentlyCompleted.length
      ? stats.recentlyCompleted.map((t) => miniItem(t, true))
      : [el('li', null, el('p', { class: 'mini-empty', text: 'Belum ada tugas yang selesai.' }))]));
  }

  function breakdownRow(name, done, total, fillClass, href) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const fill = el('div', { class: 'breakdown-fill ' + fillClass, dataset: { w: pct } });
    return el('div', { class: 'breakdown-row' }, [
      href ? el('a', { class: 'breakdown-name', href }, name) : el('span', { class: 'breakdown-name' }, name),
      el('div', { class: 'breakdown-track', role: 'img', 'aria-label': done + ' dari ' + total + ' selesai' }, fill),
      el('span', { class: 'breakdown-value', text: done + '/' + total }),
    ]);
  }

  function renderBreakdowns(stats) {
    const priorities = stats.byPriority.filter((p) => p.total > 0);
    $('by-priority').replaceChildren(...(priorities.length
      ? priorities.map((p) => breakdownRow(
        [el('span', { class: 'dot dot-' + p.priority }), PRIORITY_LABEL[p.priority]],
        p.done, p.total, 'fill-' + p.priority))
      : [el('p', { class: 'mini-empty', text: 'Belum ada tugas.' })]));

    $('by-tag').replaceChildren(...(stats.byTag.length
      ? stats.byTag.map((t) => breakdownRow('#' + t.tag, t.done, t.total, 'fill-tag', '/?tag=' + encodeURIComponent(t.tag)))
      : [el('p', { class: 'mini-empty', text: 'Belum ada tag. Tulis #nama di judul tugas untuk menambahkan tag.' })]));

    afterPaint(() => {
      document.querySelectorAll('.breakdown-fill').forEach((fill) => { fill.style.width = fill.dataset.w + '%'; });
    });
  }

  async function load() {
    try {
      const stats = await api('/stats?tzOffset=' + new Date().getTimezoneOffset());
      $('banner').hidden = true;
      renderHero(stats);
      renderFigures(stats);
      renderChart(stats);
      renderLists(stats);
      renderBreakdowns(stats);
    } catch (err) {
      $('banner-text').textContent = err.message;
      $('banner').hidden = false;
      $('rate-caption').textContent = 'Data belum bisa dimuat.';
    }
  }

  $('banner-retry').addEventListener('click', () => { load(); window.App.loadAppInfo(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });
  load();
})();
