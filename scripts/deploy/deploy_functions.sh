#!/usr/bin/env bash
# =============================================================================
# deploy_functions.sh — Alfanumrik Edge Function Deployer
# =============================================================================
# Deploys Supabase Edge Functions to the production project.
#
# Usage:
#   bash scripts/deploy/deploy_functions.sh
#                             Deploy 7 changed functions only (default)
#   bash scripts/deploy/deploy_functions.sh --all
#                             Deploy all 46 active functions (~10 min)
#   bash scripts/deploy/deploy_functions.sh --function FNAME
#                             Deploy a single named function
#   bash scripts/deploy/deploy_functions.sh --changed-since COMMIT_SHA
#                             Detect and deploy functions changed since a commit
#
# Required environment variables:
#   SUPABASE_ACCESS_TOKEN    — Personal access token from app.supabase.com/account/tokens
#   SUPABASE_PROJECT_REF     — Project ref (default: shktyoxqhundlvkiwguu)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Color setup
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' RESET=''
fi

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}\n"; }

# ---------------------------------------------------------------------------
# Timing and logging
# ---------------------------------------------------------------------------
START_TIME=$(date +%s)
START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LOG_FILE="$(dirname "$0")/.last_functions_deploy.log"

# ---------------------------------------------------------------------------
# All 46 active Edge Functions
# ---------------------------------------------------------------------------
ALL_FUNCTIONS=(
  account-purge
  alert-deliverer
  alfabot-answer
  alfabot-send-inquiry
  bulk-jee-neet-curated-import
  bulk-jee-neet-import
  bulk-non-mcq-gen
  bulk-question-gen
  cme-engine
  coverage-audit
  daily-cron
  data-erasure-purger
  embed-diagrams
  embed-ncert-qa
  embed-questions
  export-report
  extract-diagrams
  extract-ncert-questions
  generate-answers
  generate-concepts
  generate-embeddings
  grade-experiment-conclusion
  grounded-answer
  identity
  invoice-generator
  monthly-synthesis-builder
  ncert-question-engine
  ncert-solver
  nep-compliance
  parent-portal
  parent-report-generator
  projector-health-check
  projector-runner
  queue-consumer
  quiz-generator
  scan-ocr
  send-auth-email
  send-pre-debit-notice
  send-renewal-reminder
  send-transactional-email
  send-welcome-email
  session-guard
  synthetic-host-monitor
  teacher-dashboard
  verify-question-bank
  whatsapp-notify
)

# 7 functions changed since last deploy (2026-06-09)
CHANGED_FUNCTIONS=(
  bulk-non-mcq-gen
  extract-ncert-questions
  grade-experiment-conclusion
  monthly-synthesis-builder
  nep-compliance
  parent-report-generator
  verify-question-bank
)

FUNCTIONS_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)/supabase/functions"

# ---------------------------------------------------------------------------
# Step 1: Validate environment
# ---------------------------------------------------------------------------
header "Pre-flight: Environment"

if ! command -v supabase &>/dev/null; then
  error "Supabase CLI not found. Install: brew install supabase/tap/supabase"
  exit 1
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  error "SUPABASE_ACCESS_TOKEN is not set."
  echo "       Get it from: https://app.supabase.com/account/tokens"
  exit 1
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-shktyoxqhundlvkiwguu}"
success "SUPABASE_ACCESS_TOKEN: set"
success "SUPABASE_PROJECT_REF:  $PROJECT_REF"

# ---------------------------------------------------------------------------
# Step 2: Parse arguments and build deploy list
# ---------------------------------------------------------------------------
DEPLOY_MODE="changed"
SPECIFIC_FUNCTION=""
CHANGED_SINCE_SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      DEPLOY_MODE="all"
      shift
      ;;
    --function)
      DEPLOY_MODE="specific"
      SPECIFIC_FUNCTION="${2:-}"
      if [[ -z "$SPECIFIC_FUNCTION" ]]; then
        error "--function requires a function name argument."
        exit 1
      fi
      shift 2
      ;;
    --changed-since)
      DEPLOY_MODE="changed-since"
      CHANGED_SINCE_SHA="${2:-}"
      if [[ -z "$CHANGED_SINCE_SHA" ]]; then
        error "--changed-since requires a commit SHA argument."
        exit 1
      fi
      shift 2
      ;;
    *)
      error "Unknown argument: $1"
      echo "Usage: $0 [--all | --function NAME | --changed-since COMMIT_SHA]"
      exit 1
      ;;
  esac
done

# Build the list of functions to deploy
FUNCTIONS_TO_DEPLOY=()

case "$DEPLOY_MODE" in
  changed)
    header "Mode: Deploy Changed Functions (7)"
    FUNCTIONS_TO_DEPLOY=("${CHANGED_FUNCTIONS[@]}")
    info "Deploying the 7 functions changed since last deploy:"
    for fn in "${CHANGED_FUNCTIONS[@]}"; do
      echo "    - $fn"
    done
    ;;

  all)
    header "Mode: Deploy All Functions (${#ALL_FUNCTIONS[@]})"
    warn "Deploying all ${#ALL_FUNCTIONS[@]} functions. This takes approximately 10 minutes."
    echo ""
    read -rp "Type 'yes' to continue: " CONFIRM
    echo ""
    if [[ "$CONFIRM" != "yes" ]]; then
      info "Aborted by user."
      exit 0
    fi
    FUNCTIONS_TO_DEPLOY=("${ALL_FUNCTIONS[@]}")
    ;;

  specific)
    header "Mode: Deploy Single Function"
    # Validate function is in the known list
    FOUND=0
    for fn in "${ALL_FUNCTIONS[@]}"; do
      if [[ "$fn" == "$SPECIFIC_FUNCTION" ]]; then
        FOUND=1
        break
      fi
    done
    if [[ "$FOUND" -eq 0 ]]; then
      warn "Function '$SPECIFIC_FUNCTION' is not in the known active function list."
      warn "Proceeding anyway — it may be a new function not yet added to this script."
    fi
    FUNCTIONS_TO_DEPLOY=("$SPECIFIC_FUNCTION")
    info "Deploying single function: $SPECIFIC_FUNCTION"
    ;;

  changed-since)
    header "Mode: Deploy Functions Changed Since $CHANGED_SINCE_SHA"
    info "Detecting changed functions..."
    # Look for any file changes under supabase/functions/<name>/
    DETECTED=()
    while IFS= read -r changed_path; do
      # Extract function name from path like supabase/functions/NAME/...
      if [[ "$changed_path" =~ ^supabase/functions/([^/_][^/]*)/.*$ ]]; then
        fn_name="${BASH_REMATCH[1]}"
        # Check if already in list
        ALREADY=0
        for existing in "${DETECTED[@]:-}"; do
          if [[ "$existing" == "$fn_name" ]]; then
            ALREADY=1; break
          fi
        done
        if [[ "$ALREADY" -eq 0 ]]; then
          # Verify it's in the active list
          for active in "${ALL_FUNCTIONS[@]}"; do
            if [[ "$active" == "$fn_name" ]]; then
              DETECTED+=("$fn_name")
              break
            fi
          done
        fi
      fi
    done < <(git diff --name-only "$CHANGED_SINCE_SHA" HEAD 2>/dev/null || true)

    if [[ ${#DETECTED[@]} -eq 0 ]]; then
      info "No function changes detected since $CHANGED_SINCE_SHA. Nothing to deploy."
      exit 0
    fi

    echo ""
    info "Detected ${#DETECTED[@]} changed function(s):"
    for fn in "${DETECTED[@]}"; do
      echo "    - $fn"
    done
    FUNCTIONS_TO_DEPLOY=("${DETECTED[@]}")
    ;;
esac

# ---------------------------------------------------------------------------
# Step 3: Deploy each function
# ---------------------------------------------------------------------------
header "Deploying ${#FUNCTIONS_TO_DEPLOY[@]} function(s)"

SUCCESS_COUNT=0
FAIL_COUNT=0
FAILED_FUNCTIONS=()
DEPLOY_RESULTS=()

for fn in "${FUNCTIONS_TO_DEPLOY[@]}"; do
  echo -e "${BOLD}→ Deploying:${RESET} $fn"
  CMD="supabase functions deploy $fn --project-ref $PROJECT_REF --no-verify-jwt"

  if $CMD 2>&1; then
    success "  $fn — deployed"
    SUCCESS_COUNT=$(( SUCCESS_COUNT + 1 ))
    DEPLOY_RESULTS+=("PASS  $fn")
  else
    error "  $fn — FAILED"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
    FAILED_FUNCTIONS+=("$fn")
    DEPLOY_RESULTS+=("FAIL  $fn")
  fi
  echo ""
done

# ---------------------------------------------------------------------------
# Step 4: Summary table
# ---------------------------------------------------------------------------
header "Deployment Summary"

echo -e "  ${BOLD}Function                             Status${RESET}"
echo    "  ---------------------------------------------------------------"
for result in "${DEPLOY_RESULTS[@]}"; do
  STATUS="${result:0:4}"
  FNAME="${result:6}"
  if [[ "$STATUS" == "PASS" ]]; then
    echo -e "  ${GREEN}PASS${RESET}  $FNAME"
  else
    echo -e "  ${RED}FAIL${RESET}  $FNAME"
  fi
done
echo    "  ---------------------------------------------------------------"
echo -e "  Total: ${#FUNCTIONS_TO_DEPLOY[@]} | ${GREEN}${SUCCESS_COUNT} succeeded${RESET} | ${RED}${FAIL_COUNT} failed${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Write log
# ---------------------------------------------------------------------------
END_TIME=$(date +%s)
END_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DURATION=$(( END_TIME - START_TIME ))
OVERALL_EXIT=0
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  OVERALL_EXIT=1
fi

{
  echo "---"
  echo "start_time:      $START_ISO"
  echo "end_time:        $END_ISO"
  echo "duration_sec:    $DURATION"
  echo "git_sha:         $GIT_SHA"
  echo "project_ref:     $PROJECT_REF"
  echo "deploy_mode:     $DEPLOY_MODE"
  echo "total:           ${#FUNCTIONS_TO_DEPLOY[@]}"
  echo "succeeded:       $SUCCESS_COUNT"
  echo "failed:          $FAIL_COUNT"
  if [[ ${#FAILED_FUNCTIONS[@]} -gt 0 ]]; then
    echo "failed_functions: ${FAILED_FUNCTIONS[*]}"
  fi
  echo "exit_code:       $OVERALL_EXIT"
} >> "$LOG_FILE"

# ---------------------------------------------------------------------------
# Step 5: Next steps
# ---------------------------------------------------------------------------
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo -e "${YELLOW}Some functions failed to deploy. To retry a single function:${RESET}"
  for fn in "${FAILED_FUNCTIONS[@]}"; do
    echo "  bash scripts/deploy/deploy_functions.sh --function $fn"
  done
  echo ""
  echo "Check the Supabase dashboard for function logs:"
  echo "  https://app.supabase.com/project/$PROJECT_REF/functions"
  echo ""
fi

echo -e "${BOLD}Next step: Verify production${RESET}"
echo "  bash scripts/deploy/verify_production.sh"
echo ""
echo -e "  ${GREEN}Deploy log written to: $LOG_FILE${RESET}"

exit $OVERALL_EXIT
