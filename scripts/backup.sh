#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_root="${1:-./backups}"
mkdir -p "$backup_root"
chmod 700 "$backup_root"
backup_dir="$backup_root/projektwerk-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$backup_dir"
was_running="$(docker compose ps --status running --services app)"
resume_app() { if [[ -n "$was_running" ]]; then docker compose start app >/dev/null; fi; }
trap resume_app EXIT
if [[ -n "$was_running" ]]; then docker compose stop app >/dev/null; fi
umask 077
docker compose run --rm --no-deps -T db-backup > "$backup_dir/database.sql"
docker compose run --rm --no-deps --user root --entrypoint tar app -C /app/uploads -czf - . > "$backup_dir/uploads.tar.gz"
cp .env "$backup_dir/environment.env"
chmod 600 "$backup_dir"/*
echo "Sicherung erstellt: $backup_dir"
