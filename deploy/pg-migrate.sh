#!/usr/bin/env bash
set -e
set -a
. /home/ubuntu/pg.env
. /etc/partselect.env   # AWS creds + EMBEDDINGS_PROVIDER for the embed step
set +a
export DB_DRIVER=pg     # ensure pg even if /etc/partselect.env lacks it

cd /home/ubuntu/app2/partselect-agent
echo "DB_DRIVER=$DB_DRIVER  PGHOST=$PGHOST"
echo "== seed =="
npx tsx src/server/db/seed.ts
echo "== ingest =="
npx tsx scripts/ingest-real.ts 2>&1 | tail -2
echo "== embed =="
npx tsx scripts/embed.ts 2>&1 | tail -2
echo "== stats =="
npx tsx scripts/db-stats.ts
