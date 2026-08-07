# syntax=docker/dockerfile:1

# ---- build: generate prisma client + compile TS -> dist/ ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# `npm run build` runs `prisma generate && tsc` and copies the generated client
# into dist/. Type errors fail the image build on purpose.
RUN npm run build

# ---- run ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# schema + migrations ship with the image so `npm run migrate:deploy` can run
# against the container before/at startup
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# multer writes product photos here; compose mounts a named volume over it
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/app.js"]
