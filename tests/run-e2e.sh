#!/usr/bin/env bash
# End-to-end test: PostgreSQL (must be running, superuser "postgres", trust auth on 127.0.0.1),
# PHP built-in server, notifyd test double, Chromium via Playwright.
#   PGPORT=5433 tests/run-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export PGPORT="${PGPORT:-5432}" PGDATABASE="${PGDATABASE:-e2e}" MOCK_PORT="${MOCK_PORT:-8091}"
export PGSQL_EVENT_SECRET="e2e-$(head -c 12 /dev/urandom | base64 | tr -d '/+=')"
PSQL=(psql -h 127.0.0.1 -p "$PGPORT" -U postgres -X -q -v ON_ERROR_STOP=1)

echo "== database"
"${PSQL[@]}" -d postgres -c "drop database if exists $PGDATABASE" -c "create database $PGDATABASE"
for r in alice bob crm_user crm_readonly notify_daemon app_user; do
  "${PSQL[@]}" -d postgres -c "drop role if exists $r" 2>/dev/null || true
done
"${PSQL[@]}" -d "$PGDATABASE" -f sql/notify.sql
echo "== sql unit tests"
"${PSQL[@]}" -d "$PGDATABASE" -f tests/notify_test.sql | grep -E 'OK|ERROR' || true
# fresh database for the browser test
"${PSQL[@]}" -d postgres -c "drop database $PGDATABASE" -c "create database $PGDATABASE"
for r in app_user; do "${PSQL[@]}" -d postgres -c "drop role if exists $r"; done
"${PSQL[@]}" -d "$PGDATABASE" -f sql/notify.sql
"${PSQL[@]}" -d "$PGDATABASE" -f tests/fixtures.sql >/dev/null

echo "== servers"
DOC=$(mktemp -d)
cp pgsql.php pgsql.js "$DOC/"; mkdir "$DOC/tests"; cp tests/e2e.html "$DOC/tests/"
cp tests/pgsql_config.test.php "$DOC/pgsql_config.php"
php -S localhost:8080 -t "$DOC" >"$DOC/php.log" 2>&1 & PHP_PID=$!
NOTIFYD_SECRET="$PGSQL_EVENT_SECRET" NOTIFYD_AUD=test PORT="$MOCK_PORT" ORIGIN=http://localhost:8080 \
  node tests/notifyd-mock.mjs >"$DOC/mock.log" 2>&1 & MOCK_PID=$!
trap 'kill $PHP_PID $MOCK_PID 2>/dev/null || true; rm -rf "$DOC"' EXIT
sleep 1

echo "== browser"
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node tests/e2e.mjs
