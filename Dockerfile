FROM node:20-alpine

RUN npm install -g pm2

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV PORT=5004 \
    NODE_ENV=production \
    JWT_SECRET=change-this-secret \
    JWT_EXPIRES_IN=24h \
    ADMIN_USERNAME=admin \
    ADMIN_PASSWORD=changeme \
    CORS_ORIGINS=*

EXPOSE 5004

CMD ["node", "backend/server.js"]
