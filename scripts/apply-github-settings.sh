#!/usr/bin/env bash
# Apply GitHub branch protection and Actions settings for aws-spark-notebooks.
#
# Requires: gh CLI authenticated with admin access to the repository.
#
# Usage:
#   ./scripts/apply-github-settings.sh
#   ./scripts/apply-github-settings.sh --owner denerops --repo aws-spark-notebooks
#
# What this configures:
#   1. Repository ruleset on main — require PR + CI job checks before merge
#   2. Admin role bypass on that ruleset (semantic-release via GH_ADMIN_PAT)
#   3. Removes legacy branch protection (avoids duplicate required checks)
#   4. Most permissive workflow approval policy allowed by GitHub's API
#   5. Private-repo fork PR workflows without maintainer approval (if applicable)
set -euo pipefail

OWNER=""
REPO=""
DRY_RUN=false

usage() {
  sed -n '2,14p' "$0"
  echo "Options:"
  echo "  --owner OWNER   GitHub owner (default: from git remote origin)"
  echo "  --repo REPO     GitHub repo name (default: from git remote origin)"
  echo "  --dry-run       Print actions without calling the GitHub API"
  echo "  -h, --help      Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner)
      OWNER="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required. Install from https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

if [[ -z "$OWNER" || -z "$REPO" ]]; then
  remote_url="$(git -C "$(dirname "$0")/.." config --get remote.origin.url || true)"
  if [[ "$remote_url" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
    OWNER="${BASH_REMATCH[1]}"
    REPO="${BASH_REMATCH[2]%.git}"
  else
    echo "Error: could not parse owner/repo from git remote. Pass --owner and --repo." >&2
    exit 1
  fi
fi

REPO_SLUG="${OWNER}/${REPO}"
RULESET_FILE="$(dirname "$0")/../.github/rulesets/protect-main.json"

echo "Configuring ${REPO_SLUG}..."

run_gh() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] gh $*"
  else
    gh "$@"
  fi
}

remove_legacy_branch_protection() {
  echo "→ Remove legacy branch protection on main (ruleset handles enforcement)"
  if [[ "$DRY_RUN" == true ]]; then
    return
  fi

  if gh api "repos/${REPO_SLUG}/branches/main/protection" >/dev/null 2>&1; then
    gh api --method DELETE "repos/${REPO_SLUG}/branches/main/protection"
  else
    echo "  (no legacy branch protection configured)"
  fi
}

apply_ruleset() {
  if [[ ! -f "$RULESET_FILE" ]]; then
    echo "→ Skipping ruleset (file not found: ${RULESET_FILE})"
    return
  fi

  echo "→ Sync repository ruleset (Protect main)"
  if [[ "$DRY_RUN" == true ]]; then
    cat "$RULESET_FILE"
    return
  fi

  existing_id="$(gh api "repos/${REPO_SLUG}/rulesets" --jq '.[] | select(.name == "Protect main") | .id' | head -n 1 || true)"
  if [[ -n "$existing_id" ]]; then
    gh api \
      --method PUT \
      "repos/${REPO_SLUG}/rulesets/${existing_id}" \
      --input "$RULESET_FILE"
  else
    gh api \
      --method POST \
      "repos/${REPO_SLUG}/rulesets" \
      --input "$RULESET_FILE"
  fi
}

apply_workflow_approval_policy() {
  echo "→ Set workflow approval policy to first_time_contributors_new_to_github (least restrictive API option)"
  run_gh api \
    --method PUT \
    "repos/${REPO_SLUG}/actions/permissions/fork-pr-contributor-approval" \
    -f approval_policy='first_time_contributors_new_to_github'
}

apply_private_fork_workflow_policy() {
  visibility="$(gh repo view "$REPO_SLUG" --json visibility --jq .visibility 2>/dev/null || echo unknown)"
  if [[ "$visibility" != "PRIVATE" && "$visibility" != "INTERNAL" ]]; then
    echo "→ Skipping private fork workflow policy (repo visibility: ${visibility})"
    return
  fi

  echo "→ Allow fork PR workflows without maintainer approval (private repo)"
  if [[ "$DRY_RUN" == true ]]; then
    echo '{"run_workflows_from_fork_pull_requests": true, "require_approval_for_fork_pr_workflows": false}'
    return
  fi

  gh api \
    --method PUT \
    "repos/${REPO_SLUG}/actions/permissions/fork-pr-workflows-private-repos" \
    -f run_workflows_from_fork_pull_requests=true \
    -F require_approval_for_fork_pr_workflows=false \
    -F send_write_tokens_to_workflows=false \
    -F send_secrets_and_variables=false
}

apply_workflow_permissions() {
  echo "→ Allow GITHUB_TOKEN read access and PR creation from workflows"
  run_gh api \
    --method PUT \
    "repos/${REPO_SLUG}/actions/permissions/workflow" \
    -f default_workflow_permissions=read \
    -F can_approve_pull_request_reviews=true
}

remove_legacy_branch_protection
apply_ruleset
apply_workflow_approval_policy
apply_private_fork_workflow_policy
apply_workflow_permissions

cat <<EOF

Done.

main now requires:
  - a pull request (direct pushes blocked for non-bypass actors)
  - GitHub Actions checks: verify, semantic-pull-request

Notes:
  - Required check names must match workflow job ids (not the UI label with workflow prefix).
  - Repository Admins can still bypass (Release uses GH_ADMIN_PAT for chore(release) commits).
  - That same Admin bypass means your local git push to main can still succeed — use feature branches by habit.
  - Legacy branch protection was removed to avoid duplicate "Expected" checks.
  - GitHub may still require one manual "Approve and run" when a PR changes .github/workflows/.

Verify in GitHub: Settings → Rules → Rulesets → Protect main.
EOF
