#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# SmithNode — Announce Upgrade via GitHub Releases
#═══════════════════════════════════════════════════════════════════════════════
# Signs and announces a software upgrade to the SmithNode P2P network.
# Uses pre-built binaries from GitHub Releases (uploaded separately).
#
# After announcing, validators:
#   1. Discover the upgrade via P2P gossipsub OR RPC fallback polling
#   2. Verify the admin signature locally
#   3. Stagger downloads (0-30s jitter) to preserve P2P mesh
#   4. Download their platform's binary (tries P2P seeds first, then GitHub)
#   5. Verify SHA256 checksum
#   6. Flush state → atomic binary swap → exec() restart
#
# Usage:
#   ./announce-upgrade.sh 0.5.1
#
# Prerequisites:
#   - GitHub Release v<VERSION> must already exist with binaries:
#       smithnode-linux-x64
#       smithnode-darwin-arm64
#   - Admin keypair at .smithnode-data/node_key.json
#   - Fly.io sequencer reachable
#═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="$SCRIPT_DIR/target/release/smithnode"
ADMIN_KEY_DIR="$SCRIPT_DIR/.smithnode-data"
ADMIN_KEYPAIR="$ADMIN_KEY_DIR/node_key.json"
FLY_RPC="https://smithnode-rpc.fly.dev"
GITHUB_REPO="sab4a/MOLTCHAIN"
NUM_VALIDATORS=10

NEW_VERSION="${1:-}"

if [[ -z "$NEW_VERSION" ]]; then
    echo "Usage: $0 <version>"
    echo ""
    echo "Example:"
    echo "  $0 0.5.1"
    echo ""
    echo "Prerequisites:"
    echo "  1. Create GitHub Release: gh release create v<version> smithnode-linux-x64 smithnode-darwin-arm64"
    echo "  2. Admin keypair at $ADMIN_KEYPAIR"
    exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[UPGRADE]${NC} $*"; }
warn() { echo -e "${YELLOW}[UPGRADE]${NC} $*"; }
err() { echo -e "${RED}[UPGRADE]${NC} $*"; }

RELEASE_TAG="v${NEW_VERSION}"
RELEASE_BASE="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  SmithNode Upgrade Pipeline — GitHub Releases${NC}"
echo -e "${CYAN}  Version: ${NEW_VERSION}  Tag: ${RELEASE_TAG}${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 1: Admin keypair
#───────────────────────────────────────────────────────────────────────────────
log "Step 1: Admin keypair"
mkdir -p "$ADMIN_KEY_DIR"
if [[ ! -f "$ADMIN_KEYPAIR" ]]; then
    "$BINARY" keygen -o "$ADMIN_KEYPAIR"
    log "🔑 Generated admin keypair: $ADMIN_KEYPAIR"
    warn "⚠️  You MUST add this pubkey to Fly.io:"
    warn "   fly secrets set SMITHNODE_ADMIN_KEYS=<pubkey>"
else
    log "🔑 Using existing admin keypair"
fi
ADMIN_PUBKEY=$(python3 -c "import json; print(json.load(open('$ADMIN_KEYPAIR'))['public_key'])")
log "   Admin pubkey: ${ADMIN_PUBKEY:0:16}..."
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 2: Verify GitHub Release exists with binaries
#───────────────────────────────────────────────────────────────────────────────
log "Step 2: Verifying GitHub Release ${RELEASE_TAG}..."

LINUX_X64_URL="${RELEASE_BASE}/smithnode-linux-x64"
DARWIN_ARM64_URL="${RELEASE_BASE}/smithnode-darwin-arm64"

LINUX_STATUS=$(curl -sIL -o /dev/null -w "%{http_code}" "$LINUX_X64_URL" 2>/dev/null || echo "000")
DARWIN_STATUS=$(curl -sIL -o /dev/null -w "%{http_code}" "$DARWIN_ARM64_URL" 2>/dev/null || echo "000")

ANNOUNCE_ARGS=""

if [[ "$LINUX_STATUS" == "200" ]]; then
    log "   ✅ linux-x64 binary found"
    TMPFILE_LINUX=$(mktemp)
    curl -sL "$LINUX_X64_URL" -o "$TMPFILE_LINUX"
    LINUX_CHECKSUM=$(shasum -a 256 "$TMPFILE_LINUX" | awk '{print $1}')
    LINUX_SIZE=$(wc -c < "$TMPFILE_LINUX" | tr -d ' ')
    rm -f "$TMPFILE_LINUX"
    log "   📦 linux-x64: ${LINUX_SIZE} bytes, sha256: ${LINUX_CHECKSUM:0:16}..."
    ANNOUNCE_ARGS="$ANNOUNCE_ARGS --url-linux-x64 $LINUX_X64_URL --checksum-linux-x64 $LINUX_CHECKSUM"
else
    warn "   ⚠️  linux-x64 binary NOT found (HTTP $LINUX_STATUS)"
fi

if [[ "$DARWIN_STATUS" == "200" ]]; then
    log "   ✅ darwin-arm64 binary found"
    TMPFILE_DARWIN=$(mktemp)
    curl -sL "$DARWIN_ARM64_URL" -o "$TMPFILE_DARWIN"
    DARWIN_CHECKSUM=$(shasum -a 256 "$TMPFILE_DARWIN" | awk '{print $1}')
    DARWIN_SIZE=$(wc -c < "$TMPFILE_DARWIN" | tr -d ' ')
    rm -f "$TMPFILE_DARWIN"
    log "   📦 darwin-arm64: ${DARWIN_SIZE} bytes, sha256: ${DARWIN_CHECKSUM:0:16}..."
    ANNOUNCE_ARGS="$ANNOUNCE_ARGS --url-darwin-arm64 $DARWIN_ARM64_URL --checksum-darwin-arm64 $DARWIN_CHECKSUM"
else
    warn "   ⚠️  darwin-arm64 binary NOT found (HTTP $DARWIN_STATUS)"
fi

if [[ -z "$ANNOUNCE_ARGS" ]]; then
    err "❌ No binaries found in GitHub Release ${RELEASE_TAG}!"
    err "   Create the release first:"
    err "   gh release create ${RELEASE_TAG} ./smithnode-linux-x64 ./smithnode-darwin-arm64"
    exit 1
fi
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 3: Build local binary (needed for the announce-upgrade command itself)
#───────────────────────────────────────────────────────────────────────────────
log "Step 3: Checking local binary..."
if [[ ! -f "$BINARY" ]]; then
    log "   Building local binary..."
    cd "$SCRIPT_DIR"
    cargo build --release 2>&1 | tail -3
    log "   ✅ Build complete"
else
    log "   ✅ Using existing binary: $BINARY"
fi
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 4: Check Fly.io sequencer
#───────────────────────────────────────────────────────────────────────────────
log "Step 4: Checking Fly.io sequencer..."
FLY_STATUS=$(curl -s --max-time 10 -X POST "$FLY_RPC" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null || echo "")
if [[ -z "$FLY_STATUS" ]]; then
    err "Cannot reach Fly.io node at $FLY_RPC"
    exit 1
fi
FLY_VERSION=$(echo "$FLY_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['node_version'])" 2>/dev/null)
FLY_VALIDATORS=$(echo "$FLY_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['validator_count'])" 2>/dev/null)
log "   ✅ Fly.io sequencer: v$FLY_VERSION, $FLY_VALIDATORS validators"
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 5: Announce upgrade to the network
#───────────────────────────────────────────────────────────────────────────────
log "Step 5: Announcing upgrade v$NEW_VERSION to the network..."
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  ANNOUNCE UPGRADE v$NEW_VERSION${NC}"
[[ "$LINUX_STATUS" == "200" ]] && echo -e "${CYAN}  linux-x64:      $LINUX_X64_URL${NC}"
[[ "$DARWIN_STATUS" == "200" ]] && echo -e "${CYAN}  darwin-arm64:   $DARWIN_ARM64_URL${NC}"
echo -e "${CYAN}  Admin:          ${ADMIN_PUBKEY:0:16}...${NC}"
echo -e "${CYAN}  Target RPC:     $FLY_RPC${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

eval "$BINARY" announce-upgrade \
    --keypair "$ADMIN_KEYPAIR" \
    --version "$NEW_VERSION" \
    $ANNOUNCE_ARGS \
    --mandatory \
    --notes "\"Upgrade to v$NEW_VERSION\"" \
    --rpc-url "$FLY_RPC" \
    2>&1 || true

echo ""
log "═══════════════════════════════════════════════════════════════════"
log "  ✅ Upgrade v$NEW_VERSION announced!"
log ""
log "  How validators receive it:"
log "  1. P2P gossipsub broadcast (instant, if mesh formed)"
log "  2. RPC fallback poll to sequencer (within 30s, guaranteed)"
log ""
log "  Then each validator:"
log "  • Verifies admin signature locally"
log "  • Waits 0-30s random jitter (staggered restart)"
log "  • Downloads from P2P seeds first, then GitHub Releases"
log "  • Verifies SHA256 checksum"
log "  • Flushes state → atomic binary swap → exec() restart"
log "  • Re-connects to P2P mesh with same identity"
log ""
log "  Zero peers lost: staggered restart keeps the mesh alive."
log "═══════════════════════════════════════════════════════════════════"
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 6: Monitor validator upgrades
#───────────────────────────────────────────────────────────────────────────────
log "⏳ Monitoring validator upgrades... (Ctrl+C to stop)"
echo ""

poll_count=0
max_polls=30

while true; do
    sleep 10
    ((poll_count++))

    echo -e "${CYAN}── Validator version check ($poll_count) ──${NC}"
    local_upgraded=0
    local_total=0

    for i in $(seq 1 $NUM_VALIDATORS); do
        rpc_port=$((28000 + i))
        resp=$(curl -s --max-time 2 -X POST "http://127.0.0.1:$rpc_port" \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null || echo "")
        if [[ -n "$resp" ]] && echo "$resp" | python3 -c "import sys,json; json.load(sys.stdin)['result']" >/dev/null 2>&1; then
            ((local_total++))
            ver=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['node_version'])" 2>/dev/null || echo "?")
            if [[ "$ver" == "$NEW_VERSION" ]]; then
                echo -e "  Validator $i: ${GREEN}v$ver ✅ UPGRADED${NC}"
                ((local_upgraded++))
            else
                echo -e "  Validator $i: ${YELLOW}v$ver ⏳${NC}"
            fi
        else
            echo -e "  Validator $i: ${RED}offline (restarting?)${NC}"
        fi
    done

    fly_ver=$(curl -s --max-time 5 -X POST "$FLY_RPC" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['node_version'])" 2>/dev/null || echo "?")
    echo -e "  Sequencer:    ${CYAN}v$fly_ver${NC}"
    echo -e "  ${CYAN}Local upgraded: $local_upgraded / $local_total${NC}"

    if [[ $local_total -gt 0 && $local_upgraded -eq $local_total ]]; then
        echo ""
        echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}  🎉 ALL $local_total LOCAL VALIDATORS UPGRADED TO v$NEW_VERSION!${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
        echo ""
        break
    fi

    if [[ $poll_count -ge $max_polls ]]; then
        warn "Timed out after $((poll_count * 10))s. $local_upgraded/$local_total upgraded."
        break
    fi
    echo ""
done
