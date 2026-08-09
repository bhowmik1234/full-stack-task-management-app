#!/bin/sh
# Periodic pg_dump with retention. Run as the `backup` service in
# docker-compose.prod.yml; not intended to be run by hand, though it is safe to.
#
# A loop with sleep rather than cron: the container has one job, and cron in a
# container means a second process, its own log nobody reads, and a failure mode
# where the container is up and healthy while nothing has been dumped in weeks.
# Here, if backups stop, the container has exited and `docker compose ps` says
# so.
#
# WHAT THIS IS NOT: a copy on the same machine is not a backup. It survives a
# dropped table, a bad migration and a fat-fingered DELETE — not a failed disk,
# a lost VPS or a compromised host, which are the cases people actually lose
# companies to. BACKUP_DIR is a bind mount precisely so something else can ship
# it off the box; see docs/deployment.md.

set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
KEEP_DAYS="${BACKUP_RETENTION_DAYS:-14}"
DIR="${BACKUP_DIR:-/backups}"

mkdir -p "$DIR"

echo "[backup] every ${INTERVAL}s, keeping ${KEEP_DAYS} days, into ${DIR}"

while true; do
	STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
	TMP="${DIR}/.in-progress-${STAMP}.sql.gz"
	OUT="${DIR}/${POSTGRES_DB}-${STAMP}.sql.gz"

	# Written under a temporary name and renamed only on success. A dump
	# interrupted half-way — the container stopped, the disk filled — would
	# otherwise sit in the directory looking exactly like a good one, and be
	# found out at the worst imaginable moment. rename is atomic, so every file
	# matching the real name is a dump that finished.
	if pg_dump --no-owner --no-privileges --clean --if-exists \
		-h "${POSTGRES_HOST:-db}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
		| gzip -9 > "$TMP"; then
		mv "$TMP" "$OUT"
		echo "[backup] wrote $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"

		# Only ever prune after a dump we know succeeded. Pruning first, or
		# unconditionally, is how a week of failing backups quietly deletes the
		# last good one it had.
		find "$DIR" -name "${POSTGRES_DB}-*.sql.gz" -type f -mtime "+${KEEP_DAYS}" -delete
		find "$DIR" -name ".in-progress-*" -type f -mtime +1 -delete
	else
		# Deliberately does not exit. A transient failure — the database
		# restarting, a moment of disk pressure — should be retried at the next
		# tick rather than stopping backups until somebody notices the container
		# is gone. A persistent failure prints this line every cycle.
		echo "[backup] FAILED at ${STAMP}; retrying next cycle" >&2
		rm -f "$TMP"
	fi

	sleep "$INTERVAL"
done
