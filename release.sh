#!/bin/bash
# =============================================================================
# Release Script — Build, tag, publish to npm, create GitHub release
# =============================================================================
# Usage:
#   ./release.sh <new-version>    — full release from local machine
#   ./release.sh                  — CI mode (derives version from git tag)
# =============================================================================

set -euo pipefail
trap 'echo -e "\n\033[0;31m  ✗ Release failed at line $LINENO (exit code $?)\033[0m"' ERR

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "\n${CYAN}=== [$1/$TOTAL_STEPS] $2 ===${NC}"; }
info() { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ! $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; exit 1; }

# SKIP_LINT=1 escape hatch -- wraps `npm`/`pnpm` so lint-related runs are
# no-ops. Workaround for the MINGW64-ARM64 npm-run-script wrapper that
# segfaults on exit-cleanup (platform-windows.md). Apply only when the
# lint runner is broken on the host; CI catches lint regressions anyway.
if [ "${SKIP_LINT:-}" = "1" ]; then
  npm() {
    if [ "$1" = "run" ] && [[ "$2" == lint* ]]; then
      warn "SKIP_LINT=1 -- noop 'npm run $2'"
      return 0
    fi
    command npm "$@"
  }
  pnpm() {
    if [ "$1" = "run" ] && [[ "$2" == lint* ]]; then
      warn "SKIP_LINT=1 -- noop 'pnpm run $2'"
      return 0
    fi
    command pnpm "$@"
  }
fi

TOTAL_STEPS=7
PKG="@yawlabs/lemonsqueezy-webhook-sink"

VERSION="${1:-}"
IS_CI="${CI:-false}"

if [ -z "$VERSION" ]; then
  if [ "$IS_CI" = "true" ] && [ -n "${GITHUB_REF_NAME:-}" ]; then
    VERSION="${GITHUB_REF_NAME#v}"
    info "CI mode — version $VERSION from tag $GITHUB_REF_NAME"
  else
    echo "Usage: ./release.sh <version>"
    echo "  e.g. ./release.sh 0.1.0"
    exit 1
  fi
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "Invalid version format: $VERSION (expected X.Y.Z)"
fi

echo -e "${CYAN}Pre-flight checks...${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

command -v node >/dev/null || fail "node not installed"
command -v npm >/dev/null  || fail "npm not installed"

CURRENT_VERSION=$(node -p "require('./package.json').version")
RESUMING=false

if [ "$CURRENT_VERSION" = "$VERSION" ]; then
  RESUMING=true
  info "Already at v${VERSION} — resuming"
else
  if [ "$IS_CI" != "true" ]; then
    if [ -n "$(git status --porcelain)" ]; then
      fail "Working directory not clean. Commit or stash changes first."
    fi
  fi
  info "Current: v${CURRENT_VERSION} → v${VERSION}"
fi

if [ "$IS_CI" != "true" ] && [ "$RESUMING" != "true" ]; then
  echo ""
  echo -e "${YELLOW}About to release v${VERSION}.${NC}"
  if [ -t 0 ]; then
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  else
    info "Non-interactive shell -- proceeding without confirmation"
  fi
fi

step 1 "Lint"
npm run lint || fail "Lint failed"
info "Lint passed"

step 2 "Test"
npm run build || fail "Build failed"
npm test || fail "Tests failed"
info "All tests passed"

step 3 "Bump version to $VERSION"
if [ "$CURRENT_VERSION" = "$VERSION" ]; then
  info "Already at v${VERSION} — skipping"
else
  npm version "$VERSION" --no-git-tag-version
  info "Version bumped"
fi

step 4 "Commit, tag, and push"
if [ "$IS_CI" = "true" ]; then
  info "CI mode — skipping commit/tag/push (already tagged)"
else
  if [ -n "$(git status --porcelain package.json package-lock.json 2>/dev/null)" ]; then
    git add package.json package-lock.json
    git commit -m "v${VERSION}"
    info "Committed version bump"
  else
    info "Nothing to commit"
  fi

  if git tag -l "v${VERSION}" | grep -q "v${VERSION}"; then
    info "Tag v${VERSION} already exists"
  else
    # Annotated tag (not lightweight) so `git push --follow-tags` will propagate it.
    git tag -a "v${VERSION}" -m "v${VERSION}"
    info "Tag v${VERSION} created"
  fi

  # Tag-drift safety: refuse to push if origin already has a tag at this name
  # pointing to a different commit (rewound tag elsewhere, parallel release race).
  # Without this check, `git push --follow-tags` SILENTLY skips updating the
  # tag on origin (the tag exists, no fast-forward happens). The main push
  # reports success, but origin's tag stays at the old SHA -- and the later
  # `gh release create` step then creates a GitHub release linked to that
  # stale commit while npm carries the new one.
  ORIGIN_TAG_SHA=$(git ls-remote --tags origin "refs/tags/v${VERSION}" 2>/dev/null | awk '{print $1}')
  if [ -n "$ORIGIN_TAG_SHA" ]; then
    LOCAL_TAG_SHA=$(git rev-parse "v${VERSION}^{}")
    if [ "$ORIGIN_TAG_SHA" != "$LOCAL_TAG_SHA" ]; then
      fail "Tag v${VERSION} exists on origin at $ORIGIN_TAG_SHA but local tag points to $LOCAL_TAG_SHA -- resolve the drift before re-running"
    fi
  fi

  git push origin main --follow-tags
  info "Pushed to origin"
fi

step 5 "Publish to npm"
# Three publish paths, picked by environment:
#   1. IS_CI=true                    -> WE are CI. Do the publish (NODE_AUTH_TOKEN
#                                       is set; --provenance for sigstore).
#   2. IS_CI=false + release.yml     -> CI will publish on the tag we just pushed.
#      exists with CI publish path      Watch `gh run watch` for that run and
#                                       verify via `npm view`. Workstation MUST
#                                       NOT also publish -- stale ~/.npmrc fails
#                                       E404, valid one races CI for the same
#                                       version. CI is authoritative.
#   3. IS_CI=false + no CI publish   -> Workstation IS the publisher. Try locally
#      path                             with EOTP retry for fresh WebAuthn sessions.
PUBLISHED_VERSION=$(npm view "${PKG}@${VERSION}" version 2>/dev/null || echo "")
if [ "$PUBLISHED_VERSION" = "$VERSION" ]; then
  info "v${VERSION} already published on npm — skipping"
  # Resume-path safety: a prior interrupted run may have published but never
  # observed `gh run watch` to completion. Later CI steps (smoke test, MCP
  # Registry publish, attestation upload) could have failed silently. Look
  # up the most recent Release run for this tag and warn if its conclusion
  # was non-success. Best-effort -- if the tag isn't on origin yet or the
  # run isn't visible, the warn just doesn't fire.
  if [ "$IS_CI" != "true" ] && [ -f ".github/workflows/release.yml" ]; then
    RESUME_TAG_SHA=$(git rev-parse "v${VERSION}^{}" 2>/dev/null || echo "")
    if [ -n "$RESUME_TAG_SHA" ]; then
      RESUME_CONCLUSION=$(gh run list --workflow=Release --event=push --commit="$RESUME_TAG_SHA" --limit=1 --json conclusion --jq '.[0].conclusion' 2>/dev/null || echo "")
      if [ -n "$RESUME_CONCLUSION" ] && [ "$RESUME_CONCLUSION" != "success" ]; then
        warn "Prior CI Release run for v${VERSION} ended with conclusion='$RESUME_CONCLUSION' (not 'success'). A post-publish step (smoke test, MCP Registry publish, attestation) may have failed silently. Inspect: gh run list --workflow=Release --commit=$RESUME_TAG_SHA --limit=3"
      fi
    fi
  fi
elif [ "$IS_CI" = "true" ]; then
  npm publish --access public --provenance
  info "Published ${PKG}@${VERSION} to npm (with provenance)"
elif [ -f ".github/workflows/release.yml" ] && grep -q "npm publish\|NODE_AUTH_TOKEN" .github/workflows/release.yml; then
  info "CI release.yml fires on v* tag push -- workstation hands off to CI"
  # Verify the tag landed on origin BEFORE looking up the CI run. A local
  # push that succeeded but the remote rejected (protected-tag rule, network
  # blip) would otherwise dead-end in the lookup loop with a misleading
  # "Push may have failed" error 62s later. ls-remote is one round-trip --
  # cheap relative to gh run watch.
  if ! git ls-remote --tags origin "refs/tags/v${VERSION}" 2>/dev/null | grep -q "refs/tags/v${VERSION}$"; then
    fail "Tag v${VERSION} not visible on origin. Step 4's 'git push --follow-tags' may have failed silently (protected-tag rule, network blip), or the tag was deleted between push and now. Re-run step 4."
  fi
  TAG_SHA=$(git rev-parse "v${VERSION}^{}")
  RUN_ID=""
  # Exponential backoff: 2+4+8+16+32 = 62s upper bound on GitHub's
  # tag-push -> actions queue visibility lag. Cheap relative to the CI run
  # itself (~6 min on aws-mcp).
  DELAY=2
  for i in 1 2 3 4 5; do
    RUN_ID=$(gh run list --workflow=Release --event=push --commit="$TAG_SHA" --limit=1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || echo "")
    [ -n "$RUN_ID" ] && break
    sleep $DELAY
    DELAY=$((DELAY * 2))
  done
  if [ -z "$RUN_ID" ]; then
    fail "Could not find Release workflow run for tag v${VERSION} (commit $TAG_SHA) after 62s of polling. The actions queue may be backed up; check 'gh run list --limit 5' and rerun the script to retry."
  fi
  info "Watching CI Release run $RUN_ID"
  gh run watch "$RUN_ID" --exit-status || fail "CI Release run $RUN_ID failed. See 'gh run view $RUN_ID --log-failed'."
  # CI is authoritative on the publish itself -- if `gh run watch` exited 0,
  # the package is live on npm regardless of how long the registry mirror
  # takes to surface it. Verification here is a courtesy check; warn rather
  # than fail when the mirror lags (existing memory: lag can exceed a minute).
  NPM_NOW=""
  for i in 1 2 3 4 5 6 7 8 9 10; do
    NPM_NOW=$(npm view "${PKG}@${VERSION}" version 2>/dev/null || echo "")
    [ "$NPM_NOW" = "$VERSION" ] && break
    sleep 6
  done
  if [ "$NPM_NOW" = "$VERSION" ]; then
    info "Published ${PKG}@${VERSION} via CI Release run $RUN_ID"
  else
    DISPLAY_NPM="${NPM_NOW:-(not found)}"
    warn "CI Release run $RUN_ID succeeded but npm registry still shows '$DISPLAY_NPM' for ${PKG}@${VERSION} after 60s. Likely registry propagation lag -- verify with 'npm view ${PKG}@${VERSION}' in a minute. Publish is authoritative on CI's exit code."
  fi
else
  # Workstation IS the publisher (no CI fallback). Retry only on EOTP/EAUTH/OTP
  # for fresh WebAuthn sessions; fail fast on everything else.
  ATTEMPT=1
  MAX_ATTEMPTS=3
  while true; do
    PUBLISH_LOG=$(mktemp)
    if npm publish --access public 2>&1 | tee "$PUBLISH_LOG"; then
      rm -f "$PUBLISH_LOG"
      break
    fi
    if ! grep -qE 'EOTP|EAUTH|one-time password|OTP' "$PUBLISH_LOG"; then
      rm -f "$PUBLISH_LOG"
      fail "npm publish failed (non-OTP error -- see output above). If E401/E404, your ~/.npmrc session is stale: run 'npm login --auth-type=web' and retry."
    fi
    rm -f "$PUBLISH_LOG"
    if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
      fail "npm publish failed after $MAX_ATTEMPTS OTP-class attempts. WebAuthn session may not be propagating."
    fi
    warn "npm publish attempt $ATTEMPT EOTPed -- waiting 30s for WebAuthn session to propagate"
    ATTEMPT=$((ATTEMPT + 1))
    sleep 30
  done
  info "Published ${PKG}@${VERSION} to npm (workstation)"
fi

step 6 "Create GitHub release"
if gh release view "v${VERSION}" >/dev/null 2>&1; then
  info "GitHub release v${VERSION} already exists — skipping"
else
  PREV_TAG=$(git tag --sort=-v:refname | grep -A1 "^v${VERSION}$" | tail -1)
  if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "v${VERSION}" ]; then
    CHANGELOG=$(git log --oneline "${PREV_TAG}..v${VERSION}" --no-decorate | sed 's/^[a-f0-9]* /- /')
  else
    CHANGELOG="Initial release"
  fi

  gh release create "v${VERSION}" \
    --title "v${VERSION}" \
    --notes "$CHANGELOG"
  info "GitHub release created"
fi

step 7 "Verify"
sleep 3

NPM_VERSION=$(npm view "$PKG" version 2>/dev/null || echo "")
if [ "$NPM_VERSION" = "$VERSION" ]; then
  info "npm: ${PKG}@${NPM_VERSION}"
else
  warn "npm shows ${NPM_VERSION:-nothing} (expected $VERSION — may still be propagating)"
fi

echo ""
echo -e "${GREEN}  v${VERSION} released successfully!${NC}"
echo ""
echo -e "  npm: https://www.npmjs.com/package/${PKG}"
echo -e "  git: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v${VERSION}"
echo ""
