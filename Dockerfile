# =====================================================================
#  Motor de Encuestas – Digital Labs
#  Imagen lista para servidor. Incluye Chromium para whatsapp-web.js.
#  Construir:  docker build -t motor-encuestas .
# =====================================================================
FROM node:20-bookworm-slim

# Chromium del sistema (no se descarga el de Puppeteer) + tini como init,
# para que Chrome no deje procesos zombis dentro del contenedor.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Primero las dependencias, para aprovechar la caché de capas.
# --omit=optional deja fuera Baileys (que necesita git y aquí no hace falta).
COPY package.json ./
RUN npm install --omit=optional --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY . .

# Carpetas que se persisten en volúmenes
RUN mkdir -p /app/data /app/server/auth-wweb /app/server/auth \
 && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/estado').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/server.js"]
