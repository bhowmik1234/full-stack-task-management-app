#!/bin/sh
# Copies backend/uploads/ from the repo into the `uploads` Docker volume.
#
# Run once, on the server, after the first `docker compose up`.
#
# Why this is needed at all: product photos are written to backend/uploads/ by
# multer and the product row stores that path. Twelve of those files were
# committed to git, but backend/Dockerfile never copies them into the image, and
# compose mounts a named volume over /app/uploads regardless — so on a fresh
# deploy those files exist in the repo, are absent from the running container,
# and every product referencing one renders a broken image. Nothing errors; the
# catalogue just looks wrong, which is the kind of failure that gets noticed by
# a customer rather than by a log.
#
# Idempotent: `cp -n` never overwrites, so running it twice does nothing the
# second time and it can never clobber a photo uploaded through the console.

set -eu

cd "$(dirname "$0")/.."

SRC="backend/uploads"

if [ ! -d "$SRC" ]; then
	echo "No $SRC directory — nothing to import."
	exit 0
fi

COUNT=$(find "$SRC" -type f ! -name '.*' | wc -l | tr -d ' ')
if [ "$COUNT" = "0" ]; then
	echo "No files in $SRC — nothing to import."
	exit 0
fi

echo "Importing ${COUNT} file(s) from ${SRC} into the uploads volume..."

# Copied through a helper container rather than by writing into the volume's
# path under /var/lib/docker: that path is root-owned, differs by storage driver
# and does not exist at all on Docker Desktop, where the daemon runs in a VM.
# Going through the API is the only approach that works everywhere.
#
# --chown matches the Dockerfile's `USER node`; files owned by root here would
# be readable but any later delete of a replaced photo would fail.
docker run --rm \
	-v ecommerce_uploads:/dest \
	-v "$PWD/$SRC:/src:ro" \
	--user 0 \
	alpine:3 \
	sh -c 'cp -n /src/* /dest/ 2>/dev/null; chown -R 1000:1000 /dest; ls -1 /dest | wc -l'

echo "Done. Verify a product image loads, then untrack the copies in git:"
echo "    git rm -r --cached backend/uploads"
echo "(the files stay on disk; backend/uploads/ is already in .gitignore)"
