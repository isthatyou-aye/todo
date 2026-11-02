# Todo App: Aplikasi To-Do List Berbasis Microservices dengan Podman

Proyek UTS mata kuliah Pengembangan dan Operasi. Aplikasi web To-Do List yang dipecah menjadi **dua microservice**, masing-masing dibungkus dalam container image buatan sendiri, lalu dipublikasikan ke **GitHub Container Registry (GHCR)**.

| | |
|---|---|
| **Kelompok** | KDA: Kelvin Kurniawan (241112232), Devin Owen Sanusi (241111093), Anggara Adelee (241112271) |
| **Image** | `ghcr.io/isthatyou-aye/todo-web:1.0.1` dan `ghcr.io/isthatyou-aye/todo-api:1.0.1` |
| **Teknologi** | Node.js 24 + Express 5 (api), Nginx 1.30 unprivileged (web), HTML/CSS/JavaScript tanpa framework (frontend), Podman |

---

## 1. Fungsi aplikasi

Aplikasi pencatat tugas dengan tampilan bersih bertema buku catatan: latar dot grid, strip warna prioritas di setiap tugas, dan coretan pena beranimasi saat tugas diselesaikan. Tersedia mode terang dan gelap.

### Halaman

| Halaman | URL | Isi |
|---|---|---|
| Tugas | `http://localhost:8080/` | Daftar tugas lengkap (fitur utama) |
| Ringkasan | `http://localhost:8080/ringkasan` | Progres penyelesaian, statistik, grafik 7 hari, tenggat terdekat, rincian per prioritas dan per tag |

### Fitur

- **Tambah cepat dengan sintaks**: `Kerjakan laporan #uts !tinggi @besok` langsung membuat tugas bertag `uts`, prioritas tinggi, tenggat besok. Hasil bacaannya tampil sebelum disimpan.
- **Detail tugas**: prioritas (rendah, sedang, tinggi), tenggat, beberapa tag, subtugas dengan progres, dan catatan. Tersimpan otomatis.
- **Daftar pintar**: Semua, Hari ini, 7 hari ke depan, Terlambat, Tanpa tenggat, Selesai, lengkap dengan jumlahnya. Filter per tag dan per prioritas.
- **Pencarian** judul, catatan, tag, dan subtugas, dengan kata yang ditandai.
- **Urutan**: manual (drag & drop atau `Alt + ↑/↓`), tenggat, prioritas, terbaru, abjad.
- **Hapus dengan tombol Batalkan** (5 detik), aksi massal (tandai semua selesai, hapus yang selesai).
- **Cadangan**: unduh semua tugas sebagai JSON dan pulihkan lagi. Contoh data ada di `docs/contoh-cadangan.json`.
- **Pintasan keyboard** (tekan `?` di aplikasi), **tema terang/gelap**, tampilan HP, dan aksesibilitas (navigasi keyboard, label pembaca layar, menghormati pengaturan kurangi animasi).
- **Nama aplikasi di header** diambil dari environment variable `APP_NAME`.

### Endpoint API

Semua diakses lewat Nginx di port 8080.

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/health` | Cek kesehatan (dipakai `HEALTHCHECK`) |
| GET | `/api/info` | Nama aplikasi, versi, environment, hostname container, user proses |
| GET | `/api/stats?tzOffset=-420` | Statistik untuk halaman Ringkasan |
| GET | `/api/tasks` | Semua tugas |
| POST | `/api/tasks` | Tambah tugas |
| GET | `/api/tasks/:id` | Satu tugas |
| PATCH | `/api/tasks/:id` | Ubah judul, status, prioritas, tenggat, tag, subtugas, atau catatan |
| DELETE | `/api/tasks/:id` | Hapus satu tugas |
| PUT | `/api/tasks/order` | Simpan urutan manual `{"ids": [...]}` |
| POST | `/api/tasks/bulk` | Aksi massal `{"action": "complete" \| "reopen" \| "delete", "ids": [...]}` |
| GET | `/api/tasks/export` | Unduh cadangan JSON |
| POST | `/api/tasks/import` | Pulihkan dari cadangan |
| DELETE | `/api/admin/tasks` | Hapus **semua** tugas, wajib header `X-Admin-Token` (dilindungi secret) |

Semua input divalidasi di server (panjang judul, format tanggal, format tag, jumlah subtugas), dan pesan error ditulis dalam bahasa Indonesia.

---

## 2. Arsitektur

```
                    ┌──────────────── Podman machine (WSL2) ─────────────────┐
                    │                network: todo-net                        │
 ┌─────────┐  :8080 │  ┌──────────────────┐ /api/*  ┌───────────────────┐    │
 │ Browser ├────────┼─►│ todo-web         ├────────►│ todo-api          │    │
 │ (user)  │  port  │  │ Nginx :8080      │  :3000  │ Node.js :3000     │    │
 └─────────┘ mapping│  │ file statis +    │         │ REST API + log    │    │
                    │  │ reverse proxy    │         └─────────┬─────────┘    │
                    │  │ STATELESS        │           STATELESS│ baca/tulis  │
                    │  └──────────────────┘                    ▼              │
                    │                                 ┌───────────────────┐    │
                    │                                 │ volume: todo-data │    │
                    │                                 │ /data/tasks.json  │    │
                    │                                 │ STATEFUL          │    │
                    │                                 └───────────────────┘    │
                    └─────────────────────────────────────────────────────────┘
```

| Komponen | Image | Port | Sifat | Keterangan |
|---|---|---|---|---|
| `todo-web` | `todo-web:1.0.1` | 8080 (dipublikasikan ke host) | Stateless | Menyajikan HTML/CSS/JS/font, meneruskan `/api/*` ke `todo-api` |
| `todo-api` | `todo-api:1.0.1` | 3000 (hanya di network internal) | Stateless | Logika aplikasi, validasi, statistik, log setiap request |
| `todo-data` | volume Podman | – | **Stateful** | File `tasks.json`, tetap ada walaupun container dihapus |
| `todo-admin-token` | secret Podman | – | – | Token admin, disuntikkan saat runtime, **tidak** ada di image |

**Microservices, bukan monolithic.** Frontend/proxy dan backend dipisah menjadi dua service yang masing-masing bisa di-build, di-update, di-restart, dan diskalakan sendiri. Hanya `todo-web` yang dibuka ke luar. `todo-api` tidak punya port mapping, jadi tidak bisa diakses langsung dari host.

**Stateless vs stateful.** Kedua container tidak menyimpan apa pun yang penting di dalam dirinya. Satu-satunya tempat data hidup adalah volume `todo-data`. Preferensi tampilan (tema, urutan) disimpan di browser pengguna, bukan di server.

---

## 3. Struktur folder

```
todo/
├── README.md
├── compose.yaml              # menjalankan semua container dengan 1 perintah
├── package.json              # skrip mode development (npm run dev)
├── .env.example              # contoh konfigurasi (salin jadi .env)
├── .gitignore  .gitattributes
├── docs/
│   └── contoh-cadangan.json  # contoh data untuk demo (Pulihkan dari cadangan)
├── api/                      # microservice 1: backend
│   ├── Containerfile         # multi-stage, Alpine, non-root
│   ├── Containerfile.naive   # versi TIDAK optimal (untuk perbandingan saja)
│   ├── .containerignore
│   ├── package.json  package-lock.json
│   ├── dev.js                # entry mode development (tidak masuk image)
│   └── src/
│       ├── server.js         # Express app, endpoint, graceful shutdown
│       ├── store.js          # penyimpanan tasks.json (stateful)
│       ├── validation.js     # validasi semua input
│       ├── stats.js          # perhitungan statistik Ringkasan
│       ├── config.js         # pembacaan environment variable
│       └── logger.js         # log setiap request ke stdout
└── web/                      # microservice 2: frontend + reverse proxy
    ├── Containerfile         # nginx-unprivileged alpine-slim
    ├── .containerignore
    ├── nginx/default.conf.template
    └── public/
        ├── index.html  ringkasan.html  404.html  50x.html
        ├── css/style.css
        ├── js/common.js  tasks.js  summary.js  theme-init.js
        └── fonts/            # font self-hosted (lisensi OFL)
```

---

## 4. Prasyarat

- Windows 10/11 dengan **WSL2**
- **Podman Desktop** dengan Podman machine berjalan (`podman machine list` → *Currently running*)
- Akun GitHub dan token GHCR (scope `write:packages`) untuk push
- Opsional, untuk mode development: **Node.js 22 atau lebih baru**

> Semua perintah di bawah dijalankan di **PowerShell**, dari folder root proyek (`todo/`). Tanda backtick `` ` `` di akhir baris adalah penyambung baris di PowerShell. Perintahnya juga boleh ditulis dalam satu baris.

---

## 5. Mode development (tanpa container, dari VS Code)

Untuk mencoba tampilan dan mengubah kode dengan cepat:

```powershell
npm install        # sekali saja: memasang dependency api
npm run dev        # buka http://localhost:3000
```

Pada mode ini Express ikut menyajikan frontend (tanpa Nginx), data disimpan di `api/data/`, dan server otomatis restart saat kode api diubah. Ini **hanya** untuk pengembangan. Aplikasi yang dinilai dan dipublikasikan tetap berjalan sebagai dua container (bagian 6 dan seterusnya).

---

## 6. Build image

```powershell
podman build --format docker -t ghcr.io/isthatyou-aye/todo-api:1.0.1 ./api
podman build --format docker -t ghcr.io/isthatyou-aye/todo-web:1.0.1 ./web
```

`--format docker` dipakai supaya instruksi `HEALTHCHECK` ikut tersimpan. Format default Podman (OCI) mengabaikannya.

Melihat hasil build:

```powershell
podman images --filter reference=ghcr.io/isthatyou-aye/*
podman history ghcr.io/isthatyou-aye/todo-api:1.0.1     # daftar layer
```

---

## 7. Menjalankan aplikasi

### Cara cepat: compose (satu perintah)

```powershell
Copy-Item .env.example .env       # lalu ubah ADMIN_TOKEN di file .env
podman compose up -d --build
podman compose ps
podman compose down               # menghentikan; volume data tetap ada
```

Kalau `podman compose` meminta provider, pasang dulu lewat Podman Desktop: *Settings → Resources → Compose → Setup*.

### Cara manual (dipakai untuk demo video)

```powershell
# 1) Network khusus, supaya container bisa saling memanggil lewat nama
podman network create todo-net

# 2) Volume untuk data stateful
podman volume create todo-data

# 3) Secret admin (ganti nilainya). Nilai ini TIDAK masuk ke image.
"ganti-dengan-token-rahasia" | podman secret create todo-admin-token -

# 4) Jalankan api (tanpa -p: tidak dibuka ke host)
podman run -d --name todo-api --network todo-net `
  -v todo-data:/data `
  --secret todo-admin-token,type=env,target=ADMIN_TOKEN `
  -e APP_NAME="Todo Kelompok" `
  ghcr.io/isthatyou-aye/todo-api:1.0.1

# 5) Jalankan web dengan port mapping host 8080 -> container 8080
podman run -d --name todo-web --network todo-net `
  -p 8080:8080 `
  ghcr.io/isthatyou-aye/todo-web:1.0.1

# 6) Cek status (kolom STATUS akan menampilkan "healthy")
podman ps
```

Buka **http://localhost:8080**. Untuk mengisi contoh data: menu titik tiga → *Pulihkan dari cadangan* → pilih `docs/contoh-cadangan.json`.

> Compose dan cara manual memakai nama container yang sama. Hapus dulu yang satu (`podman compose down` atau `podman rm -f todo-web todo-api`) sebelum memakai cara lainnya.

### Environment variable

| Variabel | Container | Default | Fungsi |
|---|---|---|---|
| `PORT` | api | `3000` | Port API di dalam container |
| `APP_NAME` | api | `Todo App` | Nama aplikasi (tampil di header, judul tab, dan log) |
| `APP_ENV` | api | `production` | Nama environment (tampil di footer) |
| `APP_VERSION` | api | `1.0.1` | Versi, diisi saat build |
| `DATA_DIR` | api | `/data` | Lokasi data stateful |
| `LOG_FORMAT` | api | `text` | `text` (mudah dibaca) atau `json` (terstruktur) |
| `ADMIN_TOKEN` | api | *(kosong)* | **Secret**, hanya lewat `--secret` atau `.env` saat run |
| `SERVE_STATIC` | api | *(kosong)* | Khusus mode development, tidak dipakai di container |
| `API_URL` | web | `http://todo-api:3000` | Alamat service api untuk reverse proxy |

---

## 8. Demonstrasi pengoperasian container

### Port mapping

```powershell
podman port todo-web                 # 8080/tcp -> 0.0.0.0:8080
# Contoh port host lain: jalankan web kedua di port 9090
podman run -d --name todo-web-2 --network todo-net -p 9090:8080 ghcr.io/isthatyou-aye/todo-web:1.0.1
# buka http://localhost:9090 (datanya sama, karena memakai api yang sama), lalu hapus lagi:
podman rm -f todo-web-2
```

### Environment variable

```powershell
podman rm -f todo-api
podman run -d --name todo-api --network todo-net -v todo-data:/data `
  --secret todo-admin-token,type=env,target=ADMIN_TOKEN `
  -e APP_NAME="Catatan Kelompok KDA" -e APP_ENV=staging -e LOG_FORMAT=json `
  ghcr.io/isthatyou-aye/todo-api:1.0.1
```

Muat ulang browser: **nama di header berubah** menjadi "Catatan Kelompok KDA", footer menampilkan `staging`, dan `podman logs todo-api` kini berformat JSON. Tugas yang sudah ada tetap muncul karena tersimpan di volume.

### Logs

```powershell
podman logs todo-api              # log aplikasi: setiap request tercatat
podman logs -f todo-web           # ikuti log Nginx secara langsung (Ctrl+C untuk berhenti)
podman logs --tail 5 todo-api
```

Setiap request punya `request_id` yang sama di log Nginx dan log API, sehingga satu request bisa dilacak di kedua container.

### Inspect

```powershell
podman inspect todo-api --format "{{.Config.User}}"            # user non-root
podman inspect todo-api --format "{{.State.Health.Status}}"    # healthy
podman inspect todo-api --format "{{.Mounts}}"                 # volume /data
podman inspect todo-web --format "{{.NetworkSettings.Ports}}"  # port mapping
podman image inspect ghcr.io/isthatyou-aye/todo-api:1.0.1 --format "{{.Config.Env}}"   # tidak ada ADMIN_TOKEN
podman image inspect ghcr.io/isthatyou-aye/todo-api:1.0.1 --format "{{json .Config.Labels}}"
```

### Exec

```powershell
podman exec todo-api whoami                       # node (bukan root)
podman exec todo-api id                           # uid=1000(node)
podman exec todo-api cat /data/tasks.json         # isi data stateful
podman exec todo-web whoami                       # nginx (bukan root)
podman exec todo-web cat /etc/nginx/conf.d/default.conf   # config hasil template env
podman exec -it todo-api sh                       # masuk shell, keluar dengan: exit
```

### Stop, start, remove

```powershell
podman stop todo-api        # aplikasi menerima SIGTERM dan berhenti dengan rapi (lihat podman logs)
podman ps -a                # status: Exited
# Buka browser: halaman tetap tampil, tetapi muncul pesan "Service api sedang tidak bisa dihubungi"
podman start todo-api
podman ps
podman rm -f todo-web todo-api
```

### Bukti stateless vs stateful

```powershell
curl.exe -s http://localhost:8080/api/info        # catat nilai "hostname" (= ID container)
podman rm -f todo-api                             # container dihapus
podman run -d --name todo-api --network todo-net -v todo-data:/data `
  --secret todo-admin-token,type=env,target=ADMIN_TOKEN ghcr.io/isthatyou-aye/todo-api:1.0.1
curl.exe -s http://localhost:8080/api/info        # hostname BERBEDA (container baru)
```

Muat ulang browser: **semua tugas masih ada** (data hidup di volume, bukan di container). Container `todo-web` tidak perlu di-restart karena Nginx mencari ulang alamat `todo-api` lewat DNS network setiap 10 detik.

### Fitur yang dilindungi secret

```powershell
curl.exe -X DELETE -H "X-Admin-Token: salah" http://localhost:8080/api/admin/tasks
# {"error":"Token admin salah atau tidak ada."}
curl.exe -X DELETE -H "X-Admin-Token: ganti-dengan-token-rahasia" http://localhost:8080/api/admin/tasks
# {"removed":14}
```

---

## 9. Optimasi dan keamanan image

| Teknik | Penerapan |
|---|---|
| Base image minimal | `node:24-alpine` (api), `nginx-unprivileged:1.30-alpine-slim` (web) |
| Multi-stage build | api: stage `deps` (npm ci) dan stage `runtime` (image akhir tanpa cache npm) |
| Urutan layer untuk cache | `package*.json` disalin dan di-install **sebelum** kode, jadi perubahan kode tidak memicu install ulang |
| Dependency produksi saja | Hanya 1 dependency langsung (Express). `npm ci --omit=dev` + `npm cache clean --force` |
| Frontend tanpa framework | HTML/CSS/JS murni, tanpa CDN. Font di-host sendiri (sekitar 66 KB) |
| `.containerignore` | `node_modules`, `.env`, `.git`, data lokal, `dev.js` tidak dikirim ke build |
| Non-root | api: `USER node` (uid 1000), web: user `nginx` (uid 101), port > 1024 |
| Kode read-only bagi aplikasi | File kode milik root, proses `node` hanya bisa membaca |
| Tanpa secret di image | `ADMIN_TOKEN` hanya lewat `podman secret` / `.env` saat run |
| Versi dikunci | Tag base image spesifik (bukan `latest`), image diberi tag versi semantik (`1.0.0`, `1.0.1`) |
| Healthcheck | `HEALTHCHECK` di kedua image |
| Label OCI | Judul, versi, author, source |
| Proses langsung | `CMD ["node", "src/server.js"]`, bukan `npm start`, supaya SIGTERM sampai ke aplikasi |
| Header keamanan | Content-Security-Policy ketat, `X-Content-Type-Options`, `X-Frame-Options`, `server_tokens off`, tanpa `X-Powered-By` |
| Validasi input | Semua input dicek di server; frontend memakai `textContent` (bukan `innerHTML`) untuk mencegah XSS |

Perbandingan dengan versi tidak optimal:

```powershell
podman build -f ./api/Containerfile.naive -t todo-api:naive ./api
podman images --format "table {{.Repository}}:{{.Tag}} {{.Size}}" | Select-String todo-api
podman run --rm todo-api:naive whoami     # root  <- tidak aman
podman rmi todo-api:naive
```

Hardening tambahan (opsional), filesystem container api dibuat read-only, hanya `/data` yang bisa ditulis:

```powershell
podman run -d --name todo-api --network todo-net --read-only -v todo-data:/data `
  --secret todo-admin-token,type=env,target=ADMIN_TOKEN ghcr.io/isthatyou-aye/todo-api:1.0.1
```

---

## 10. Push ke GitHub Container Registry

```powershell
podman login ghcr.io -u isthatyou-aye        # password = token GHCR (bukan password GitHub)

podman push ghcr.io/isthatyou-aye/todo-api:1.0.1
podman push ghcr.io/isthatyou-aye/todo-web:1.0.1
```

Kami sengaja hanya memakai tag versi (`1.0.0`, `1.0.1`), tanpa tag `latest`, supaya selalu jelas versi mana yang sedang dijalankan.

Setelah push pertama, buka **github.com/isthatyou-aye?tab=packages**, lalu untuk **masing-masing** package: *Package settings → Danger Zone → Change visibility → Public*. Tanpa langkah ini, image tidak bisa di-pull oleh orang lain.

---

## 11. Uji pull dari registry

```powershell
# Hapus container dan image lokal
podman rm -f todo-web todo-api
podman rmi ghcr.io/isthatyou-aye/todo-api:1.0.1 ghcr.io/isthatyou-aye/todo-web:1.0.1
podman images                                  # image todo sudah tidak ada

# Logout untuk membuktikan image bisa di-pull tanpa login (public)
podman logout ghcr.io

# Pull dari registry
podman pull ghcr.io/isthatyou-aye/todo-api:1.0.1
podman pull ghcr.io/isthatyou-aye/todo-web:1.0.1

# Jalankan lagi (network, volume, dan secret masih ada)
podman run -d --name todo-api --network todo-net -v todo-data:/data `
  --secret todo-admin-token,type=env,target=ADMIN_TOKEN ghcr.io/isthatyou-aye/todo-api:1.0.1
podman run -d --name todo-web --network todo-net -p 8080:8080 ghcr.io/isthatyou-aye/todo-web:1.0.1
podman ps
```

Buka http://localhost:8080: aplikasi berjalan dari image hasil pull, dan data lama masih ada karena volume tidak ikut dihapus.

---

## 12. Bersih-bersih

```powershell
podman rm -f todo-web todo-api
podman volume rm todo-data          # HATI-HATI: menghapus semua data tugas
podman secret rm todo-admin-token
podman network rm todo-net
```

---

## 13. Troubleshooting

| Masalah | Penyebab dan solusi |
|---|---|
| Podman Desktop: *must run with administrative rights to run Hyper-V* | Tidak perlu Hyper-V. Buat Podman machine dengan provider **WSL**. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | Execution policy PowerShell memblokir skrip: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, atau pakai `npm.cmd` |
| `Error: context must be a directory` saat build | Perintah dijalankan di luar folder proyek. `cd` dulu ke folder `todo` |
| `The term '...' is not recognized` saat membuat secret | Nilai secret harus diberi tanda kutip: `"nilai" \| podman secret create todo-admin-token -` |
| Prompt `[y/N]` dari `podman image prune` tidak bisa diketik | Pakai `podman image prune -f` |
| `Cannot connect to Podman` | Machine mati setelah restart laptop: `podman machine start` |
| Warning `HEALTHCHECK is not supported for OCI image format` | Tambahkan `--format docker` pada `podman build` |
| Halaman tampil tetapi muncul "Service api sedang tidak bisa dihubungi" | `todo-api` belum jalan atau beda network. Cek `podman ps` dan pastikan keduanya memakai `--network todo-net` |
| `address already in use` di port 8080 | Port dipakai program lain. Ganti mapping, misalnya `-p 9090:8080` |
| `the container name "todo-api" is already in use` | Container lama masih ada: `podman rm -f todo-api` |
| `manifest unknown` saat build web | Tag base image berubah. Ganti baris `FROM` di `web/Containerfile` menjadi `...nginx-unprivileged:stable-alpine-slim` |
| Push ditolak (`denied`) | Token tidak punya scope `write:packages` atau sudah kedaluwarsa, buat ulang lalu `podman login` lagi |
| Pull gagal (`unauthorized`) setelah logout | Package belum diubah menjadi **Public** di GitHub |
| `podman secret create` gagal karena nama sudah ada | `podman secret rm todo-admin-token` lalu buat ulang |
| `curl` di PowerShell aneh | Pakai `curl.exe`, karena `curl` di PowerShell 5 adalah alias `Invoke-WebRequest` |
| `npm run dev` error `EADDRINUSE` | Port 3000 dipakai program lain. Jalankan dengan port lain: `$env:PORT=3001; npm run dev` |

---

## 14. Riwayat versi

| Versi | Perubahan |
|---|---|
| `1.0.1` | Saat container api dimatikan, halaman menampilkan "Daftar tugas belum bisa dimuat" (bukan "Halaman masih kosong" yang menyesatkan), pesan error muncul dalam hitungan detik (`resolver_timeout 3s`), dan tombol Coba lagi ikut memuat ulang nama aplikasi. Komentar template Nginx tidak lagi ikut terganti nilai variabel. |
| `1.0.0` | Rilis pertama: dua halaman (Tugas dan Ringkasan), dua microservice, push ke GHCR. |

Versi lama tetap tersedia di registry, jadi bisa dijalankan kembali kapan saja, misalnya `podman pull ghcr.io/isthatyou-aye/todo-api:1.0.0`.

---

## 15. Lisensi

Kode aplikasi: MIT. Font Bricolage Grotesque dan Atkinson Hyperlegible Next: SIL Open Font License 1.1 (lihat `web/public/fonts/LICENSE.txt`).
