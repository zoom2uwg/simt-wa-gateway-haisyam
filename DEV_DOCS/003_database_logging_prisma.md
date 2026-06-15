# Database Logging dengan Prisma ORM

Menambahkan lapisan database ke gateway menggunakan **Prisma ORM** yang mendukung SQLite (lokal/Docker) dan PostgreSQL (Supabase/Neon/Aiven) dengan satu schema yang sama.

## Skema Database

### Tabel yang Akan Dibuat

```
tenants          — Metadata semua tenant terdaftar
session_logs     — Log event sesi (connected, disconnected, qr_generated)
message_logs     — Log pesan terkirim & masuk
webhook_logs     — Log callback ke Laravel (success/fail)
api_request_logs — Log semua request API masuk ke gateway
```

### Entity Relationship

```
tenants 1──* session_logs
tenants 1──* message_logs
tenants 1──* webhook_logs
tenants 1──* api_request_logs
```

---

## Proposed Changes

### Dependencies
- Install `prisma` (devDependency) + `@prisma/client` (dependency)

---

### [NEW] `prisma/schema.prisma`
Mendefinisikan semua model dengan provider `sqlite` (default, bisa override via env).

### [NEW] `src/lib/db.ts`
Singleton `PrismaClient` agar koneksi tidak dibuat berulang-ulang.

### [MODIFY] `src/config.ts`
Tambah `DATABASE_URL` ke konfigurasi.

### [MODIFY] `.env.example`
Tambah contoh `DATABASE_URL` untuk SQLite dan PostgreSQL.

### [NEW] `src/services/logService.ts`
Service layer untuk semua operasi tulis ke database:
- `logSessionEvent(tenantId, event, status, number?)`
- `logMessageSent(tenantId, to, text, messageId?, referenceId?)`
- `logMessageReceived(tenantId, from, senderName, text, messageId?)`
- `logWebhook(tenantId, event, payload, statusCode, success)`
- `logApiRequest(method, path, tenantId?, statusCode, durationMs)`
- `upsertTenant(id, name?)`

### [MODIFY] `src/services/whatsapp.ts`
Tambahkan panggilan ke `logService` pada setiap event:
- QR generated → `logSessionEvent`
- Connected → `logSessionEvent`
- Disconnected → `logSessionEvent`
- Message received → `logMessageReceived`
- Message sent → `logMessageSent`

### [MODIFY] `src/utils/webhook.ts`
Tambahkan `logWebhook` setelah setiap call axios (success & catch).

### [NEW] `src/middlewares/requestLogger.ts`
Middleware untuk mencatat semua request API masuk ke tabel `api_request_logs`.

### [MODIFY] `src/index.ts`
Pastikan DB/migration siap saat startup.

### [MODIFY] `package.json`
Tambah script:
- `"db:migrate"` — jalankan migration
- `"db:studio"` — buka Prisma Studio (GUI database)
- `"db:generate"` — regenerate Prisma Client

---

## Konfigurasi per Environment

| Environment | DATABASE_URL |
|---|---|
| **Lokal / Docker** | `file:./database.db` (SQLite) |
| **Supabase** | `postgresql://user:pass@db.xxx.supabase.co:5432/postgres` |
| **Neon** | `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require` |
| **Aiven** | `postgresql://user:pass@xxx.aivencloud.com:port/dbname?sslmode=require` |

> [!IMPORTANT]
> Untuk switch dari SQLite ke PostgreSQL, cukup ubah `DATABASE_URL` di `.env`. Schema Prisma menggunakan `env("DATABASE_URL")` sehingga tidak perlu mengubah kode.

> [!NOTE]
> Untuk cloud (Vercel/Netlify), Prisma membutuhkan `DATABASE_URL` yang mengarah ke database eksternal (Supabase/Neon/Aiven). SQLite tidak bisa digunakan di serverless karena filesystem ephemeral.

---

## Rekomendasi Cloud Database (Free Tier)

| Platform | Free Tier | Keunggulan | Native Integration |
|---|---|---|---|
| **Neon** | 512MB, serverless | Auto-suspend, connection pooling, DB branching | ✅ Vercel Storage Marketplace (1-click) |
| **Supabase** | 500MB, 2 projects | Dashboard UI lengkap, realtime, auth | ✅ Vercel & Netlify Integration |
| **Aiven** | Trial 30 hari | Enterprise-grade, multi-cloud | ❌ Manual env var |

---

## Native Platform Integrations

### Vercel (Direkomendasikan)

```
Vercel Dashboard → Storage → Create → Neon
→ DATABASE_URL otomatis di-inject ke project environment
→ Tidak perlu copy-paste manual
```

```
Vercel Dashboard → Integrations → Supabase
→ SUPABASE_URL, DATABASE_URL otomatis di-inject
```

### Netlify

```
Netlify Dashboard → Extensions → Neon
→ DATABASE_URL otomatis tersedia di build & function environment
```

> [!IMPORTANT]
> **Neon membutuhkan DUA URL** untuk Prisma:
> - `DATABASE_URL` — Pooled connection (untuk runtime/query)
> - `DIRECT_URL` — Direct connection (untuk `prisma migrate`)
>
> Schema Prisma akan dikonfigurasi:
> ```prisma
> datasource db {
>   provider  = "postgresql"
>   url       = env("DATABASE_URL")   // pooled - runtime
>   directUrl = env("DIRECT_URL")     // direct - migration
> }
> ```

> [!TIP]
> Untuk **Supabase**, format URL-nya:
> - `DATABASE_URL` → connection pooler URL (port 6543)
> - `DIRECT_URL` → direct URL (port 5432)

---

## package.json Scripts (Sudah Disiapkan)

Script berikut **sudah ditambahkan** ke `package.json` dan siap digunakan setelah Prisma diinstall:

| Script | Perintah | Fungsi |
|---|---|---|
| `postinstall` | `npx prisma generate` | Auto-run saat `npm install` (Vercel/Netlify/CI) |
| `prebuild` | `npx prisma generate` | Auto-run sebelum `npm run build` |
| `db:migrate` | `prisma migrate deploy` | Jalankan migration di production |
| `db:migrate:dev` | `prisma migrate dev` | Buat migration baru di development |
| `db:studio` | `prisma studio` | Buka GUI database browser |
| `db:generate` | `prisma generate` | Regenerate Prisma Client manual |
| `db:reset` | `prisma migrate reset` | Reset database (dev only!) |

---

## Verification Plan

### Automated Tests
- `npm run build` — pastikan TypeScript compile
- `npm run db:migrate` — pastikan migration berjalan

### Manual Verification
- Buka Prisma Studio (`npm run db:studio`) dan verifikasi data masuk setelah:
  - Start session → cek `session_logs`
  - Kirim pesan → cek `message_logs`
  - Webhook fired → cek `webhook_logs`
  - API request → cek `api_request_logs`
