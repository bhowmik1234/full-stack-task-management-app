# syntax=docker/dockerfile:1

# ---- build: compile TS -> dist/ ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# `npm run build` is plain `tsc`. Type errors fail the image build on purpose.
RUN npm run build

# ---- run ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

# multer writes product photos here; compose mounts a named volume over it
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/app.js"]
