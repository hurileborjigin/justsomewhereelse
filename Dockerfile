# Haven - single Node process serving the built client + WebSocket.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/planet.db

EXPOSE 3001
CMD ["node", "server/index.ts"]
