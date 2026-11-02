#!/bin/sh
# Liti backup: SQLite (hot, via better-sqlite3 .backup) + MySQL (mysqldump)
# Usage (on the Docker host): sh scripts/liti-backup.sh
set -e
TS=$(date +%Y%m%d-%H%M%S)
DIR=/root/backups
mkdir -p "$DIR"

echo "== [1/3] SQLite hot backup =="
docker exec liti node /app/server/_backup_sqlite.js "$TS"
docker cp "liti:/app/data/backup-$TS.db" "$DIR/liti-sqlite-$TS.db"
rm -f "liti:/app/data/backup-$TS.db" 2>/dev/null || true
docker exec liti rm -f "/app/data/backup-$TS.db"
ls -la "$DIR/liti-sqlite-$TS.db"

echo "== [2/3] MySQL dump =="
docker exec liti-mysql mysqldump -uroot -proot123 --single-transaction --triggers --routines --databases liti > "$DIR/liti-mysql-$TS.sql" 2>/dev/null
ls -la "$DIR/liti-mysql-$TS.sql"

echo "== [3/3] verify =="
# SQLite: integrity + row counts
docker cp "$DIR/liti-sqlite-$TS.db" "liti:/app/data/_verify.db"
docker exec liti node /app/server/_verify_sqlite.js "/app/data/_verify.db"
docker exec liti rm -f "/app/data/_verify.db"
# MySQL: dump head/tail sanity
head -5 "$DIR/liti-mysql-$TS.sql"
tail -2 "$DIR/liti-mysql-$TS.sql"
echo "== DONE: backups at $DIR (ts=$TS) =="
