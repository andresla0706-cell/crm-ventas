FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY public ./public
# app.js se escribe con JavaScript moderno; aquí se traduce a ES2017 para que abra también en navegadores viejos.
RUN npm run build && npm prune --omit=dev
ENV PORT=3000
ENV DATA_DIR=/data
ENV TZ=America/Bogota
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
