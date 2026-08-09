# syntax=docker/dockerfile:1

# ---- build: Vite static bundle ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Vite inlines VITE_* at BUILD time, so these are build args, not runtime env.
# Changing any of them requires rebuilding the image.
ARG VITE_SERVER
# Normally left empty: nginx proxies /api on the console's own host, so the
# console is same-origin with the API and needs no configured base.
ARG VITE_ADMIN_SERVER
ARG VITE_FIREBASE_KEY
ARG VITE_FIREBASE_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_BUCKET
ARG VITE_FIREBASE_SENDER_ID
ARG VITE_FIREBASE_APPID
ARG VITE_FIREBASE_MEASUREMENT_ID
# Store identity and the canonical origin. These were documented in
# .env.example but never passed through here, so a compose deploy rendered
# "[set VITE_STORE_ADDRESS]" in its own returns policy however the root .env was
# filled in — the failure mode the placeholders exist to make visible, arriving
# for a reason nobody would look for.
ARG VITE_STORE_NAME
ARG VITE_SUPPORT_EMAIL
ARG VITE_SUPPORT_PHONE
ARG VITE_STORE_ADDRESS
ARG VITE_SITE_URL
# Social profiles for the footer. Each icon renders only when its URL is set.
ARG VITE_SOCIAL_FACEBOOK
ARG VITE_SOCIAL_TWITTER
ARG VITE_SOCIAL_INSTAGRAM
ARG VITE_SOCIAL_PINTEREST
ENV VITE_SERVER=$VITE_SERVER \
    VITE_ADMIN_SERVER=$VITE_ADMIN_SERVER \
    VITE_FIREBASE_KEY=$VITE_FIREBASE_KEY \
    VITE_FIREBASE_DOMAIN=$VITE_FIREBASE_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_BUCKET=$VITE_FIREBASE_BUCKET \
    VITE_FIREBASE_SENDER_ID=$VITE_FIREBASE_SENDER_ID \
    VITE_FIREBASE_APPID=$VITE_FIREBASE_APPID \
    VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID \
    VITE_STORE_NAME=$VITE_STORE_NAME \
    VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL \
    VITE_SUPPORT_PHONE=$VITE_SUPPORT_PHONE \
    VITE_STORE_ADDRESS=$VITE_STORE_ADDRESS \
    VITE_SITE_URL=$VITE_SITE_URL \
    VITE_SOCIAL_FACEBOOK=$VITE_SOCIAL_FACEBOOK \
    VITE_SOCIAL_TWITTER=$VITE_SOCIAL_TWITTER \
    VITE_SOCIAL_INSTAGRAM=$VITE_SOCIAL_INSTAGRAM \
    VITE_SOCIAL_PINTEREST=$VITE_SOCIAL_PINTEREST

# `npm run build` is `tsc && vite build`, and vite.config.ts declares two
# entries — the storefront (index.html) and the console (admin.html). Type
# errors fail the image build on purpose.
RUN npm run build

# ---- serve ----
FROM nginx:1.29-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
