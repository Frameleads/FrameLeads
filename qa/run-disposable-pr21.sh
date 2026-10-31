#!/bin/bash
set -euo pipefail
unset WHOP_API_KEY WHOP_WEBHOOK_SECRET WHOP_CLIENT_SECRET OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY RESEND_API_KEY SMTP_PASSWORD VERCEL_TOKEN CUSTOMER_LIFECYCLE_BRIDGE_SECRET
export AUTOMATION_EXECUTION_ENABLED=false
export DECISION_ENGINE_ROLLOUT_MODE=MANUAL
export DATABASE_URL='postgresql://qa_only:qa_only_password@127.0.0.1:5432/qa_pr21'
echo 'QA_ISOLATION_CHECK_BEGIN'
test -d /app/qa
test ! -f /app/.env.production
test ! -f /app/.env
test "$(ip -4 route show default | wc -l)" -eq 0 || { echo 'QA_ISOLATION_FAIL_DEFAULT_ROUTE'; exit 70; }
if curl --noproxy '*' --connect-timeout 2 --max-time 3 --silent http://192.0.2.1:80 >/dev/null 2>&1; then echo 'QA_ISOLATION_FAIL_EGRESS';exit 71;fi
echo 'QA_ISOLATION_PASS_NO_DEFAULT_ROUTE_AND_NO_OUTBOUND'
pg_ctlcluster 15 main start
su postgres -s /bin/sh -c "psql -v ON_ERROR_STOP=1 -c \"CREATE ROLE qa_only LOGIN PASSWORD 'qa_only_password'\""
su postgres -s /bin/sh -c "createdb -O qa_only qa_pr21"
export PGPASSWORD='qa_only_password'
psql --host=127.0.0.1 --username=qa_only --dbname=qa_pr21 -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_user, inet_server_addr();'
echo 'QA_ISOLATION_PASS_FRESH_LOCAL_POSTGRES'
npx --no-install prisma db push --skip-generate --accept-data-loss
echo 'QA_ISOLATION_PASS_SCHEMA_CREATED_ON_DISPOSABLE_DB'
node qa/pr21-disposable-pg-e2e.cjs
