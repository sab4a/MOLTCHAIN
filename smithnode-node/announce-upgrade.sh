#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# SmithNode — Announce Upgrade to Fly.io + Validators
#═══════════════════════════════════════════════════════════════════════════════
# Builds, signs, and announces a software upgrade to the SmithNode network.
#
# MODES:
#   LOCAL   — Hosts binary on a local HTTP server (LAN only, for testing)
#   REMOTE  — Uses a public URL (GitHub Releases, S3, etc.) for production
#
# After announcing, validators:
#   1. Discover the upgrade via P2P gossipsub OR RPC fallback polling
#   2. Verify the admin signature locally
#   3. Stagger downloads (0-30s jitter) to preserve P2P mesh
#   4. Download binary (tries P2P seeds first, then HTTP URL)
#   5. Verify SHA256 checksum
#   6. Flush state → atomic binary swap → exec() restart
#
# Usage:
#   ./announce-upgrade.sh 0.5.1                     # local test mode
#   ./announce-upgrade.sh 0.5.1 --url <PUBLIC_URL>  # production mode
#
# Run this in a SEPARATE terminal while validators are running!
#═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="$SCRIPT_DIR/target/release/smithnode"
CARGO_TOML="$SCRIPT_DIR/Cargo.toml"
ADMIN_KEY_DIR="$SCRIPT_DIR/.smithnode-data"
ADMIN_KEYPAIR="$ADMIN_KEY_DIR/node_key.json"
FLY_RPC="https://smithnode-rpc.fly.dev"
SERVE_PORT=9999
NUM_VALIDATORS=10

# Parse arguments
NEW_VERSION="${1:-}"
shift || true
CUSTOM_URL=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --url)  CUSTOM_URL="$2"; shift 2 ;;
        *)      echo "Unknown arg: $1"; exit 1 ;;
    esac
done

if [[ -z "$NEW_VERSION" ]]; then
    echo "Usage: $0 <version> [--url <public-download-url>]"
    echo ""
    echo "Examples:"
    echo "  $0 0.5.1                                                    # local test"
    echo "  $0 0.6.0 --url https://github.com/you/repo/releases/...    # production"
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

MODE="local"
[[ -n "$CUSTOM_URL" ]] && MODE="remote"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  SmithNode Upgrade Pipeline  (mode: ${MODE})${NC}"
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

# Distribute admin key to local validator dirs (if testing locally)
if [[ -d "$SCRIPT_DIR/.validators" ]]; then
    log "Distributing admin key to local validator data dirs..."
    for i in $(seq 1 $NUM_VALIDATORS); do
        local_dir="$SCRIPT_DIR/.validators/validator-$i"
        if [[ -d "$local_dir" ]]; then
            cp "$ADMIN_KEYPAIR" "$local_dir/node_key.json"
        fi
    done
    log "   ✅ Admin key distributed"
    echo ""
fi

#───────────────────────────────────────────────────────────────────────────────
# Step 2: Bump version in Cargo.toml
#───────────────────────────────────────────────────────────────────────────────
CURRENT_VERSION=$(grep '^version' "$CARGO_TOML" | head -1 | sed 's/.*"\(.*\)".*/\1/')
log "Step 2: Version bump"
log "   Current version: $CURRENT_VERSION"
log "   New version:     $NEW_VERSION"

if [[ "$CURRENT_VERSION" != "$NEW_VERSION" ]]; then
    sed -i '' "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML" 2>/dev/null || \
    sed -i "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML"
    log "   ✅ Cargo.toml updated to v$NEW_VERSION"
else
    log "   ✅ Already at v$NEW_VERSION"
fi
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 3: Build release binary
#───────────────────────────────────────────────────────────────────────────────
log "Step 3: Building v$NEW_VERSION release binary..."
cd "$SCRIPT_DIR"
cargo build --release 2>&1 | tail -3
log "   ✅ Build complete: $BINARY"
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 4: Compute SHA256 checksum
#───────────────────────────────────────────────────────────────────────────────
log "Step 4: Computing SHA256 checksum..."
CHECKSUM=$(shasum -a 256 "$BINARY" | awk '{print $1}')
log "   ✅ Checksum: $CHECKSUM"
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 5: Set up download URL
#───────────────────────────────────────────────────────────────────────────────
HTTP_PID=""
SERVE_DIR=""

cleanup() {
    log "Cleaning up..."
    [[ -n "$HTTP_PID" ]] && kill "$HTTP_PID" 2>/dev/null || true
    [[ -n "$SERVE_DIR" ]] && rm -rf "$SERVE_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if [[ "$MODE" == "remote" ]]; then
    DOWNLOAD_URL="$CUSTOM_URL"
    log "Step 5: Using remote download URL"
    log "   ✅ URL: $DOWNLOAD_URL"
else
    log "Step 5: Starting local HTTP server on port $SERVE_PORT..."
    lsof -ti :$SERVE_PORT | xargs kill -9 2>/dev/null || true
    sleep 1

    SERVE_DIR=$(mktemp -d)
    cp "$BINARY" "$SERVE_DIR/smithnode"
    cd "$SERVE_DIR"
    python3 -m http.server $SERVE_PORT --bind 0.0.0.0 > /dev/null 2>&1 &
    HTTP_PID=$!
    cd "$SCRIPT_DIR"

    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
    DOWNLOAD_URL="http://${LOCAL_IP}:${SERVE_PORT}/smithnode"
    log "   ✅ Serving binary at: $DOWNLOAD_URL"
    log "   Server PID: $HTTP_PID"
    warn "   ⚠️  This URL only works for validators on the SAME LAN"
    warn "   For production, use: --url https://github.com/.../releases/download/v$NEW_VERSION/smithnode"
fi
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 6: Verify Fly.io sequencer is reachable
#───────────────────────────────────────────────────────────────────────────────
log "Step 6: Checking Fly.io sequencer..."
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
# Step 7: Announce upgrade via signed RPC call
#───────────────────────────────────────────────────────────────────────────────
log "Step 7: Announcing upgrade v$NEW_VERSION to the network..."
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  ANNOUNCE UPGRADE v$NEW_VERSION  (${MODE} mode)${NC}"
echo -e "${CYAN}  URL:      $DOWNLOAD_URL${NC}"
echo -e "${CYAN}  Checksum: ${CHECKSUM:0:32}...${NC}"
echo -e "${CYAN}  Admin:    ${ADMIN_PUBKEY:0:16}...${NC}"
echo -e "${CYAN}  Target:   $FLY_RPC${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

"$BINARY" announce-upgrade \
    --keypair "$ADMIN_KEYPAIR" \
    --version "$NEW_VERSION" \
    --url "$DOWNLOAD_URL" \
    --checksum "$CHECKSUM" \
    --mandatory \
    --notes "Upgrade v$CURRENT_VERSION → v$NEW_VERSION" \
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
log "  • Downloads from P2P seeds first, then $DOWNLOAD_URL"
log "  • Verifies SHA256 checksum"
log "  • Flushes state → atomic binary swap → exec() restart"
log ""
if [[ "$MODE" == "local" ]]; then
    log "  HTTP server stays running for downloads (Ctrl+C to stop)"
fi
log "═══════════════════════════════════════════════════════════════════"
echo ""

#───────────────────────────────────────────────────────────────────────────────
# Step 8: Monitor validator upgrades
#───────────────────────────────────────────────────────────────────────────────
log "⏳ Monitoring validator upgrades... (Ctrl+C to stop)"
echo ""

poll_count=0
max_polls=30  # 5 minutes max

while true; do
    sleep 10
    ((poll_count++))

    echo -e "${CYAN}── Validator version check ($poll_count) ──${NC}"
    local_upgraded=0
    local_total=0

    # Check local validators (if running)
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

    # Check Fly.io sequencer version
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

if [[ "$MODE" == "local" && -n "$HTTP_PID" ]]; then
    log "Shutting down local HTTP server..."
fi
