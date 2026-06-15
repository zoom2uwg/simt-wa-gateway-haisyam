# Panduan Deployment SIMT WA Gateway

> [!IMPORTANT]
> WA Gateway berbasis Baileys **membutuhkan** server yang berjalan terus-menerus (*always-on*) dengan filesystem persisten. Platform serverless (Vercel/Netlify) **tidak cocok** untuk aplikasi ini.

---

## Pilihan Platform

| Platform | Harga | Kesulitan | Cocok Untuk |
|---|---|---|---|
| **Railway** | Free $5 credit/bln | ⭐ Mudah | Coba-coba & kecil |
| **Render** | Free 750 jam/bln | ⭐⭐ Mudah | Development & staging |
| **Fly.io** | Free 3 shared VM | ⭐⭐ Sedang | Production ringan |
| **VPS + Docker** | ~$4–6/bln | ⭐⭐⭐ Sedang | Production serius |
| **VPS + PM2** | ~$4–6/bln | ⭐⭐⭐ Sedang | Full control |
| **cPanel Hosting** | Tergantung paket | ⭐⭐⭐⭐ Sulit | Tidak direkomendasikan |

---

## 1. Railway (Termudah)

### Prasyarat
- Akun [railway.app](https://railway.app)
- GitHub repo sudah push

### Langkah Deploy

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link ke project baru
railway init

# Deploy
railway up
```

### Set Environment Variables di Dashboard

```
Railway Dashboard → Project → Variables → Add:
  PORT=8081
  NODE_ENV=production
  WA_GATEWAY_API_KEY=<api-key-anda>
  LARAVEL_WEBHOOK_URL=<url-laravel-anda>
  WA_CALLBACK_SECRET=<secret-anda>
```

> [!NOTE]
> Railway mendukung **persistent volumes** untuk menyimpan data sesi WA.
> Railway Dashboard → Project → Volumes → Create Volume → mount ke `/app/sessions`

---

## 2. Render

### Prasyarat
- Akun [render.com](https://render.com)
- File `render.yaml` sudah ada di repo

### Langkah Deploy

1. Buka [render.com](https://render.com) → **New** → **Blueprint**
2. Connect GitHub repo
3. Render akan otomatis membaca `render.yaml`
4. Set environment variables yang `sync: false`:
   ```
   WA_GATEWAY_API_KEY=<api-key-anda>
   LARAVEL_WEBHOOK_URL=<url-laravel-anda>
   WA_CALLBACK_SECRET=<secret-anda>
   ```
5. Klik **Apply**

> [!IMPORTANT]
> **Persistent Disk** sudah dikonfigurasi di `render.yaml` (mount ke `/app/sessions`, 1GB).
> Free tier Render **tidak mendukung persistent disk** — upgrade ke plan berbayar ($7/bln) untuk production.

---

## 3. Fly.io

### Prasyarat
- Akun [fly.io](https://fly.io)
- Install Fly CLI: `curl -L https://fly.io/install.sh | sh`

### Langkah Deploy

```bash
# Login
flyctl auth login

# Deploy pertama kali (buat app + volume)
flyctl launch --no-deploy

# Buat persistent volume untuk sessions
flyctl volumes create wa_sessions --size 1 --region sin

# Set secrets (environment variables)
flyctl secrets set \
  WA_GATEWAY_API_KEY=<api-key-anda> \
  LARAVEL_WEBHOOK_URL=<url-laravel-anda> \
  WA_CALLBACK_SECRET=<secret-anda>

# Deploy
flyctl deploy
```

### Cek Status

```bash
flyctl status
flyctl logs
flyctl open /api/health
```

> [!TIP]
> Fly.io region `sin` (Singapore) adalah yang paling dekat dari Indonesia.

---

## 4. VPS + Docker (DigitalOcean / Contabo / Niagahoster)

### Prasyarat
- VPS dengan Ubuntu 22.04
- Docker dan Docker Compose terinstall

### Langkah Deploy

```bash
# 1. Clone repo ke VPS
git clone https://github.com/<username>/simt-wa-gateway.git
cd simt-wa-gateway

# 2. Buat file .env dari template
cp .env.example .env
nano .env  # isi dengan nilai yang benar

# 3. Build & jalankan dengan Docker Compose
docker compose up -d --build

# 4. Cek status
docker compose ps
docker compose logs -f

# 5. Test health check
curl http://localhost:8081/api/health
```

### Perintah Berguna

```bash
# Restart service
docker compose restart wa-gateway

# Update (setelah git pull)
git pull
docker compose up -d --build

# Stop service
docker compose down

# Lihat logs real-time
docker compose logs -f wa-gateway

# Masuk ke container
docker compose exec wa-gateway sh
```

### Konfigurasi Nginx (Reverse Proxy)

```nginx
server {
    listen 80;
    server_name gateway.domain.com;

    location / {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
    }
}
```

```bash
# Enable SSL dengan Certbot
sudo certbot --nginx -d gateway.domain.com
```

---

## 5. VPS + PM2 (Tanpa Docker)

### Prasyarat
- Node.js 20 terinstall
- PM2 terinstall: `npm install -g pm2`

### Langkah Deploy

```bash
# 1. Clone repo
git clone https://github.com/<username>/simt-wa-gateway.git
cd simt-wa-gateway

# 2. Install dependencies
npm install

# 3. Build TypeScript
npm run build

# 4. Buat file .env
cp .env.example .env
nano .env

# 5. Buat folder logs
mkdir -p logs

# 6. Jalankan dengan PM2
pm2 start ecosystem.config.js --env production

# 7. Simpan config PM2 (auto-start saat reboot)
pm2 save
pm2 startup  # ikuti instruksi yang muncul
```

### Perintah PM2 Berguna

```bash
# Status aplikasi
pm2 status

# Lihat logs real-time
pm2 logs simt-wa-gateway

# Restart
pm2 restart simt-wa-gateway

# Update & restart
git pull && npm install && npm run build && pm2 restart simt-wa-gateway

# Stop
pm2 stop simt-wa-gateway

# Monitor CPU/RAM
pm2 monit
```

---

## 6. cPanel / Shared Hosting

> [!WARNING]
> Shared hosting dengan cPanel **sangat tidak direkomendasikan** untuk WA Gateway karena:
> - Tidak mendukung proses Node.js yang berjalan terus-menerus
> - Port terbatas, tidak mendukung WebSocket
> - Filesystem sering di-reset
>
> Gunakan VPS sebagai gantinya.

---

## Variabel Environment yang Wajib Diset

```env
PORT=8081
NODE_ENV=production
WA_GATEWAY_API_KEY=<generate-dengan-crypto.randomBytes(32).toString('hex')>
LARAVEL_WEBHOOK_URL=https://app.domain.com/api/v1/wa/delivery-callback
WA_CALLBACK_SECRET=<secret-yang-kuat>
```

---

## Monitoring & Health Check

Semua platform mendukung health check via:
```
GET /api/health
→ { "status": "ok", "time": "..." }
```

Gunakan uptime monitoring gratis seperti:
- [UptimeRobot](https://uptimerobot.com) — ping setiap 5 menit, gratis
- [BetterStack](https://betterstack.com) — 10 monitors gratis
