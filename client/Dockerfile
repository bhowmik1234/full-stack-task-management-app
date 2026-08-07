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
ARG VITE_STRIPE_PROMISES
ARG VITE_FIREBASE_KEY
ARG VITE_FIREBASE_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_BUCKET
ARG VITE_FIREBASE_SENDER_ID
ARG VITE_FIREBASE_APPID
ARG VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_SERVER=$VITE_SERVER \
    VITE_STRIPE_PROMISES=$VITE_STRIPE_PROMISES \
    VITE_FIREBASE_KEY=$VITE_FIREBASE_KEY \
    VITE_FIREBASE_DOMAIN=$VITE_FIREBASE_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_BUCKET=$VITE_FIREBASE_BUCKET \
    VITE_FIREBASE_SENDER_ID=$VITE_FIREBASE_SENDER_ID \
    VITE_FIREBASE_APPID=$VITE_FIREBASE_APPID \
    VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID

# `npm run build` is `tsc && vite build`. Type errors fail the image build on purpose.
RUN npm run build

# ---- serve ----
FROM nginx:1.29-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
