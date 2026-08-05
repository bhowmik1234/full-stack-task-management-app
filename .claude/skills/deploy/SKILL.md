---
name: deploy
description: Deploy this Ecommerce app (Express/Mongo backend + Vite React client) to the Docker VPS. Use when asked to deploy, ship, release, push to production, redeploy, roll back, or when diagnosing a broken/stale deployment.
---

# Deploying the Ecommerce app

Two images behind one origin: `web` (nginx serving the built SPA, proxying `/api` and
`/uploads`) and `backend` (Express on 3000, not published to the host). Orchestrated by
`docker-compose.yml` at the repo root. Mongo is external (Atlas), not a compose service.

Because nginx fronts both, the SPA and the API share an origin — `VITE_SERVER` is the
site's own URL and CORS is never involved.

## Before touching the server

Ask the user for the VPS host/user and the repo path on the box if you don't already
know them; there is no committed deploy target. Do not guess an IP.

Run these locally and stop if any fail:

```bash
cd client && npm run build      # tsc && vite build — type errors block the image build
cd ../backend && npm run build  # tsc
git status --porcelain          # uncommitted work will not ship; it deploys from git
```

Confirm with the user before deploying if the branch is not the one they release from
(`main` is the main branch here; work often sits on `staging`).

## Deploy

The VPS builds from source on `git pull`. There is no registry.

```bash
ssh <user>@<host>
cd <repo-path>
git pull
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=50
```

`--build` is not optional. See the build-args gotcha below.

## Verify

```bash
curl -sI  https://<domain>/                        # 200, Cache-Control: no-cache
curl -s   https://<domain>/api/v1/product/latest   # real JSON, not an nginx error page
curl -sI  https://<domain>/uploads/<known-photo>   # 200
```

Then load the site and check one authenticated action (login → wishlist or an order),
since auth depends on Firebase config baked into the bundle.

A 502 on `/api/` means nginx cannot reach the backend — check `docker compose ps` and
`docker compose logs backend`. A 500 with a JSON body is the app's own error middleware
and usually means Mongo (see the Atlas allowlist gotcha).

## Rollback

```bash
git log --oneline -5
git checkout <last-good-sha>
docker compose up -d --build
```

The `uploads` volume is untouched by a rollback. Never roll back with `down -v`.

## Gotchas specific to this repo

**`VITE_*` is baked in at build time.** Vite inlines env vars into the bundle, so they
are compose `build.args`, not runtime `environment`. Changing `VITE_SERVER`, any
`VITE_FIREBASE_*`, or the Stripe publishable key requires `docker compose up -d --build`
— a plain `up -d` or `restart` silently keeps the old values and the change appears to
have no effect. This is the single most common way a deploy here looks broken.

**`docker compose down -v` destroys all product photos.** Uploads go to local disk via
multer (`backend/uploads/`, UUID filenames) and survive only because of the named
`uploads` volume. Use `down` or `up -d --build`, never `-v`. There is no backup. If the
user wants uploads to stop being a liability, the Cloudinary helpers already exist in
`backend/src/utils/features.ts` — but the product flow still writes to disk, so both
paths are live; check which one a controller uses before changing anything.

**Atlas IP allowlist.** The VPS IP must be allowlisted in MongoDB Atlas. Symptom is a
500 from `/api/` with `buffering timed out after 10000ms`.

**Firebase authorized domains.** The deployed domain must be listed under Firebase
Console → Authentication → Settings → Authorized domains, or login fails in production
while working fine on localhost.

**`backend/dist/` is committed and goes stale.** The Docker build compiles from `src/`
in the builder stage and ignores the committed `dist/`, so a stale `dist/` will not
break the deploy — but it does mean `dist/` in git tells you nothing about what shipped.

**The in-process cache resets on restart.** `myCache` (NodeCache) lives in the backend
process, so every deploy cold-starts it. Expected; the first requests after a deploy are
slower. It also means the cache is not shared if the backend is ever scaled past one
replica — it currently is not.

**Root `.env` vs package `.env` files.** Compose reads the *root* `.env` (see
`.env.example`). `backend/.env` and `client/.env` are for local `npm run dev` only and
are excluded from both images by `.dockerignore` — the client one deliberately, since
Vite would otherwise let it override the build args.

**The URL segment is `payement`.** Misspelled in the route, controller, and URL. Match
it; do not "fix" it in a deploy check.

**Docker build warns `SecretsUsedInArgOrEnv` for `VITE_FIREBASE_KEY`.** Ignore it.
Firebase web API keys are public by design and ship in the client bundle regardless.

## TLS

The compose file binds plain HTTP on `HTTP_PORT` (default 80). For HTTPS, either put
Caddy or an existing host nginx in front and set `HTTP_PORT=8080`, or add a certbot
sidecar. Nothing in the repo terminates TLS today — if the user expects `https://` to
work, that has to be set up on the box first.
