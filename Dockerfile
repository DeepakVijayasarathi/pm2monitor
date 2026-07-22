FROM node:20-alpine

RUN npm install -g pm2

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV PORT=5004 \
    NODE_ENV=production \
    JWT_EXPIRES_IN=24h \
    ADMIN_USERNAME=admin \
    ADMIN_PASSWORD=changeme \
    CORS_ORIGINS=*

# JWT_SECRET is deliberately not defaulted here — set it explicitly with
# `docker run -e JWT_SECRET=...` (e.g. `openssl rand -hex 48`) so sessions
# survive restarts. Without it, the app generates a random one per boot.

RUN mkdir -p /app/backend/data

VOLUME ["/app/backend/data"]

EXPOSE 5004

CMD ["node", "backend/server.js"]
