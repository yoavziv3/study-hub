#!/bin/zsh
# Deploys the portal reader to AWS Lambda in Tel Aviv (il-central-1) and runs it every minute.
#   ./scripts/deploy-portal-lambda.sh
# Needs: the AWS CLI signed in (aws configure), the Israel (Tel Aviv) region enabled in the AWS account,
# CLOUD_URL and STUDY_ADMIN_SECRET in .env, and portal-key.json (node scripts/portal-key.js).
# Safe to run again: it updates the code and settings of what's already there.
set -euo pipefail
export AWS_PAGER=""
cd "$(dirname "$0")/.."

REGION=il-central-1
FN=study-hub-portal-relay
ROLE=study-hub-portal-relay-role
SCHED_ROLE=study-hub-portal-scheduler-role
SCHEDULE=study-hub-portal-relay-every-minute

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "AWS account $ACCOUNT, region $REGION"
[[ -f portal-key.json ]] || { echo "portal-key.json is missing – run: node scripts/portal-key.js"; exit 1; }

# ---------- package: the handler, the shared reader, and package.json (ES modules) ----------
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
cp aws/portal-relay/index.mjs "$BUILD/"
mkdir "$BUILD/shared"
cp shared/portal-api.js shared/portal-relay-core.js "$BUILD/shared/"
echo '{"type":"module"}' > "$BUILD/package.json"
(cd "$BUILD" && zip -qr function.zip index.mjs package.json shared)

# Settings go through a file (never on the command line or the screen).
node -e '
  const fs = require("fs");
  const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  if (!env.CLOUD_URL || !(env.STUDY_ADMIN_SECRET || "").length) throw new Error("CLOUD_URL / STUDY_ADMIN_SECRET missing in .env");
  const key = JSON.parse(fs.readFileSync("portal-key.json", "utf8")).privateJwk;
  fs.writeFileSync(process.argv[1], JSON.stringify({ Variables: { CLOUD_URL: env.CLOUD_URL, ADMIN_SECRET: env.STUDY_ADMIN_SECRET, PORTAL_PRIVATE_KEY: JSON.stringify(key) } }));
' "$BUILD/env.json"

# ---------- the function's role (only CloudWatch logs) ----------
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "creating role $ROLE"
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 12 # a new role takes a moment before Lambda can use it
fi
ROLE_ARN="arn:aws:iam::$ACCOUNT:role/$ROLE"

# ---------- the function ----------
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  echo "updating function $FN"
  aws lambda update-function-code --function-name "$FN" --region "$REGION" --zip-file "fileb://$BUILD/function.zip" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$FN" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FN" --region "$REGION" --environment "file://$BUILD/env.json" >/dev/null
else
  echo "creating function $FN"
  aws lambda create-function --function-name "$FN" --region "$REGION" --runtime nodejs22.x --handler index.handler \
    --role "$ROLE_ARN" --timeout 60 --memory-size 256 --zip-file "fileb://$BUILD/function.zip" --environment "file://$BUILD/env.json" >/dev/null
fi
aws lambda wait function-updated-v2 --function-name "$FN" --region "$REGION"
FN_ARN=$(aws lambda get-function --function-name "$FN" --region "$REGION" --query Configuration.FunctionArn --output text)

# ---------- does the portal answer from here? ----------
aws lambda invoke --function-name "$FN" --region "$REGION" --cli-binary-format raw-in-base64-out --payload '{"ping":true}' "$BUILD/ping.json" >/dev/null
echo "portal from Tel Aviv: $(cat "$BUILD/ping.json")"
if ! grep -q '"status":200' "$BUILD/ping.json"; then
  echo "The portal doesn't answer this function – not scheduling it. The Mac keeps reading the portal."
  exit 1
fi

# ---------- every minute ----------
if ! aws iam get-role --role-name "$SCHED_ROLE" >/dev/null 2>&1; then
  echo "creating role $SCHED_ROLE"
  aws iam create-role --role-name "$SCHED_ROLE" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  sleep 12
fi
aws iam put-role-policy --role-name "$SCHED_ROLE" --policy-name invoke-portal-relay \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"$FN_ARN\"}]}"
TARGET="{\"Arn\":\"$FN_ARN\",\"RoleArn\":\"arn:aws:iam::$ACCOUNT:role/$SCHED_ROLE\",\"RetryPolicy\":{\"MaximumRetryAttempts\":0}}"
if aws scheduler get-schedule --name "$SCHEDULE" --region "$REGION" >/dev/null 2>&1; then
  aws scheduler update-schedule --name "$SCHEDULE" --region "$REGION" --schedule-expression 'rate(1 minute)' --flexible-time-window Mode=OFF --target "$TARGET" >/dev/null
else
  aws scheduler create-schedule --name "$SCHEDULE" --region "$REGION" --schedule-expression 'rate(1 minute)' --flexible-time-window Mode=OFF --target "$TARGET" >/dev/null
fi
echo "done: $FN runs every minute in $REGION; the Mac steps aside while it does."
