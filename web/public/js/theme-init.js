// Dipasang di <head> supaya tema (terang/gelap) sudah benar SEBELUM
// halaman digambar, sehingga tidak ada kedipan warna saat load.
(function () {
  try {
    var saved = localStorage.getItem('todo-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (err) {
    /* localStorage tidak tersedia: ikut tema sistem */
  }
})();
