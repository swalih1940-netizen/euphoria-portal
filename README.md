# 🏆 EVENT EUPHORIA '26 - Standalone Festival & Results Portal

A dedicated, high-performance web portal for **Event Euphoria '26**, the annual arts, cultural, and academic competition festival of Sirajul Irfan Da'wa Dars, Kodampuzha.

This project is completely decoupled and standalone, designed to run independently on its own subdomain (e.g. `https://euphoria.sirajulirfan.com`).

---

## 🚀 Features

- **Live Leaderboard & House Standings:** Real-time aggregated point tallies, rank badges, dynamic progress bars, and house standings via FestFlow.
- **Official Results Engine:** Instant category filtering, real-time live search by item name/participant, and status badges.
- **Client-Side Poster Generator:** Generate and export high-resolution branded victory posters (JPG/PNG) directly in the browser via `html-to-image`.
- **Social Sharing:** One-click WhatsApp share button with pre-formatted festival result announcement templates and direct links.
- **Festival Countdown Widget:** Live countdown timer synchronized with IST festival schedule.
- **Fully Responsive Design:** Tailored Sahithyolsav-inspired aesthetics, dark glassmorphism, smooth animations, and gold/amber highlights.
- **SEO & Social Optimization:** Integrated Open Graph tags, Twitter cards, JSON-LD Schema markup, dynamic sitemap (`/sitemap.xml`), and `robots.txt`.

---

## 📁 Project Architecture

```text
euphoria-portal/
├── public/
│   ├── Font/
│   │   ├── Poster Font/              # Nohemi typography for victory posters
│   │   └── Traditional Civilization Demo.ttf  # Euphoria brand font
│   ├── images/                       # Logos, trophies, badges & poster template
│   │   ├── EUPHORIA LOGO.svg
│   │   ├── Fest Photo.jpeg
│   │   ├── Result.jpg
│   │   ├── Result-Main.jpg
│   │   ├── euphoria_story.jpg
│   │   ├── euphoria_trophy.jpg
│   │   └── logo.png / SISA LOGO SVG.svg
│   ├── js/
│   │   └── html-to-image.js          # Poster generation engine
│   ├── manifest.json                 # PWA manifest
│   └── sw.js                         # Service worker
├── services/
│   └── festflowService.js            # FestFlow API client, caching & aggregation
├── views/
│   ├── eventeuphoria.hbs             # Main festival landing page & schedule
│   └── results.hbs                   # Live competition results portal
├── .env                              # Active environment variables
├── .env.example                      # Template for deployment environments
├── app.js                            # Express standalone server & routes
├── package.json                      # Standalone dependencies
├── test_working_apis.js              # Diagnostic script to test FestFlow API
├── vercel.json                       # 1-click Vercel deployment configuration
└── README.md                         # Documentation
```

---

## 🛠️ Quick Start (Local Development)

### 1. Install Dependencies
```bash
cd euphoria-portal
npm install
```

### 2. Configure Environment (.env)
The repository includes a ready-to-use `.env` file:
```env
PORT=3001
NODE_ENV=development
FESTFLOW_BASE_URL=https://euphoria.festfloww.com/api/public
FESTFLOW_API_KEY=da7f60cc99a7b59e264186130f6cb70c4f493eb0c1fa287ff4ae9d7f42235d52
SUBDOMAIN_URL=https://euphoria.sirajulirfan.com
MAIN_SITE_URL=https://sirajulirfan.com
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3001](http://localhost:3001) in your browser:
- Main Fest Portal: [http://localhost:3001](http://localhost:3001)
- Live Results: [http://localhost:3001/result](http://localhost:3001/result)
- API Diagnostics: [http://localhost:3001/health](http://localhost:3001/health)

---

## 🌐 Subdomain Deployment Guide

### Option 1: Vercel Subdomain
1. Push `euphoria-portal/` as its own repository to GitHub (or use root directory setting `euphoria-portal` in Vercel project settings).
2. Connect to Vercel.
3. In Project Settings > Domains, assign your subdomain: `euphoria.sirajulirfan.com`.
4. Add your DNS CNAME record in your domain registrar:
   - Host: `euphoria`
   - Value: `cname.vercel-dns.com`
5. Configure Environment Variables in Vercel dashboard.

### Option 2: VPS / Nginx Reverse Proxy
Add a server block to `/etc/nginx/sites-available/euphoria`:
```nginx
server {
    server_name euphoria.sirajulirfan.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Run `pm2 start app.js --name euphoria-portal` to keep it running 24/7.
