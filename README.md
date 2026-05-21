# PM2 Monitor

A full-stack, real-time PM2 process management dashboard with JWT authentication, live metrics via Socket.io, dark mode, and a responsive UI.

---

## Features

| Feature | Details |
|---|---|
| **PM2 Management** | List, start, stop, restart, delete apps; flush logs |
| **Live Metrics** | CPU, RAM, disk streamed over Socket.io every 3 s |
| **Duplicate Port Detection** | Warns when multiple apps share the same port |
| **Authentication** | JWT-based login with bcrypt password hashing |
| **Dark / Light Mode** | Toggle persisted in `localStorage` |
| **Responsive UI** | Works on desktop, tablet, and mobile |
| **Security** | Helmet.js, CORS, rate limiting, XSS protection, input validation |
| **Charts** | CPU and memory usage history (Chart.js) |
| **Log Viewer** | stdout / stderr logs in modal with auto-scroll and flush |
| **Port Checker** | Check if arbitrary ports are open or in use |
| **Docker** | `docker-compose up` ready |
| **Nginx** | Production reverse-proxy config included |
| **PM2 Ecosystem** | `ecosystem.config.js` for bare-metal deployment |

---

## Prerequisites

- **Node.js** 18 + (20 LTS recommended)
- **PM2** installed globally: `npm install -g pm2`
- A running PM2 daemon on the host

---

## Quick Start (bare-metal)

```bash
# 1. Clone / copy the project
cd /srv
git clone https://github.com/you/pm2-monitor.git
cd pm2-monitor

# 2. Configure environment
cp .env.example backend/.env
nano backend/.env          # set JWT_SECRET, ADMIN_PASSWORD

# 3. Install backend dependencies
cd backend && npm install --omit=dev && cd ..

# 4. Start with PM2
pm2 start ecosystem.config.js
pm2 save

# 5. Open http://localhost:3000
```

Default credentials: **admin / changeme** — change `ADMIN_PASSWORD` before exposing to a network.

---

## Docker

```bash
# Copy and edit env
cp .env.example .env
nano .env

# Build and run (app only)
docker-compose up -d pm2-monitor

# Build and run (app + Nginx)
docker-compose --profile nginx up -d
```

> **Note:** The container uses `network_mode: host` and mounts `/root/.pm2` so it can control the host's PM2 daemon. If your PM2 home is elsewhere, update the volume path in `docker-compose.yml`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `NODE_ENV` | `production` | Node environment |
| `JWT_SECRET` | _(required)_ | Random 64-char hex string for signing JWTs |
| `JWT_EXPIRES_IN` | `24h` | Token lifetime (e.g. `1h`, `7d`) |
| `ADMIN_USERNAME` | `admin` | Login username |
| `ADMIN_PASSWORD` | `changeme` | Login password (hashed at startup) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed CORS origins |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate-limit window in ms (15 min) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## API Reference

All endpoints except `/api/auth/login` require `Authorization: Bearer <token>`.

### Auth

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | `{ username, password }` | Returns JWT token |
| `POST` | `/api/auth/logout` | — | Logout (client discards token) |
| `GET` | `/api/auth/me` | — | Returns current user |

### Applications

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/apps` | List all PM2 apps + duplicate port map |
| `GET` | `/api/apps/:id` | Get single app details |
| `POST` | `/api/apps/:id/start` | Start app |
| `POST` | `/api/apps/:id/stop` | Stop app |
| `POST` | `/api/apps/:id/restart` | Restart app |
| `DELETE` | `/api/apps/:id` | Delete app from PM2 |
| `GET` | `/api/apps/:id/logs?lines=100` | Get stdout + stderr logs |
| `POST` | `/api/apps/:id/flush` | Flush log files |
| `POST` | `/api/apps/restart-all` | Restart all running apps |

### System

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/system/stats` | CPU, RAM, disk, network, OS info |
| `GET` | `/api/system/ports?ports=3000,8080` | Check if ports are in use |

---

## Project Structure

```
pm2-monitor/
├── backend/
│   ├── server.js              # Express + Socket.io server
│   ├── middleware/
│   │   └── auth.js            # JWT middleware
│   ├── routes/
│   │   ├── auth.js            # Login / logout / me
│   │   ├── apps.js            # PM2 app management
│   │   └── system.js          # System stats + port check
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── index.html             # Main dashboard (SPA)
│   ├── login.html             # Login page
│   ├── css/style.css          # Dark/light theme + layout
│   └── js/
│       ├── auth.js            # Auth helpers + apiFetch
│       ├── socket.js          # Socket.io client manager
│       └── app.js             # Dashboard logic + charts
├── Dockerfile
├── docker-compose.yml
├── nginx.conf                 # Production Nginx config
├── ecosystem.config.js        # PM2 ecosystem file
├── .env.example
└── README.md
```

---

## Nginx Setup (bare-metal)

```bash
# Install Nginx
sudo apt install nginx

# Copy config
sudo cp nginx.conf /etc/nginx/sites-available/pm2-monitor
sudo ln -s /etc/nginx/sites-available/pm2-monitor /etc/nginx/sites-enabled/

# Edit server_name and TLS paths
sudo nano /etc/nginx/sites-available/pm2-monitor

sudo nginx -t && sudo systemctl reload nginx
```

For TLS certificates, use [Let's Encrypt](https://certbot.eff.org/):
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Security Notes

- Change `ADMIN_PASSWORD` and `JWT_SECRET` before any public deployment.
- Place the dashboard behind Nginx with TLS in production.
- The app is accessible to anyone on the same network — use firewall rules or VPN to restrict access.
- JWT tokens expire after `JWT_EXPIRES_IN`; clients are automatically redirected to login on expiry.

---

## License

MIT
"# pm2monitor" 
