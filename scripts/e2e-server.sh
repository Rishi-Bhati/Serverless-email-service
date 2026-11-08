#!/usr/bin/env bash
# Start/stop an isolated local Unsent worker + SMTP sink for end-to-end tests.
# It runs a clean copy of src/ (no .dev.vars, no real secrets, fresh local D1), so nothing is ever delivered
# anywhere but a local sink.
#
#   scripts/e2e-server.sh start <port> [mode]   mode: full (default) | signed | api-key-only
#   scripts/e2e-server.sh stop  <port>
#   scripts/e2e-server.sh mails <port>          print the raw messages the sink received (JSON lines)
#
# `start` prints shell `export` lines; use:  eval "$(scripts/e2e-server.sh start 8811)"
# State lives in $E2E_ROOT/unsent-e2e-<port> (default /tmp).
set -euo pipefail

cmd="${1:-}"; port="${2:-}"; mode="${3:-full}"
[[ -n "$cmd" && -n "$port" ]] || { sed -n '2,12p' "$0" >&2; exit 2; }
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="${E2E_ROOT:-/tmp}/unsent-e2e-$port"
sink_port=$((port + 1000))
API_KEY="e2e-key-0123456789"
API_SECRET="e2e-secret-0123456789abcdef"

stop() {
  for f in worker.pid sink.pid; do
    if [[ -f "$dir/$f" ]]; then
      pid="$(cat "$dir/$f")"
      # wrangler spawns workerd as a child; stop the children first, then the parent.
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
      rm -f "$dir/$f"
    fi
  done
}

case "$cmd" in
  stop) stop; exit 0 ;;
  mails) cat "$dir/mails.jsonl" 2>/dev/null || true; exit 0 ;;
  start) ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac

[[ "$mode" =~ ^(full|signed|api-key-only)$ ]] || { echo "bad mode: $mode" >&2; exit 2; }
stop
mkdir -p "$dir/server"
rm -rf "$dir/server/src" "$dir/server/migrations" "$dir/state"
cp -r "$root/src" "$root/migrations" "$root/tsconfig.json" "$root/package.json" "$dir/server/"
ln -sfn "$root/node_modules" "$dir/server/node_modules"
cat > "$dir/server/wrangler.toml" <<TOML
name = "unsent-e2e-$port"
main = "src/index.ts"
compatibility_date = "2024-05-29"
compatibility_flags = [ "nodejs_compat" ]

[[d1_databases]]
binding = "DB"
database_name = "reportary-email-db"
database_id = "00000000-0000-0000-0000-000000000000"
TOML

: > "$dir/mails.jsonl"
nohup node "$root/scripts/smtp-sink.mjs" "$dir/mails.jsonl" "$sink_port" > "$dir/sink.log" 2>&1 &
echo $! > "$dir/sink.pid"

cd "$dir/server"
npx wrangler d1 migrations apply reportary-email-db --local --persist-to "$dir/state" > "$dir/migrate.log" 2>&1
nohup npx wrangler dev --port "$port" --persist-to "$dir/state" \
  --var "API_KEY:$API_KEY" --var "API_SECRET:$API_SECRET" --var "SECURITY_MODE:$mode" \
  --var ENCRYPTION_KEY:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --var ADMIN_USERNAME:admin --var ADMIN_PASSWORD:e2e-admin-password \
  --var SMTP_HOST:127.0.0.1 --var "SMTP_PORT:$sink_port" --var SMTP_SECURE:false --var SMTP_STARTTLS:false \
  --var SMTP_USERNAME:u --var SMTP_PASSWORD:p --var SMTP_FROM_EMAIL:noreply@e2e.test --var SMTP_THROTTLE_DELAY_MS:0 \
  > "$dir/worker.log" 2>&1 &
echo $! > "$dir/worker.pid"

for _ in $(seq 1 60); do
  if curl -fs "http://localhost:$port/api/health" >/dev/null 2>&1; then
    cat <<EXPORTS
export UNSENT_E2E_BASE_URL=http://localhost:$port
export UNSENT_E2E_API_KEY=$API_KEY
export UNSENT_E2E_API_SECRET=$API_SECRET
export UNSENT_E2E_FROM=noreply@e2e.test
export UNSENT_E2E_MODE=$mode
export UNSENT_E2E_ADMIN_USER=admin
export UNSENT_E2E_ADMIN_PASSWORD=e2e-admin-password
export UNSENT_E2E_MAILS_FILE=$dir/mails.jsonl
EXPORTS
    exit 0
  fi
  sleep 1
done
echo "worker did not become healthy; see $dir/worker.log" >&2
stop
exit 1
