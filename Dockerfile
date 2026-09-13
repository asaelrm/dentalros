FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/app/data/odontologia.sqlite

WORKDIR /app

# Instala solo las dependencias del servidor; excluye herramientas de pruebas.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.js index.html activar.html logo.jpg ./
COPY --chown=node:node server/ ./server/
COPY --chown=node:node js/ ./js/
COPY --chown=node:node css/ ./css/
COPY --chown=node:node img/ ./img/

RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "server.js"]
