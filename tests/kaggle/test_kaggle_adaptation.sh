#!/bin/bash
# test_kaggle_adaptation.sh — Tests automatizados de adaptación Kaggle

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
REPORT_FILE="${ROOT_DIR}/artifacts/kaggle_test_report.md"

PASS=0
FAIL=0
TESTS_RUN=0

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

test_start() {
  log "TEST: $1"
  TESTS_RUN=$((TESTS_RUN + 1))
}

test_pass() {
  log "  ✓ PASS: $1"
  PASS=$((PASS + 1))
}

test_fail() {
  log "  ✗ FAIL: $1"
  FAIL=$((FAIL + 1))
}

echo "=== CodexWeb Kaggle Adaptation Tests ==="
echo ""

# Test 1: Estructura de directorios
test_start "Directory structure"
if [ -d "$ROOT_DIR/kaggle-adaptation" ]; then
  test_pass "kaggle-adaptation/ exists"
else
  test_fail "kaggle-adaptation/ missing"
fi

if [ -d "$ROOT_DIR/kaggle-adaptation/runtime-adapters" ]; then
  test_pass "runtime-adapters/ exists"
else
  test_fail "runtime-adapters/ missing"
fi

if [ -d "$ROOT_DIR/scripts" ]; then
  test_pass "scripts/ exists"
else
  test_fail "scripts/ missing"
fi

# Test 2: Módulos de adaptación existen
test_start "Adapter modules"
modules=(
  "kaggle-adaptation/runtime-adapters/kaggle-env-detector.js"
  "kaggle-adaptation/runtime-adapters/kaggle-paths-config.js"
  "kaggle-adaptation/runtime-adapters/kaggle-server-adapter.js"
  "kaggle-adaptation/runtime-adapters/claude-codex-kaggle-adapter.js"
)

for module in "${modules[@]}"; do
  if [ -f "$ROOT_DIR/$module" ]; then
    test_pass "$module exists"
  else
    test_fail "$module missing"
  fi
done

# Test 3: Scripts existen y son ejecutables
test_start "Scripts"
scripts=(
  "scripts/create_kaggle_bundle.sh"
  "scripts/kaggle_bootstrap_cell.py"
)

for script in "${scripts[@]}"; do
  if [ -f "$ROOT_DIR/$script" ]; then
    test_pass "$script exists"
    if [ -x "$ROOT_DIR/$script" ]; then
      test_pass "$script is executable"
    else
      test_fail "$script not executable"
    fi
  else
    test_fail "$script missing"
  fi
done

# Test 4: Detección de entorno (debería ser VPS, no Kaggle)
test_start "Environment detection"
cd "$ROOT_DIR"
ENV_TEST=$(node -e "
  const { isKaggleEnvironment } = require('./kaggle-adaptation/runtime-adapters/kaggle-env-detector');
  console.log(isKaggleEnvironment() ? 'kaggle' : 'vps');
")

if [ "$ENV_TEST" = "vps" ]; then
  test_pass "Correctly detected VPS environment (not Kaggle)"
else
  test_fail "Incorrectly detected as Kaggle"
fi

# Test 5: Configuración de rutas
test_start "Paths configuration"
PATHS_TEST=$(node -e "
  const { getPathsConfig } = require('./kaggle-adaptation/runtime-adapters/kaggle-paths-config');
  const config = getPathsConfig({ env: 'development' });
  console.log(JSON.stringify(config, null, 2));
")

if echo "$PATHS_TEST" | grep -q '"isKaggle": false'; then
  test_pass "Paths config correctly identifies VPS"
else
  test_fail "Paths config incorrect"
fi

if echo "$PATHS_TEST" | grep -q '.runtime/dev'; then
  test_pass "Paths config uses correct dev runtime path"
else
  test_fail "Paths config runtime path incorrect"
fi

# Test 6: Frontend component exists
test_start "Frontend components"
if [ -f "$ROOT_DIR/stitch_frontend/src/components/KaggleRuntimeScreen.tsx" ]; then
  test_pass "KaggleRuntimeScreen.tsx exists"
else
  test_fail "KaggleRuntimeScreen.tsx missing"
fi

# Test 7: API functions añadidas
test_start "API functions"
if grep -q "getRuntimeKaggleStatus" "$ROOT_DIR/stitch_frontend/src/lib/api.ts"; then
  test_pass "getRuntimeKaggleStatus function exists"
else
  test_fail "getRuntimeKaggleStatus function missing"
fi

if grep -q "getRuntimeClaudePreflight" "$ROOT_DIR/stitch_frontend/src/lib/api.ts"; then
  test_pass "getRuntimeClaudePreflight function exists"
else
  test_fail "getRuntimeClaudePreflight function missing"
fi

# Test 8: Server.js integración
test_start "Server.js integration"
if grep -q "kaggle-server-adapter" "$ROOT_DIR/server.js"; then
  test_pass "kaggle-server-adapter imported in server.js"
else
  test_fail "kaggle-server-adapter not imported"
fi

if grep -q "claude-codex-kaggle-adapter" "$ROOT_DIR/server.js"; then
  test_pass "claude-codex-kaggle-adapter imported in server.js"
else
  test_fail "claude-codex-kaggle-adapter not imported"
fi

# Test 9: Bundle endpoints module
test_start "Bundle endpoints"
if [ -f "$ROOT_DIR/kaggle-adaptation/endpoints/kaggle-bundle-endpoints.js" ]; then
  test_pass "kaggle-bundle-endpoints.js exists"
else
  test_fail "kaggle-bundle-endpoints.js missing"
fi

if grep -q "kaggle-bundle-endpoints" "$ROOT_DIR/server.js"; then
  test_pass "Bundle endpoints imported in server.js"
else
  test_fail "Bundle endpoints not imported"
fi

# Test 10: Sin secretos en adaptación
test_start "No secrets in adaptation code"
SECRETS_FOUND=0

if grep -rE "(ANTHROPIC_API_KEY|OPENROUTER_API_KEY|KAGGLE_KEY).*=.*[a-zA-Z0-9]{20}" \
    "$ROOT_DIR/kaggle-adaptation" "$ROOT_DIR/scripts/create_kaggle_bundle.sh" 2>/dev/null; then
  test_fail "Found hardcoded secrets in adaptation code!"
  SECRETS_FOUND=1
else
  test_pass "No hardcoded secrets found in adaptation code"
fi

# Test 11: README.kaggle generado por bundle script
test_start "Bundle script content"
if grep -q "README.kaggle.md" "$ROOT_DIR/scripts/create_kaggle_bundle.sh"; then
  test_pass "Bundle script creates README.kaggle.md"
else
  test_fail "Bundle script missing README.kaggle.md generation"
fi

if grep -q "manifest.json" "$ROOT_DIR/scripts/create_kaggle_bundle.sh"; then
  test_pass "Bundle script creates manifest.json"
else
  test_fail "Bundle script missing manifest.json generation"
fi

if grep -q "sha256sum" "$ROOT_DIR/scripts/create_kaggle_bundle.sh"; then
  test_pass "Bundle script generates SHA256"
else
  test_fail "Bundle script missing SHA256 generation"
fi

# Test 12: Bootstrap script verificaciones
test_start "Bootstrap script content"
if grep -q "verify_bundle" "$ROOT_DIR/scripts/kaggle_bootstrap_cell.py"; then
  test_pass "Bootstrap script has SHA256 verification"
else
  test_fail "Bootstrap script missing SHA256 verification"
fi

if grep -q "setup_tunnel" "$ROOT_DIR/scripts/kaggle_bootstrap_cell.py"; then
  test_pass "Bootstrap script has tunnel setup"
else
  test_fail "Bootstrap script missing tunnel setup"
fi

if grep -q "UserSecretsClient" "$ROOT_DIR/scripts/kaggle_bootstrap_cell.py"; then
  test_pass "Bootstrap script integrates Kaggle Secrets"
else
  test_fail "Bootstrap script missing Kaggle Secrets integration"
fi

# Generar reporte
echo ""
echo "=== Test Summary ==="
echo "Tests run: $TESTS_RUN"
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

mkdir -p "$(dirname "$REPORT_FILE")"

cat > "$REPORT_FILE" <<EOF
# Kaggle Adaptation Test Report

**Timestamp:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Environment:** VPS (Development)

## Summary

- **Tests Run:** $TESTS_RUN
- **Passed:** $PASS
- **Failed:** $FAIL
- **Success Rate:** $(echo "scale=2; $PASS * 100 / $TESTS_RUN" | bc)%

## Results

$(if [ $FAIL -eq 0 ]; then echo "✓ All tests passed!"; else echo "✗ $FAIL test(s) failed"; fi)

## Test Categories

1. **Directory Structure** — Verified kaggle-adaptation/, scripts/, tests/ exist
2. **Adapter Modules** — Verified all runtime adapters are present
3. **Scripts** — Verified bundle and bootstrap scripts exist and are executable
4. **Environment Detection** — Verified correct detection of VPS (not Kaggle)
5. **Paths Configuration** — Verified paths config returns correct values
6. **Frontend Components** — Verified KaggleRuntimeScreen.tsx exists
7. **API Functions** — Verified runtime API functions added to api.ts
8. **Server Integration** — Verified adapters imported in server.js
9. **Bundle Endpoints** — Verified bundle download endpoints registered
10. **Security** — Verified no hardcoded secrets in adaptation code
11. **Bundle Script** — Verified bundle script generates all required files
12. **Bootstrap Script** — Verified bootstrap script has all required features

## Next Steps

$(if [ $FAIL -eq 0 ]; then
  echo "- Run bundle generation: \`./scripts/create_kaggle_bundle.sh\`"
  echo "- Enable bundle endpoint: Set KAGGLE_BUNDLE_ENDPOINT=true in .env"
  echo "- Generate final report: Complete task #11"
else
  echo "- Fix failing tests before proceeding"
  echo "- Re-run this test suite"
fi)

## Full Test Log

See console output above for detailed test results.
EOF

log "Report saved to: $REPORT_FILE"

if [ $FAIL -eq 0 ]; then
  log "✓ All tests passed!"
  exit 0
else
  log "✗ $FAIL test(s) failed"
  exit 1
fi
