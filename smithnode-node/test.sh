#!/bin/bash
set -e

# ============================================================
# SmithNode Local Testnet — 1 main node + 2 validators
# ============================================================

BINARY="$(pwd)/target/release/smithnode"
TD="/tmp/smithnode-test"
WAIT_BLOCKS=90  # seconds to watch for blocks

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

cleanup() {
    echo -e "\n${YELLOW}🛑 Cleaning up...${NC}"
    pkill -f "smithnode" 2>/dev/null || true
    sleep 1
    echo -e "${GREEN}Done.${NC}"
}
trap cleanup EXIT

# ── Pre-flight ──────────────────────────────────────────────
if [ ! -f "$BINARY" ]; then
    echo -e "${RED}Binary not found at $BINARY${NC}"
    echo "Run: cargo build --release"
    exit 1
fi

echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "${BOLD}  SmithNode Local Testnet${NC}"
echo -e "${BOLD}════════════════════════════════════════${NC}"

# ── Clean previous state ────────────────────────────────────
pkill -f "smithnode" 2>/dev/null || true
sleep 1
rm -rf "$TD/node" "$TD/v1" "$TD/v2"
rm -rf "$HOME/.smithnode"
mkdir -p "$TD"

# ── Generate validator keys if missing ──────────────────────
if [ ! -f "$TD/validator1.json" ]; then
    echo -e "${CYAN}🔑 Generating validator 1 keypair...${NC}"
    $BINARY keygen --output "$TD/validator1.json"
fi
if [ ! -f "$TD/validator2.json" ]; then
    echo -e "${CYAN}🔑 Generating validator 2 keypair...${NC}"
    $BINARY keygen --output "$TD/validator2.json"
fi

V1_PUB=$(python3 -c "import json; print(json.load(open('$TD/validator1.json'))['public_key'])")
V2_PUB=$(python3 -c "import json; print(json.load(open('$TD/validator2.json'))['public_key'])")
echo -e "V1 pubkey: ${CYAN}${V1_PUB:0:16}...${NC}"
echo -e "V2 pubkey: ${CYAN}${V2_PUB:0:16}...${NC}"

# ── Start main node ────────────────────────────────────────
echo -e "\n${GREEN}🚀 Starting main node...${NC}"
$BINARY start \
    --data-dir "$TD/node" \
    --rpc-bind "127.0.0.1:26658" \
    --p2p-bind "0.0.0.0:26656" \
    > "$TD/node.log" 2>&1 &
NODE_PID=$!
echo "   PID: $NODE_PID"

# Wait for RPC to be ready
for i in $(seq 1 10); do
    if curl -s http://127.0.0.1:26658 -X POST \
        -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' \
        > /dev/null 2>&1; then
        echo -e "   ${GREEN}RPC ready after ${i}s${NC}"
        break
    fi
    sleep 1
done

# Get peer ID for bootstrap
PEER_ID=$(grep -o '12D3KooW[a-zA-Z0-9]*' "$TD/node.log" | head -1)
BOOT="/ip4/127.0.0.1/tcp/26656/p2p/$PEER_ID"
echo "   Boot: $BOOT"

# ── Start validators ───────────────────────────────────────
echo -e "\n${GREEN}🤖 Starting Validator 1...${NC}"
$BINARY validator \
    --data-dir "$TD/v1" \
    --keypair "$TD/validator1.json" \
    --p2p-bind "0.0.0.0:26666" \
    --peer "$BOOT" \
    --rpc-bind "127.0.0.1:26668" \
    > "$TD/v1.log" 2>&1 &
V1_PID=$!
echo "   PID: $V1_PID"

echo -e "${GREEN}🤖 Starting Validator 2...${NC}"
$BINARY validator \
    --data-dir "$TD/v2" \
    --keypair "$TD/validator2.json" \
    --p2p-bind "0.0.0.0:26676" \
    --peer "$BOOT" \
    > "$TD/v2.log" 2>&1 &
V2_PID=$!
echo "   PID: $V2_PID"

# ── Wait for P2P registration to propagate ──────────────────
echo -e "\n${YELLOW}⏳ Waiting for P2P registration (up to 25s)...${NC}"
for i in $(seq 1 25); do
    VCOUNT=$(curl -s http://127.0.0.1:26658 -X POST \
        -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('validator_count',0))" 2>/dev/null || echo "0")
    if [ "$VCOUNT" -ge 2 ] 2>/dev/null; then
        echo -e "   ${GREEN}✅ $VCOUNT validators registered after ${i}s${NC}"
        break
    fi
    if [ "$i" -eq 25 ]; then
        echo -e "   ${RED}⚠️  Only $VCOUNT validators after 25s${NC}"
        echo -e "   ${YELLOW}Check logs: tail -f $TD/v1.log${NC}"
    fi
    sleep 1
done

# ── Show initial status ────────────────────────────────────
echo -e "\n${BOLD}📊 Node Status:${NC}"
curl -s http://127.0.0.1:26658 -X POST \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' \
    | python3 -m json.tool 2>/dev/null

echo -e "\n${BOLD}════════════════════════════════════════${NC}"
echo -e "${BOLD}  Watching for blocks (${WAIT_BLOCKS}s)${NC}"
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "  Logs: tail -f $TD/node.log"
echo -e "  Stop: Ctrl+C"
echo ""

# ── Watch for block production ──────────────────────────────
START_TIME=$(date +%s)
LAST_HEIGHT=0

while true; do
    ELAPSED=$(( $(date +%s) - START_TIME ))
    if [ "$ELAPSED" -ge "$WAIT_BLOCKS" ]; then
        break
    fi

    # Poll current height
    HEIGHT=$(curl -s http://127.0.0.1:26658 -X POST \
        -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('height',0))" 2>/dev/null || echo "0")

    if [ "$HEIGHT" != "$LAST_HEIGHT" ] 2>/dev/null; then
        FINALIZED=$(grep "FINALIZED" "$TD/node.log" | tail -1 | sed 's/.*INFO //' 2>/dev/null || echo "")
        echo -e "  ${GREEN}📦 Block $HEIGHT${NC}  (${ELAPSED}s)  $FINALIZED"
        LAST_HEIGHT=$HEIGHT
    fi

    sleep 2
done

# ── Final report ────────────────────────────────────────────
echo -e "\n${BOLD}════════════════════════════════════════${NC}"
echo -e "${BOLD}  TEST RESULTS${NC}"
echo -e "${BOLD}════════════════════════════════════════${NC}"

FINAL_STATUS=$(curl -s http://127.0.0.1:26658 -X POST \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null \
    | python3 -m json.tool 2>/dev/null)
echo -e "\n${CYAN}Final Status:${NC}"
echo "$FINAL_STATUS"

BLOCK_COUNT=$(grep -c "FINALIZED" "$TD/node.log" 2>/dev/null || true)
BLOCK_COUNT=${BLOCK_COUNT:-0}
echo -e "\n${CYAN}Blocks finalized:${NC} $BLOCK_COUNT"

SLASH_NODE=$(grep -ci "slash" "$TD/node.log" 2>/dev/null || true)
SLASH_NODE=${SLASH_NODE:-0}
SLASH_V1=$(grep -ci "slash" "$TD/v1.log" 2>/dev/null || true)
SLASH_V1=${SLASH_V1:-0}
SLASH_V2=$(grep -ci "slash" "$TD/v2.log" 2>/dev/null || true)
SLASH_V2=${SLASH_V2:-0}
echo -e "\n${CYAN}Slashing events:${NC}"
echo "  node.log: $SLASH_NODE"
echo "  v1.log:   $SLASH_V1"
echo "  v2.log:   $SLASH_V2"
if [ "${SLASH_NODE}" -eq 0 ] && [ "${SLASH_V1}" -eq 0 ] && [ "${SLASH_V2}" -eq 0 ]; then
    echo -e "  ${GREEN}✅ ZERO slashing — PASS${NC}"
else
    echo -e "  ${RED}❌ Slashing detected — FAIL${NC}"
fi

GRACEFUL=$(grep -c "already finalized" "$TD/node.log" 2>/dev/null || true)
GRACEFUL=${GRACEFUL:-0}
echo -e "\n${CYAN}Late proofs (gracefully rejected):${NC} $GRACEFUL"

MISMATCH_NODE=$(grep -ci "mismatch" "$TD/node.log" 2>/dev/null || true)
MISMATCH_NODE=${MISMATCH_NODE:-0}
MISMATCH_V1=$(grep -ci "mismatch" "$TD/v1.log" 2>/dev/null || true)
MISMATCH_V1=${MISMATCH_V1:-0}
MISMATCH_V2=$(grep -ci "mismatch" "$TD/v2.log" 2>/dev/null || true)
MISMATCH_V2=${MISMATCH_V2:-0}
MISMATCH_TOTAL=$(( ${MISMATCH_NODE} + ${MISMATCH_V1} + ${MISMATCH_V2} ))
echo -e "\n${CYAN}State root mismatches:${NC}"
if [ "${MISMATCH_TOTAL}" -eq 0 ]; then
    echo -e "  ${GREEN}✅ ZERO mismatches — PASS${NC}"
else
    echo -e "  ${RED}❌ $MISMATCH_TOTAL mismatches — FAIL${NC}"
fi

echo -e "\n${BOLD}════════════════════════════════════════${NC}"
echo -e "Logs: $TD/{node,v1,v2}.log"
echo -e "${BOLD}════════════════════════════════════════${NC}"
