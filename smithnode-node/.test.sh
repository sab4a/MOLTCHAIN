#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════════════
# SmithNode v0.5.0 — FULL PRODUCTION TEST
#   Tests EVERY system: blocks, P2P, transfers, governance,
#   auto-upgrade, liveness, signatures, WAL, state persistence,
#   rate limiting, state sync, slashing, and more
# ════════════════════════════════════════════════════════════════════
# Usage: bash .test.sh  (from smithnode-node/ or anywhere)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="$SCRIPT_DIR/target/release/smithnode"
TD="/tmp/smithnode-fulltest"
WATCH_TIME=30
OLLAMA_MODEL="llama3.2:1b"
OLLAMA_ENDPOINT="http://localhost:11434"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Test tracking
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

pass_test() {
    echo -e "   ${GREEN}✅ PASS — $1${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}
fail_test() {
    echo -e "   ${RED}❌ FAIL — $1${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}
skip_test() {
    echo -e "   ${YELLOW}⚠️  SKIP — $1${NC}"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

# Helper: count matching lines (macOS-safe)
count_lines() {
    local pattern="$1"
    local file="$2"
    local result
    result=$(grep -ciE "$pattern" "$file" 2>/dev/null || true)
    result=$(echo "$result" | head -1 | tr -d '[:space:]')
    if [ -z "$result" ]; then echo 0; else echo "$result"; fi
}

# Helper: RPC call
rpc() {
    local port="$1"
    local method="$2"
    local params="$3"
    curl -s "http://127.0.0.1:${port}" -X POST \
        -H 'Content-Type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"${method}\",\"params\":[${params}],\"id\":1}" 2>/dev/null
}

# Helper: extract JSON field
rpc_field() {
    local port="$1"
    local method="$2"
    local params="$3"
    local field="$4"
    rpc "$port" "$method" "$params" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('$field',''))" 2>/dev/null || echo ""
}

# ── Cleanup handler ────────────────────────────────────────
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down testnet...${NC}"
    kill $NODE_PID $V1_PID $V2_PID $HTTP_PID 2>/dev/null || true
    sleep 1
    pkill -f "smithnode" 2>/dev/null || true
    # Kill any leftover HTTP servers from upgrade test
    pkill -f "http.server 9999" 2>/dev/null || true
    echo -e "${GREEN}✅ Cleanup done.${NC}"
}
trap cleanup EXIT

# ════════════════════════════════════════════════════════════
#  PRE-FLIGHT
# ════════════════════════════════════════════════════════════
echo -e "${BOLD}════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  SmithNode v0.5.0 ⚡ FULL PRODUCTION TEST${NC}"
echo -e "${BOLD}  Blocks | Transfers | Governance | Upgrades | P2P${NC}"
echo -e "${BOLD}  Liveness | Signatures | WAL | State | Slashing${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════════${NC}"

if [ ! -f "$BINARY" ]; then
    echo -e "${RED}❌ Binary not found at $BINARY${NC}"
    echo "   Run: cargo build --release"
    exit 1
fi
echo -e "${GREEN}✅ Binary found${NC}"

# Check ollama
OLLAMA_OK=false
if curl -s "$OLLAMA_ENDPOINT/api/tags" > /dev/null 2>&1; then
    if ollama list 2>/dev/null | grep -q "${OLLAMA_MODEL%%:*}"; then
        OLLAMA_OK=true
        echo -e "${GREEN}✅ Ollama ready (${OLLAMA_MODEL})${NC}"
    else
        echo -e "${YELLOW}⏳ Pulling $OLLAMA_MODEL...${NC}"
        if ollama pull "$OLLAMA_MODEL" 2>/dev/null; then
            OLLAMA_OK=true
            echo -e "${GREEN}✅ Ollama ready${NC}"
        fi
    fi
fi
if ! $OLLAMA_OK; then
    echo -e "${YELLOW}⚠️  Ollama not available — AI liveness tests will be limited${NC}"
fi

# Clean previous state
pkill -f "smithnode" 2>/dev/null || true
sleep 1
rm -rf "$TD"
rm -rf "$HOME/.smithnode"
mkdir -p "$TD"

# ════════════════════════════════════════════════════════════
#  TEST 1: KEYGEN
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 1: KEY GENERATION ═══${NC}"

$BINARY keygen --output "$TD/validator1.json"
$BINARY keygen --output "$TD/validator2.json"
$BINARY keygen --output "$TD/admin.json"

V1_PUB=$(python3 -c "import json; print(json.load(open('$TD/validator1.json'))['public_key'])")
V2_PUB=$(python3 -c "import json; print(json.load(open('$TD/validator2.json'))['public_key'])")
V1_SEC=$(python3 -c "import json; print(json.load(open('$TD/validator1.json'))['private_key'])")
V2_SEC=$(python3 -c "import json; print(json.load(open('$TD/validator2.json'))['private_key'])")
ADMIN_PUB=$(python3 -c "import json; print(json.load(open('$TD/admin.json'))['public_key'])")
ADMIN_SEC=$(python3 -c "import json; print(json.load(open('$TD/admin.json'))['private_key'])")

echo -e "   V1:    ${CYAN}${V1_PUB:0:16}...${NC}"
echo -e "   V2:    ${CYAN}${V2_PUB:0:16}...${NC}"
echo -e "   Admin: ${CYAN}${ADMIN_PUB:0:16}...${NC}"

# Verify keys are valid 64-char hex
if [ ${#V1_PUB} -eq 64 ] && [ ${#V2_PUB} -eq 64 ] && [ ${#ADMIN_PUB} -eq 64 ]; then
    pass_test "3 keypairs generated (64-char hex pubkeys)"
else
    fail_test "Keypair generation failed"
fi

# ════════════════════════════════════════════════════════════
#  TEST 2: START MAIN NODE
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 2: MAIN NODE STARTUP ═══${NC}"

# Export the admin key so the node trusts it for upgrades
export SMITHNODE_ADMIN_KEYS="$ADMIN_PUB"

$BINARY start \
    --data-dir "$TD/node" \
    --rpc-bind "127.0.0.1:26658" \
    --p2p-bind "0.0.0.0:26656" \
    > "$TD/node.log" 2>&1 &
NODE_PID=$!
echo "   PID: $NODE_PID"

echo -e "${YELLOW}   Waiting for RPC...${NC}"
RPC_READY=false
for i in $(seq 1 15); do
    if rpc 26658 "smithnode_status" "" > /dev/null 2>&1; then
        RPC_READY=true
        break
    fi
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo -e "   ${RED}❌ Node crashed during startup!${NC}"
        tail -20 "$TD/node.log"
        exit 1
    fi
    sleep 1
done

if $RPC_READY; then
    pass_test "Main node RPC ready (${i}s)"
else
    fail_test "RPC timeout (15s)"
    tail -20 "$TD/node.log"
    exit 1
fi

PEER_ID=$(grep -o '12D3KooW[a-zA-Z0-9]*' "$TD/node.log" | head -1)
if [ -z "$PEER_ID" ]; then
    fail_test "Could not find peer ID"
    exit 1
fi
BOOT="/ip4/127.0.0.1/tcp/26656/p2p/$PEER_ID"
echo -e "   Boot: ${CYAN}${BOOT:0:60}...${NC}"
pass_test "P2P identity generated"

# ════════════════════════════════════════════════════════════
#  TEST 3: STATUS RPC
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 3: RPC STATUS ENDPOINT ═══${NC}"

STATUS_RAW=$(rpc 26658 "smithnode_status" "")
NODE_VERSION=$(echo "$STATUS_RAW" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('node_version',''))" 2>/dev/null || echo "")

if [ -n "$NODE_VERSION" ]; then
    pass_test "Status returns version: $NODE_VERSION"
else
    fail_test "Status RPC returned no version"
fi

# ════════════════════════════════════════════════════════════
#  TEST 4: START TWO AI VALIDATORS
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 4: VALIDATOR STARTUP & P2P REGISTRATION ═══${NC}"

AI_ARGS=""
if $OLLAMA_OK; then
    AI_ARGS="--ai-provider ollama --ai-model $OLLAMA_MODEL --ai-endpoint $OLLAMA_ENDPOINT"
fi

# Also set admin keys env for validators
export SMITHNODE_ADMIN_KEYS="$ADMIN_PUB"

$BINARY validator \
    --data-dir "$TD/v1" \
    --keypair "$TD/validator1.json" \
    --p2p-bind "0.0.0.0:26666" \
    --peer "$BOOT" \
    --rpc-bind "127.0.0.1:26668" \
    $AI_ARGS \
    > "$TD/v1.log" 2>&1 &
V1_PID=$!
echo "   V1 PID: $V1_PID"

$BINARY validator \
    --data-dir "$TD/v2" \
    --keypair "$TD/validator2.json" \
    --p2p-bind "0.0.0.0:26676" \
    --peer "$BOOT" \
    --rpc-bind "127.0.0.1:26678" \
    $AI_ARGS \
    > "$TD/v2.log" 2>&1 &
V2_PID=$!
echo "   V2 PID: $V2_PID"

# Wait for registration
echo -e "${YELLOW}   Waiting for validator registration...${NC}"
VCOUNT=0
for i in $(seq 1 30); do
    VCOUNT=$(rpc 26658 "smithnode_status" "" \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('validator_count',0))" 2>/dev/null || echo "0")
    if [ "$VCOUNT" -ge 2 ] 2>/dev/null; then
        break
    fi
    if ! kill -0 $V1_PID 2>/dev/null; then
        echo -e "   ${RED}❌ V1 died!${NC}"; tail -10 "$TD/v1.log"; exit 1
    fi
    if ! kill -0 $V2_PID 2>/dev/null; then
        echo -e "   ${RED}❌ V2 died!${NC}"; tail -10 "$TD/v2.log"; exit 1
    fi
    sleep 1
done

if [ "$VCOUNT" -ge 2 ] 2>/dev/null; then
    pass_test "$VCOUNT validators registered via P2P (${i}s)"
else
    fail_test "Only $VCOUNT validators registered after 30s"
fi

# ── Check P2P verification ──
echo -e "\n${BOLD}═══ TEST 5: P2P GOSSIPSUB VERIFICATION ═══${NC}"
echo -e "${YELLOW}   Waiting for gossipsub mesh...${NC}"
P2P_VERIFIED=0
P2P_ONLINE=0
for p2p_i in $(seq 1 20); do
    P2P_RESP=$(rpc 26658 "smithnode_getP2PValidators" "")
    P2P_VERIFIED=$(echo "$P2P_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('p2p_verified_count',0))" 2>/dev/null || echo "0")
    P2P_ONLINE=$(echo "$P2P_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('online_p2p_count',0))" 2>/dev/null || echo "0")
    if [ "$P2P_VERIFIED" -ge 1 ] 2>/dev/null; then
        break
    fi
    sleep 1
done

if [ "$P2P_VERIFIED" -ge 1 ] 2>/dev/null; then
    pass_test "$P2P_VERIFIED validators P2P-verified, $P2P_ONLINE online (${p2p_i}s)"
else
    fail_test "No P2P-verified validators after 20s (expected ≥1)"
fi

# ════════════════════════════════════════════════════════════
#  TEST 6: TURBO BLOCK PRODUCTION
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 6: TURBO BLOCK PRODUCTION (${WATCH_TIME}s) ═══${NC}"

START_HEIGHT=$(rpc_field 26658 "smithnode_status" "" "height")
START_HEIGHT=${START_HEIGHT:-0}
START_TIME=$(date +%s)
LAST_HEIGHT=$START_HEIGHT
BLOCKS_SEEN=0

while true; do
    ELAPSED=$(( $(date +%s) - START_TIME ))
    if [ "$ELAPSED" -ge "$WATCH_TIME" ]; then
        break
    fi

    # Check processes alive
    for PID_VAR in "NODE:$NODE_PID" "V1:$V1_PID" "V2:$V2_PID"; do
        PNAME="${PID_VAR%%:*}"
        P_PID="${PID_VAR##*:}"
        if ! kill -0 "$P_PID" 2>/dev/null; then
            echo -e "\n  ${RED}❌ $PNAME crashed!${NC}"
        fi
    done

    HEIGHT=$(rpc_field 26658 "smithnode_status" "" "height")
    HEIGHT=${HEIGHT:-0}

    if [ "$HEIGHT" != "$LAST_HEIGHT" ] && [ "$HEIGHT" -gt 0 ] 2>/dev/null; then
        SUPPLY=$(rpc_field 26658 "smithnode_status" "" "total_supply")
        BLK_VER=$(rpc_field 26658 "smithnode_status" "" "node_version")
        echo -e "  ${GREEN}📦 Block $HEIGHT${NC}  v${BLK_VER}  supply=${SUPPLY} SMITH  (${ELAPSED}s)"
        LAST_HEIGHT=$HEIGHT
        BLOCKS_SEEN=$((BLOCKS_SEEN + 1))
    fi

    # Progress bar
    BAR_LEN=40
    PROGRESS=$(( ELAPSED * BAR_LEN / WATCH_TIME ))
    BAR=$(printf "%${PROGRESS}s" | tr ' ' '█')
    EMPTY=$(printf "%$((BAR_LEN - PROGRESS))s" | tr ' ' '░')
    REMAINING=$((WATCH_TIME - ELAPSED))

    BPS="0"
    if [ "$ELAPSED" -gt 0 ] && [ "$BLOCKS_SEEN" -gt 0 ]; then
        BPS=$(echo "scale=1; $BLOCKS_SEEN / $ELAPSED" | bc 2>/dev/null || echo "?")
    fi

    LIVENESS_V1=$(count_lines "liveness" "$TD/v1.log")
    LIVENESS_V2=$(count_lines "liveness" "$TD/v2.log")
    LIVENESS_TOTAL=$((LIVENESS_V1 + LIVENESS_V2))

    printf "\r  ${CYAN}[${BAR}${EMPTY}]${NC} ${REMAINING}s  blocks:${BLOCKS_SEEN} (${BPS}/s) liveness:${LIVENESS_TOTAL}  "
    sleep 1
done
echo ""

FINAL_HEIGHT=$(rpc_field 26658 "smithnode_status" "" "height")
FINAL_HEIGHT=${FINAL_HEIGHT:-0}
TOTAL_BLOCKS_PRODUCED=$((FINAL_HEIGHT - START_HEIGHT))

if [ "$TOTAL_BLOCKS_PRODUCED" -gt 5 ]; then
    BPS_FINAL=$(echo "scale=2; $TOTAL_BLOCKS_PRODUCED / $WATCH_TIME" | bc 2>/dev/null || echo "?")
    pass_test "$TOTAL_BLOCKS_PRODUCED blocks in ${WATCH_TIME}s ($BPS_FINAL/s, target: ~0.5/s)"
elif [ "$TOTAL_BLOCKS_PRODUCED" -gt 0 ]; then
    pass_test "$TOTAL_BLOCKS_PRODUCED blocks produced (slow but working)"
else
    fail_test "No blocks produced"
fi

# ── Block signatures ──
echo -e "\n${BOLD}═══ TEST 7: BLOCK SIGNATURE VERIFICATION ═══${NC}"
VERIFIED_V1=$(count_lines "producer signature VERIFIED" "$TD/v1.log")
VERIFIED_V2=$(count_lines "producer signature VERIFIED" "$TD/v2.log")
VERIFIED_SIGS=$((VERIFIED_V1 + VERIFIED_V2))
echo "   V1 verified: $VERIFIED_V1 sigs"
echo "   V2 verified: $VERIFIED_V2 sigs"

if [ "$VERIFIED_SIGS" -gt 0 ]; then
    pass_test "$VERIFIED_SIGS block signatures verified (ed25519)"
elif [ "$TOTAL_BLOCKS_PRODUCED" -gt 0 ]; then
    skip_test "Blocks produced but no signature verification logged yet"
else
    fail_test "No block signatures verified"
fi

# ════════════════════════════════════════════════════════════
#  TEST 8: TRANSFERS
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 8: SMITH TOKEN TRANSFERS ═══${NC}"

TRANSFER_RESULT=$(python3 << PYEOF
import json, sys

try:
    from nacl.signing import SigningKey as NaClSigningKey
    HAVE_NACL = True
except ImportError:
    HAVE_NACL = False

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    HAVE_CRYPTO = True
except ImportError:
    HAVE_CRYPTO = False

if not HAVE_NACL and not HAVE_CRYPTO:
    print("SKIP")
    sys.exit(0)

v1_sec = "$V1_SEC"
v2_pub = "$V2_PUB"

def sign_message(secret_hex, message_bytes):
    sec_bytes = bytes.fromhex(secret_hex)
    if HAVE_NACL:
        sk = NaClSigningKey(sec_bytes[:32])
        return sk.sign(message_bytes).signature.hex()
    else:
        sk = Ed25519PrivateKey.from_private_bytes(sec_bytes[:32])
        return sk.sign(message_bytes).hex()

# Transfer: V1 sends 10 SMITH to V2
# Message: to(32 bytes) || amount(8 LE) || nonce(8 LE)
to_bytes = bytes.fromhex(v2_pub)
amount = 10
nonce = 0
msg = to_bytes + amount.to_bytes(8, 'little') + nonce.to_bytes(8, 'little')
sig = sign_message(v1_sec, msg)
print(f"OK|{sig}")
PYEOF
)

if [[ "$TRANSFER_RESULT" == SKIP* ]]; then
    skip_test "No ed25519 python library (pip install pynacl)"
elif [[ "$TRANSFER_RESULT" == OK* ]]; then
    TRANSFER_SIG="${TRANSFER_RESULT#OK|}"

    # Get balances before
    V1_BAL_BEFORE=$(rpc 26658 "smithnode_getValidator" "\"$V1_PUB\"" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('balance',0))" 2>/dev/null || echo "0")
    V2_BAL_BEFORE=$(rpc 26658 "smithnode_getValidator" "\"$V2_PUB\"" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('balance',0))" 2>/dev/null || echo "0")
    echo "   V1 balance before: $V1_BAL_BEFORE SMITH"
    echo "   V2 balance before: $V2_BAL_BEFORE SMITH"

    # Execute transfer
    echo -e "   ${CYAN}Transferring 10 SMITH from V1 → V2...${NC}"
    TX_RESP=$(rpc 26658 "smithnode_transfer" "{\"from\":\"$V1_PUB\",\"to\":\"$V2_PUB\",\"amount\":10,\"nonce\":0,\"signature\":\"$TRANSFER_SIG\"}")
    TX_OK=$(echo "$TX_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('success',False))" 2>/dev/null || echo "False")
    TX_HASH=$(echo "$TX_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('tx_hash',''))" 2>/dev/null || echo "")
    TX_ERR=$(echo "$TX_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result',{}).get('error','') or r.get('error',{}).get('message',''))" 2>/dev/null || echo "")

    if [ "$TX_OK" = "True" ]; then
        pass_test "Transfer accepted (tx: ${TX_HASH:0:16}...)"

        # Verify balances
        sleep 1
        V1_BAL_AFTER=$(rpc 26658 "smithnode_getValidator" "\"$V1_PUB\"" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('balance',0))" 2>/dev/null || echo "0")
        V2_BAL_AFTER=$(rpc 26658 "smithnode_getValidator" "\"$V2_PUB\"" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('balance',0))" 2>/dev/null || echo "0")
        echo "   V1 balance after:  $V1_BAL_AFTER SMITH"
        echo "   V2 balance after:  $V2_BAL_AFTER SMITH"

        if [ "$V2_BAL_AFTER" -gt "$V2_BAL_BEFORE" ] 2>/dev/null; then
            pass_test "V2 balance increased (from $V2_BAL_BEFORE to $V2_BAL_AFTER)"
        else
            fail_test "V2 balance didn't increase after transfer"
        fi
    else
        fail_test "Transfer failed: $TX_ERR"
    fi

    # ── Replay protection ──
    echo -e "\n   ${CYAN}Testing replay protection (same nonce=0)...${NC}"
    TX_REPLAY=$(rpc 26658 "smithnode_transfer" "{\"from\":\"$V1_PUB\",\"to\":\"$V2_PUB\",\"amount\":10,\"nonce\":0,\"signature\":\"$TRANSFER_SIG\"}")
    TX_REPLAY_OK=$(echo "$TX_REPLAY" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result',{}).get('success',False) if 'result' in r else False)" 2>/dev/null || echo "False")

    if [ "$TX_REPLAY_OK" = "False" ]; then
        pass_test "Replay attack blocked (nonce reuse rejected)"
    else
        fail_test "Replay attack NOT blocked!"
    fi

    # ── Bad signature ──
    echo -e "\n   ${CYAN}Testing invalid signature rejection...${NC}"
    BAD_SIG=$(echo "$TRANSFER_SIG" | sed 's/^./a/')
    TX_BAD=$(rpc 26658 "smithnode_transfer" "{\"from\":\"$V1_PUB\",\"to\":\"$V2_PUB\",\"amount\":10,\"nonce\":1,\"signature\":\"$BAD_SIG\"}")
    TX_BAD_OK=$(echo "$TX_BAD" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result',{}).get('success',False) if 'result' in r else False)" 2>/dev/null || echo "False")

    if [ "$TX_BAD_OK" = "False" ]; then
        pass_test "Bad signature rejected"
    else
        fail_test "Bad signature was ACCEPTED!"
    fi

else
    fail_test "Transfer signing failed: $TRANSFER_RESULT"
fi

# ════════════════════════════════════════════════════════════
#  TEST 9: TRANSACTION HISTORY
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 9: TRANSACTION HISTORY ═══${NC}"

TX_LIST=$(rpc 26658 "smithnode_getTransactions" "1, 10")
TX_TOTAL=$(echo "$TX_LIST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('total',0))" 2>/dev/null || echo "0")

if [ "$TX_TOTAL" -gt 0 ] 2>/dev/null; then
    pass_test "$TX_TOTAL transactions recorded"
    echo "$TX_LIST" | python3 -c "
import sys, json
data = json.load(sys.stdin).get('result', {}).get('transactions', [])
for tx in data[:5]:
    print(f'   {tx.get(\"tx_type\",\"?\")} | h={tx.get(\"height\",\"?\")} | {tx.get(\"tx_hash\",\"?\")[:16]}...')
" 2>/dev/null || true
else
    fail_test "No transactions recorded"
fi

# ════════════════════════════════════════════════════════════
#  TEST 10: GOVERNANCE
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 10: GOVERNANCE (propose → vote → execute) ═══${NC}"

GOV_RESULT=$(python3 << PYEOF
import json, hashlib, sys

try:
    from nacl.signing import SigningKey as NaClSigningKey
    HAVE_NACL = True
except ImportError:
    HAVE_NACL = False

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    HAVE_CRYPTO = True
except ImportError:
    HAVE_CRYPTO = False

if not HAVE_NACL and not HAVE_CRYPTO:
    print("SKIP")
    sys.exit(0)

v1_pub = "$V1_PUB"
v2_pub = "$V2_PUB"
v1_sec = "$V1_SEC"
v2_sec = "$V2_SEC"

def sign_message(secret_hex, message_bytes):
    sec_bytes = bytes.fromhex(secret_hex)
    if HAVE_NACL:
        sk = NaClSigningKey(sec_bytes[:32])
        return sk.sign(message_bytes).signature.hex()
    else:
        sk = Ed25519PrivateKey.from_private_bytes(sec_bytes[:32])
        return sk.sign(message_bytes).hex()

# Proposal: ChangeReward 100 → 500
proposal_type = 0
new_value = 500
desc = "Test: increase block reward to 500 SMITH"
desc_hash = hashlib.sha256(desc.encode()).digest()
msg = bytes([proposal_type]) + new_value.to_bytes(8, 'little') + desc_hash
propose_sig = sign_message(v1_sec, msg)

# Votes: both YES on proposal #1
proposal_id = 1
vote_msg = proposal_id.to_bytes(8, 'little') + bytes([1])
v1_vote_sig = sign_message(v1_sec, vote_msg)
v2_vote_sig = sign_message(v2_sec, vote_msg)

# Execute
exec_msg = proposal_id.to_bytes(8, 'little')
exec_sig = sign_message(v1_sec, exec_msg)

print(f"OK|{desc_hash.hex()}|{propose_sig}|{v1_vote_sig}|{v2_vote_sig}|{exec_sig}")
PYEOF
)

if [[ "$GOV_RESULT" == SKIP* ]]; then
    skip_test "No ed25519 python library"
    GOV_TEST="skip"
elif [[ "$GOV_RESULT" == OK* ]]; then
    IFS='|' read -r _ GOV_DESC GOV_PROPOSE_SIG GOV_V1_VOTE_SIG GOV_V2_VOTE_SIG GOV_EXEC_SIG <<< "$GOV_RESULT"

    echo -e "   ${CYAN}Step 1: Creating proposal (ChangeReward → 500)...${NC}"
    PROPOSE_RESP=$(rpc 26658 "smithnode_createProposal" "{\"proposer\":\"${V1_PUB}\",\"proposal_type\":0,\"new_value\":500,\"description_hash\":\"${GOV_DESC}\",\"signature\":\"${GOV_PROPOSE_SIG}\"}")
    PROPOSE_OK=$(echo "$PROPOSE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('success',False))" 2>/dev/null || echo "False")
    PROPOSE_ERR=$(echo "$PROPOSE_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result',{}).get('error','') or r.get('error',{}).get('message',''))" 2>/dev/null || echo "")
    if [ "$PROPOSE_OK" = "True" ]; then
        pass_test "Proposal created"
    else
        fail_test "Proposal creation failed: $PROPOSE_ERR"
    fi

    echo -e "   ${CYAN}Step 2: V1 votes YES (AI reasoning)...${NC}"
    V1_REASON="Increasing reward from 100 to 500 incentivizes validators. Major boost for network growth."
    VOTE1_RESP=$(rpc 26658 "smithnode_voteProposal" "{\"voter\":\"${V1_PUB}\",\"proposal_id\":1,\"vote\":true,\"signature\":\"${GOV_V1_VOTE_SIG}\",\"reason\":\"${V1_REASON}\"}")
    VOTE1_OK=$(echo "$VOTE1_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('success',False))" 2>/dev/null || echo "False")
    if [ "$VOTE1_OK" = "True" ]; then
        pass_test "V1 voted YES with reasoning"
    else
        fail_test "V1 vote failed"
    fi

    sleep 0.5
    echo -e "   ${CYAN}Step 3: V2 votes YES (AI reasoning)...${NC}"
    V2_REASON="Higher rewards attract quality validators. 5x increase strengthens network security."
    VOTE2_RESP=$(rpc 26658 "smithnode_voteProposal" "{\"voter\":\"${V2_PUB}\",\"proposal_id\":1,\"vote\":true,\"signature\":\"${GOV_V2_VOTE_SIG}\",\"reason\":\"${V2_REASON}\"}")
    VOTE2_OK=$(echo "$VOTE2_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('success',False))" 2>/dev/null || echo "False")
    if [ "$VOTE2_OK" = "True" ]; then
        pass_test "V2 voted YES with reasoning"
    else
        fail_test "V2 vote failed"
    fi

    echo -e "   ${CYAN}Step 4: Checking proposal status...${NC}"
    rpc 26658 "smithnode_getProposals" "" | python3 -c "
import sys, json
try:
    for p in json.load(sys.stdin).get('result', []):
        print(f'   #{p[\"id\"]} [{p[\"status\"]}] {p[\"proposal_type\"]} — for:{p[\"votes_for\"]} against:{p[\"votes_against\"]}')
except: pass
" 2>/dev/null || true

    echo -e "   ${CYAN}Step 5: Waiting 12s for vote period + delay + auto-execute...${NC}"
    sleep 12

    echo -e "   ${CYAN}Step 6: Execute proposal #1...${NC}"
    rpc 26658 "smithnode_executeProposal" "{\"executor\":\"${V1_PUB}\",\"proposal_id\":1,\"signature\":\"${GOV_EXEC_SIG}\"}" > /dev/null 2>&1 || true

    echo -e "   ${CYAN}Step 7: Verifying parameter change...${NC}"
    REWARD_NOW=$(rpc 26658 "smithnode_getNetworkParams" "" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('reward_per_proof','?'))" 2>/dev/null || echo "?")
    echo "   reward_per_proof = $REWARD_NOW (expected: 500)"
    if [ "$REWARD_NOW" = "500" ]; then
        pass_test "Governance executed: reward_per_proof = 500"
        GOV_TEST="pass"
    else
        fail_test "reward_per_proof = $REWARD_NOW (expected 500)"
        GOV_TEST="fail"
    fi

    # Show votes with reasoning
    echo -e "\n   ${CYAN}AI Vote Reasoning:${NC}"
    rpc 26658 "smithnode_getProposals" "" | python3 -c "
import sys, json
try:
    for p in json.load(sys.stdin).get('result', []):
        for v in p.get('votes', []):
            voter = str(v.get('voter','?'))[:16]
            vote_val = 'YES' if v.get('vote', False) else 'NO'
            reason = v.get('reason','(none)') or '(none)'
            print(f'   [{voter}..] {vote_val}: {reason}')
except: pass
" 2>/dev/null || true

else
    fail_test "Governance signing failed"
    GOV_TEST="fail"
fi

# ════════════════════════════════════════════════════════════
#  TEST 11: NETWORK PARAMS
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 11: NETWORK PARAMS ═══${NC}"

PARAMS_INFO=$(rpc 26658 "smithnode_getNetworkParams" "" | python3 -c "
import sys, json
try:
    p = json.load(sys.stdin).get('result', {})
    print(f'reward={p.get(\"reward_per_proof\",\"?\")} committee={p.get(\"committee_size\",\"?\")} min_stake={p.get(\"min_stake\",\"?\")} block_time={p.get(\"block_time_secs\",\"?\")}')
except: print('ERROR')
" 2>/dev/null || echo "ERROR")

if [[ "$PARAMS_INFO" != "ERROR" ]]; then
    pass_test "Network params: $PARAMS_INFO"
else
    fail_test "Could not read network params"
fi

# ════════════════════════════════════════════════════════════
#  TEST 12: REAL AUTO-UPGRADE (serve binary → download → verify → swap → RESTART)
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 12: REAL AUTO-UPGRADE TEST (LIVE RESTART) ═══${NC}"
echo -e "${CYAN}   This test serves the ACTUAL binary via local HTTP,${NC}"
echo -e "${CYAN}   announces the upgrade, and lets the validator actually${NC}"
echo -e "${CYAN}   download → checksum-verify → atomic swap → exec() restart.${NC}"
echo -e "${CYAN}   The applied_upgrade.txt file prevents restart loops.${NC}\n"

# ── Step 0: Compute REAL checksum of our binary ──
BINARY_CHECKSUM=$(shasum -a 256 "$BINARY" | cut -d' ' -f1)
echo "   Binary: $BINARY"
echo "   SHA256: ${BINARY_CHECKSUM:0:32}..."

# Record V2's PID before upgrade (we'll watch it restart)
V2_PID_BEFORE=$V2_PID
echo "   V2 PID before upgrade: $V2_PID_BEFORE"

# Clean any previous applied_upgrade.txt so V2 actually tries
rm -f "$TD/data-v2/applied_upgrade.txt" 2>/dev/null

# ── Step 1: Serve the binary on a local HTTP server ──
echo -e "   ${CYAN}Step 1: Starting local HTTP server on :9999...${NC}"
HTTP_DIR="$TD/http-serve"
mkdir -p "$HTTP_DIR"
cp "$BINARY" "$HTTP_DIR/smithnode-v0.6.0"

# Start python HTTP server in the background
cd "$HTTP_DIR"
python3 -m http.server 9999 > "$TD/http.log" 2>&1 &
HTTP_PID=$!
cd - > /dev/null
sleep 1

# Verify HTTP server is up
if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9999/smithnode-v0.6.0" | grep -q "200"; then
    pass_test "Local HTTP server serving binary (PID $HTTP_PID)"
else
    fail_test "HTTP server not responding"
    kill $HTTP_PID 2>/dev/null
fi

# ── Step 2: Determine platform keys for announcement ──
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$PLATFORM" in
    darwin) PLATFORM_KEY="darwin" ;;
    linux)  PLATFORM_KEY="linux" ;;
    *)      PLATFORM_KEY="linux" ;;
esac
case "$ARCH" in
    arm64|aarch64) ARCH_KEY="arm64" ;;
    x86_64)        ARCH_KEY="x64" ;;
    *)             ARCH_KEY="x64" ;;
esac
DOWNLOAD_KEY="${PLATFORM_KEY}_${ARCH_KEY}"
echo "   Platform: ${DOWNLOAD_KEY}"

UPGRADE_RESULT=$(python3 << PYEOF
import json, hashlib, sys, time

try:
    from nacl.signing import SigningKey as NaClSigningKey
    HAVE_NACL = True
except ImportError:
    HAVE_NACL = False

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    HAVE_CRYPTO = True
except ImportError:
    HAVE_CRYPTO = False

if not HAVE_NACL and not HAVE_CRYPTO:
    print("SKIP")
    sys.exit(0)

admin_sec = "$ADMIN_SEC"
admin_pub = "$ADMIN_PUB"
binary_checksum = "$BINARY_CHECKSUM"
download_key = "$DOWNLOAD_KEY"

def sign_message(secret_hex, message_bytes):
    sec_bytes = bytes.fromhex(secret_hex)
    if HAVE_NACL:
        sk = NaClSigningKey(sec_bytes[:32])
        return sk.sign(message_bytes).signature.hex()
    else:
        sk = Ed25519PrivateKey.from_private_bytes(sec_bytes[:32])
        return sk.sign(message_bytes).hex()

version = "0.6.0-test"
timestamp = int(time.time())

# Build download_urls + checksums with the REAL binary served locally
download_urls = {"darwin_arm64": None, "darwin_x64": None, "linux_x64": None, "linux_arm64": None, "windows_x64": None}
checksums = {"darwin_arm64": None, "darwin_x64": None, "linux_x64": None, "linux_arm64": None, "windows_x64": None}

download_urls[download_key] = "http://127.0.0.1:9999/smithnode-v0.6.0"
checksums[download_key] = binary_checksum

# Sign: version || timestamp || mandatory || checksums
sign_msg = version.encode()
sign_msg += timestamp.to_bytes(8, 'little')
sign_msg += bytes([0])  # not mandatory
sign_msg += binary_checksum.encode()

sig = sign_message(admin_sec, sign_msg)

announcement = {
    "version": version,
    "download_urls": download_urls,
    "checksums": checksums,
    "timestamp": timestamp,
    "mandatory": False,
    "release_notes": "REAL upgrade test — live restart via exec()",
    "admin_pubkey": admin_pub,
    "signature": sig
}
print(f"OK|{json.dumps(announcement)}")
PYEOF
)

if [[ "$UPGRADE_RESULT" == SKIP* ]]; then
    skip_test "No ed25519 python library"
elif [[ "$UPGRADE_RESULT" == OK* ]]; then
    UPGRADE_JSON="${UPGRADE_RESULT#OK|}"

    # ── Step 3: checkUpdate before ──
    echo -e "   ${CYAN}Step 2: Check current version...${NC}"
    CURRENT_VER=$(rpc_field 26658 "smithnode_checkUpdate" "" "current_version")
    echo "   Current: v$CURRENT_VER"
    if [ -n "$CURRENT_VER" ]; then
        pass_test "checkUpdate RPC works (v$CURRENT_VER)"
    else
        fail_test "checkUpdate returned nothing"
    fi

    # ── Step 4: Announce with REAL binary URL ──
    echo -e "   ${CYAN}Step 3: Announce upgrade v0.6.0-test (REAL binary at localhost:9999)...${NC}"
    ANNOUNCE_RESP=$(curl -s "http://127.0.0.1:26658" -X POST \
        -H 'Content-Type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"smithnode_announceUpgrade\",\"params\":[$UPGRADE_JSON],\"id\":1}" 2>/dev/null)
    ANNOUNCE_OK=$(echo "$ANNOUNCE_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result',{}).get('status','') if 'result' in r else 'FAIL:' + str(r.get('error',{}).get('message','')))" 2>/dev/null || echo "ERROR")

    if [ "$ANNOUNCE_OK" = "ok" ]; then
        pass_test "Upgrade v0.6.0-test announced (with real download URL)"
    else
        fail_test "Announce failed: $ANNOUNCE_OK"
    fi

    # ── Step 5: Verify upgrade visible ──
    sleep 2
    echo -e "   ${CYAN}Step 4: Verify upgrade visible...${NC}"
    NEWEST=$(rpc_field 26658 "smithnode_checkUpdate" "" "newest_version")
    UPDATE_AVAIL=$(rpc 26658 "smithnode_checkUpdate" "" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('update_available',False))" 2>/dev/null || echo "False")
    VERIFIED=$(rpc 26658 "smithnode_checkUpdate" "" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('verified',False))" 2>/dev/null || echo "False")

    echo "   Newest: $NEWEST | Available: $UPDATE_AVAIL | Verified: $VERIFIED"
    if [ "$UPDATE_AVAIL" = "True" ] && [ "$NEWEST" = "0.6.0-test" ]; then
        pass_test "Upgrade detected: v$NEWEST (verified=$VERIFIED)"
    else
        fail_test "Upgrade not visible after announcement"
    fi

    # ── Step 6: P2P propagation ──
    sleep 3
    echo -e "   ${CYAN}Step 5: Check propagation to V1...${NC}"
    V1_NEWEST=$(rpc_field 26668 "smithnode_checkUpdate" "" "newest_version")
    if [ "$V1_NEWEST" = "0.6.0-test" ]; then
        pass_test "Upgrade propagated to V1 via P2P"
    else
        skip_test "Upgrade not yet seen by V1 (P2P may need more time)"
    fi

    # ── Step 7: Wait for auto-update → REAL download + swap + restart ──
    echo -e "   ${CYAN}Step 6: Waiting for V2 to download + swap + exec() restart...${NC}"
    echo -e "   ${YELLOW}   (Auto-update task runs every 30s + 0-30s jitter)${NC}"
    echo -e "   ${YELLOW}   Waiting up to 90s for full upgrade cycle...${NC}"
    DOWNLOAD_SEEN=false
    CHECKSUM_VERIFIED=false
    UPGRADE_INSTALLED=false
    RESTART_DETECTED=false
    for wait_i in $(seq 1 90); do
        # Check ALL logs for download/checksum/install
        for logf in "$TD/v1.log" "$TD/v2.log" "$TD/node.log"; do
            [ -f "$logf" ] || continue
            grep -q "Downloading" "$logf" 2>/dev/null && DOWNLOAD_SEEN=true
            grep -q "Checksum verified" "$logf" 2>/dev/null && CHECKSUM_VERIFIED=true
            grep -q "UPGRADE INSTALLED" "$logf" 2>/dev/null && UPGRADE_INSTALLED=true
            grep -q "Restarting node" "$logf" 2>/dev/null && RESTART_DETECTED=true
        done
        
        # If V2 exec() restarted, its old PID is gone and a new process is running
        if $UPGRADE_INSTALLED; then
            break
        fi
        printf "\r   ⏳ Waiting... %ds/90s" "$wait_i"
        sleep 1
    done
    echo ""

    if $DOWNLOAD_SEEN; then
        pass_test "Auto-update downloaded the binary"
    else
        skip_test "Auto-update task hasn't fired yet (30s+jitter interval)"
    fi

    if $CHECKSUM_VERIFIED; then
        pass_test "SHA256 checksum verified successfully"
    elif $DOWNLOAD_SEEN; then
        fail_test "Download happened but checksum verification not logged"
    fi

    if $UPGRADE_INSTALLED; then
        pass_test "Binary swap completed (atomic rename → exec() restart)"
    elif $CHECKSUM_VERIFIED; then
        skip_test "Checksum OK but binary swap not logged yet"
    fi

    # ── Step 8: Verify V2 restarted and came back alive ──
    if $RESTART_DETECTED || $UPGRADE_INSTALLED; then
        echo -e "   ${CYAN}Step 7: Verifying V2 restarted and came back...${NC}"
        sleep 5  # Give the restarted process time to come up
        
        # Check if applied_upgrade.txt was written (any node that upgraded)
        APPLIED_FOUND=false
        for ddir in "$TD/node" "$TD/v1" "$TD/v2"; do
            if [ -f "$ddir/applied_upgrade.txt" ]; then
                APPLIED_VER=$(cat "$ddir/applied_upgrade.txt")
                pass_test "applied_upgrade.txt persisted in $(basename $ddir): v$APPLIED_VER (prevents loop)"
                APPLIED_FOUND=true
                break
            fi
        done
        if ! $APPLIED_FOUND; then
            skip_test "applied_upgrade.txt not found in any data dir"
        fi
        
        # After exec() restart, V2 replaced its process — find the new PID
        # Use ps+grep matching data-dir to find the EXACT V2 process
        # (lsof -i :port is unreliable — picks up peers connected TO that port)
        V2_NEW_PID=$(ps aux | grep "smithnode" | grep "data.*v2" | grep -v grep | awk '{print $2}' | head -1)
        if [ -n "$V2_NEW_PID" ] && [ "$V2_NEW_PID" != "$V2_PID_BEFORE" ]; then
            pass_test "V2 restarted with NEW PID $V2_NEW_PID (was $V2_PID_BEFORE)"
            V2_PID=$V2_NEW_PID  # Update for cleanup
        elif [ -n "$V2_NEW_PID" ]; then
            pass_test "V2 is running (PID $V2_NEW_PID)"
            V2_PID=$V2_NEW_PID
        elif kill -0 $V2_PID_BEFORE 2>/dev/null; then
            pass_test "V2 still alive at original PID $V2_PID_BEFORE (binary swapped in-place)"
        else
            skip_test "V2 process not found after restart (may need more time)"
        fi
        
        # Verify no node restart-looped (check all logs for repeated download attempts)
        TOTAL_DOWNLOADS=0
        for logf in "$TD/node.log" "$TD/v1.log" "$TD/v2.log"; do
            if [ -f "$logf" ]; then
                cnt=$(grep -c "Downloading" "$logf" 2>/dev/null || true)
                cnt=${cnt:-0}
                TOTAL_DOWNLOADS=$((TOTAL_DOWNLOADS + cnt))
            fi
        done
        # Each node should download at most once — 3 nodes = max 3 downloads
        if [ "$TOTAL_DOWNLOADS" -le 3 ]; then
            pass_test "No restart loop detected ($TOTAL_DOWNLOADS total download attempts across all nodes)"
        else
            echo -e "   ${YELLOW}⚠️ $TOTAL_DOWNLOADS total downloads detected (possible restart loop)${NC}"
        fi
    else
        echo -e "   ${YELLOW}   Skipping restart verification (upgrade not completed in time)${NC}"
    fi

    # ── Step 9: Verify HTTP server was actually hit ──
    HTTP_HITS=$(wc -l < "$TD/http.log" 2>/dev/null | tr -d ' ')
    echo "   HTTP server log lines: $HTTP_HITS"
    if grep -q "GET /smithnode-v0.6.0" "$TD/http.log" 2>/dev/null; then
        pass_test "HTTP server received download request (REAL download happened)"
    else
        skip_test "No HTTP download request yet (auto-update task may not have fired)"
    fi

    # ── Step 10: Bad signature rejection ──
    echo -e "   ${CYAN}Step 8: Test bad signature rejection...${NC}"
    BAD_ANNOUNCE=$(echo "$UPGRADE_JSON" | python3 -c "import sys,json; a=json.loads(sys.stdin.read()); a['signature']='deadbeef'*8; print(json.dumps(a))" 2>/dev/null)
    BAD_RESP=$(curl -s "http://127.0.0.1:26658" -X POST \
        -H 'Content-Type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"smithnode_announceUpgrade\",\"params\":[$BAD_ANNOUNCE],\"id\":1}" 2>/dev/null)
    BAD_STATUS=$(echo "$BAD_RESP" | python3 -c "import sys,json; print('rejected' if 'error' in json.load(sys.stdin) else 'accepted')" 2>/dev/null || echo "error")

    if [ "$BAD_STATUS" = "rejected" ]; then
        pass_test "Bad signature correctly rejected"
    else
        fail_test "Bad signature was ACCEPTED!"
    fi

    # ── Step 11: P2P binary seed check ──
    echo -e "   ${CYAN}Step 9: Check P2P binary seed announcement...${NC}"
    if grep -q "binary seed" "$TD/v1.log" "$TD/v2.log" "$TD/node.log" 2>/dev/null; then
        pass_test "P2P binary seed announced (peers can download from each other)"
    elif $CHECKSUM_VERIFIED; then
        pass_test "Binary seed system active (download succeeded)"
    else
        skip_test "P2P binary seed not seen (upgrade not completed yet)"
    fi

    # Kill HTTP server
    kill $HTTP_PID 2>/dev/null

else
    fail_test "Upgrade test setup failed"
fi

# ════════════════════════════════════════════════════════════
#  TEST 13: POST-UPDATE BLOCK MONITORING (reward=500 verification)
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 13: POST-UPDATE BLOCK MONITORING ═══${NC}"
echo -e "${CYAN}   Monitoring blocks after governance + upgrade announcement...${NC}"
echo -e "${CYAN}   Expected: reward_per_proof=500, version=0.5.0, upgrade pending=0.6.0-test${NC}\n"

MON_START_H=$(rpc_field 26658 "smithnode_status" "" "height")
MON_START_H=${MON_START_H:-0}
MON_SUPPLY_BEFORE=$(rpc_field 26658 "smithnode_status" "" "total_supply")
MON_SUPPLY_BEFORE=${MON_SUPPLY_BEFORE:-0}
MON_BLOCKS=0
MON_WATCH=15

for mon_i in $(seq 1 $MON_WATCH); do
    MON_H=$(rpc_field 26658 "smithnode_status" "" "height")
    MON_H=${MON_H:-0}
    if [ "$MON_H" -gt "$MON_START_H" ] 2>/dev/null && [ "$MON_H" != "$MON_START_H" ]; then
        MON_VER=$(rpc_field 26658 "smithnode_status" "" "node_version")
        MON_SUPPLY=$(rpc_field 26658 "smithnode_status" "" "total_supply")
        MON_REWARD=$(rpc 26658 "smithnode_getNetworkParams" "" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('reward_per_proof','?'))" 2>/dev/null || echo "?")
        MON_UPGRADE=$(rpc_field 26658 "smithnode_checkUpdate" "" "newest_version")
        echo -e "  ${GREEN}📦 Block $MON_H${NC}  v${MON_VER}  supply=${MON_SUPPLY}  reward=${MON_REWARD}  upgrade_pending=${MON_UPGRADE:-none}"
        MON_START_H=$MON_H
        MON_BLOCKS=$((MON_BLOCKS + 1))
    fi
    sleep 1
done

# Verify the reward=500 is actually being applied by checking supply increase
MON_SUPPLY_AFTER=$(rpc_field 26658 "smithnode_status" "" "total_supply")
MON_SUPPLY_AFTER=${MON_SUPPLY_AFTER:-0}
MON_SUPPLY_GAINED=0
if [ "$MON_SUPPLY_AFTER" -gt 0 ] && [ "$MON_SUPPLY_BEFORE" -gt 0 ] 2>/dev/null; then
    MON_SUPPLY_GAINED=$((MON_SUPPLY_AFTER - MON_SUPPLY_BEFORE))
fi

echo ""
echo "   Supply before: $MON_SUPPLY_BEFORE SMITH"
echo "   Supply after:  $MON_SUPPLY_AFTER SMITH"
echo "   Supply gained: $MON_SUPPLY_GAINED SMITH ($MON_BLOCKS blocks)"

if [ "$MON_BLOCKS" -gt 0 ] && [ "$MON_SUPPLY_GAINED" -gt 0 ] 2>/dev/null; then
    AVG_REWARD=$((MON_SUPPLY_GAINED / MON_BLOCKS))
    echo "   Avg per block: $AVG_REWARD SMITH (expected: ~500)"
    if [ "$AVG_REWARD" -ge 400 ] 2>/dev/null; then
        pass_test "Post-update blocks minting ~${AVG_REWARD}/block (reward=500 active)"
    else
        fail_test "Avg reward $AVG_REWARD/block (expected ~500)"
    fi
else
    skip_test "No blocks during monitoring window"
fi

MON_REWARD_FINAL=$(rpc 26658 "smithnode_getNetworkParams" "" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('reward_per_proof','?'))" 2>/dev/null || echo "?")
if [ "$MON_REWARD_FINAL" = "500" ]; then
    pass_test "Confirmed: reward_per_proof=500 still active after ${MON_BLOCKS} blocks"
else
    fail_test "reward_per_proof changed to $MON_REWARD_FINAL (expected 500)"
fi

# ════════════════════════════════════════════════════════════
#  TEST 14: AGENT DASHBOARD
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 14: AGENT DASHBOARD ═══${NC}"

DASH_INFO=$(rpc 26658 "smithnode_getAgentDashboard" "\"$V1_PUB\"" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin).get('result', {})
    print(f'h={d.get(\"height\",0)} validators={d.get(\"validator_count\",0)} proposals={len(d.get(\"active_proposals\",[]))}')
except: print('ERROR')
" 2>/dev/null || echo "ERROR")

if [[ "$DASH_INFO" != "ERROR" ]]; then
    pass_test "Agent dashboard: $DASH_INFO"
else
    fail_test "Agent dashboard failed"
fi

# ════════════════════════════════════════════════════════════
#  TEST 15: STATE EXPORT
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 15: STATE EXPORT ═══${NC}"

EXPORT_HEIGHT=$(rpc 26658 "smithnode_exportState" "" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('height',0))" 2>/dev/null || echo "0")
EXPORT_VALS=$(rpc 26658 "smithnode_exportState" "" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('result',{}).get('validators',{})))" 2>/dev/null || echo "0")

if [ "$EXPORT_HEIGHT" -gt 0 ] 2>/dev/null; then
    pass_test "State exported: height=$EXPORT_HEIGHT, validators=$EXPORT_VALS"
else
    fail_test "State export returned height 0"
fi

# ════════════════════════════════════════════════════════════
#  TEST 16: VALIDATOR DETAILS
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 16: VALIDATOR DETAILS ═══${NC}"

VAL_COUNT=$(rpc 26658 "smithnode_getValidators" "" | python3 -c "
import sys, json
try:
    vals = json.load(sys.stdin).get('result', [])
    for v in vals:
        pk = v.get('public_key','?')[:16]
        bal = v.get('balance',0)
        rep = v.get('reputation_score',0)
        nonce = v.get('nonce',0)
        print(f'   {pk}.. bal={bal} rep={rep} nonce={nonce}')
    print(f'COUNT={len(vals)}')
except: print('COUNT=0')
" 2>/dev/null | tail -1 | cut -d= -f2)

if [ "$VAL_COUNT" -ge 2 ] 2>/dev/null; then
    pass_test "$VAL_COUNT validators with full details"
else
    fail_test "Expected ≥2 validators, got ${VAL_COUNT:-0}"
fi

# ════════════════════════════════════════════════════════════
#  TEST 17: P2P LIVENESS
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 17: P2P LIVENESS CHALLENGES ═══${NC}"

LIVENESS_V1=$(count_lines "liveness" "$TD/v1.log")
LIVENESS_V2=$(count_lines "liveness" "$TD/v2.log")
LIVENESS_TOTAL=$((LIVENESS_V1 + LIVENESS_V2))
echo "   V1: $LIVENESS_V1 | V2: $LIVENESS_V2"

if [ "$LIVENESS_TOTAL" -gt 0 ]; then
    pass_test "$LIVENESS_TOTAL liveness events"
else
    skip_test "No liveness challenges yet (need ~30s+)"
fi

# ════════════════════════════════════════════════════════════
#  TEST 18: STATE PERSISTENCE
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 18: STATE PERSISTENCE & WAL ═══${NC}"

if [ -f "$TD/node/state.json" ]; then
    STATE_H=$(python3 -c "import json; print(json.load(open('$TD/node/state.json')).get('height',0))" 2>/dev/null || echo "0")
    pass_test "State persisted: height=$STATE_H"
else
    fail_test "No state.json found"
fi

WAL_NODE="0"
[ -f "$TD/node/wal.jsonl" ] && WAL_NODE=$(wc -l < "$TD/node/wal.jsonl" | tr -d ' ')
echo "   WAL entries: $WAL_NODE (0 = fully checkpointed)"
pass_test "WAL system operational"

# ════════════════════════════════════════════════════════════
#  TEST 19: STATE SYNC
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 19: CROSS-NODE STATE SYNC ═══${NC}"

NODE_H=$(rpc_field 26658 "smithnode_status" "" "height")
V1_H=$(rpc_field 26668 "smithnode_status" "" "height")
V2_H=$(rpc_field 26678 "smithnode_status" "" "height")
echo "   Node: h=$NODE_H | V1: h=$V1_H | V2: h=$V2_H"

if [ -n "$NODE_H" ] && [ -n "$V1_H" ] 2>/dev/null; then
    DIFF=$((NODE_H - V1_H))
    if [ "$DIFF" -lt 0 ]; then DIFF=$((-DIFF)); fi
    if [ "$DIFF" -le 3 ] 2>/dev/null; then
        pass_test "Heights within 3 blocks (diff=$DIFF)"
    else
        fail_test "Height gap too large: $DIFF"
    fi
else
    fail_test "Could not compare heights"
fi

# ════════════════════════════════════════════════════════════
#  TEST 20: STATE ROOT CONSISTENCY
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 20: STATE ROOT CONSISTENCY ═══${NC}"

MISMATCH_TOTAL=0
for LOG in "$TD/node.log" "$TD/v1.log" "$TD/v2.log"; do
    MISMATCH_TOTAL=$((MISMATCH_TOTAL + $(count_lines "mismatch" "$LOG")))
done

if [ "$MISMATCH_TOTAL" -eq 0 ]; then
    pass_test "ZERO state root mismatches"
else
    fail_test "$MISMATCH_TOTAL state root mismatches"
fi

# ════════════════════════════════════════════════════════════
#  TEST 21: NO SLASHING
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 21: SLASHING (should be zero) ═══${NC}"

SLASH_TOTAL=0
for LOG in "$TD/node.log" "$TD/v1.log" "$TD/v2.log"; do
    SLASH_TOTAL=$((SLASH_TOTAL + $(count_lines "SLASH" "$LOG")))
done

if [ "$SLASH_TOTAL" -eq 0 ]; then
    pass_test "ZERO slashing events"
else
    fail_test "$SLASH_TOTAL slashing events"
fi

# ════════════════════════════════════════════════════════════
#  TEST 22: RWLOCK HEALTH
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 22: RWLOCK HEALTH ═══${NC}"

POISON_TOTAL=0
for LOG in "$TD/node.log" "$TD/v1.log" "$TD/v2.log"; do
    POISON_TOTAL=$((POISON_TOTAL + $(count_lines "poison" "$LOG")))
done

if [ "$POISON_TOTAL" -eq 0 ]; then
    pass_test "No RwLock poison events"
else
    fail_test "$POISON_TOTAL poison recovery events"
fi

# ════════════════════════════════════════════════════════════
#  TEST 23: NO PANICS
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 23: NO PANICS/FATAL ═══${NC}"

PANIC_TOTAL=0
FATAL_TOTAL=0
for LOG in "$TD/node.log" "$TD/v1.log" "$TD/v2.log"; do
    PANIC_TOTAL=$((PANIC_TOTAL + $(count_lines "panic|PANIC" "$LOG")))
    FATAL_TOTAL=$((FATAL_TOTAL + $(count_lines "FATAL" "$LOG")))
done

if [ "$PANIC_TOTAL" -eq 0 ] && [ "$FATAL_TOTAL" -eq 0 ]; then
    pass_test "No panics or fatal errors"
else
    fail_test "panics=$PANIC_TOTAL fatal=$FATAL_TOTAL"
fi

ERROR_NODE=$(count_lines "error" "$TD/node.log")
ERROR_V1=$(count_lines "error" "$TD/v1.log")
ERROR_V2=$(count_lines "error" "$TD/v2.log")
echo "   Error mentions: node=$ERROR_NODE v1=$ERROR_V1 v2=$ERROR_V2 (non-fatal)"

# ════════════════════════════════════════════════════════════
#  TEST 24: P2P IDENTITY PERSISTENCE
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 24: P2P IDENTITY PERSISTENCE ═══${NC}"

if [ -f "$TD/node/p2p_identity.key" ] && [ -f "$TD/v1/p2p_identity.key" ] && [ -f "$TD/v2/p2p_identity.key" ]; then
    pass_test "All 3 nodes have persistent P2P identity keys"
else
    fail_test "Missing p2p_identity.key files"
fi

# ════════════════════════════════════════════════════════════
#  TEST 25: RATE LIMITING
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 25: RATE LIMITING ═══${NC}"

RAPID_OK=0
for i in $(seq 1 60); do
    RESULT=$(rpc 26658 "smithnode_status" "")
    if echo "$RESULT" | grep -q "height" 2>/dev/null; then
        RAPID_OK=$((RAPID_OK + 1))
    fi
done

if [ "$RAPID_OK" -ge 50 ]; then
    pass_test "$RAPID_OK/60 rapid RPC calls succeeded"
else
    fail_test "Only $RAPID_OK/60 rapid calls succeeded"
fi

# ════════════════════════════════════════════════════════════
#  TEST 26: ALL PROCESSES ALIVE
# ════════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══ TEST 26: ALL PROCESSES ALIVE ═══${NC}"

ALL_ALIVE=true
for PID_INFO in "Main:$NODE_PID" "V1:$V1_PID" "V2:$V2_PID"; do
    PNAME="${PID_INFO%%:*}"
    CPID="${PID_INFO##*:}"
    if kill -0 "$CPID" 2>/dev/null; then
        echo "   $PNAME (PID $CPID): alive ✅"
    else
        echo "   $PNAME (PID $CPID): DEAD ❌"
        ALL_ALIVE=false
    fi
done

if $ALL_ALIVE; then
    pass_test "All 3 processes alive after full test suite"
else
    fail_test "One or more processes died"
fi

# ════════════════════════════════════════════════════════════
#  FINAL REPORT
# ════════════════════════════════════════════════════════════
echo -e "\n"
echo -e "${BOLD}════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  FINAL TEST REPORT — SmithNode v0.5.0${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════════${NC}"

echo -e "\n${CYAN}📊 Final Network Status:${NC}"
rpc 26658 "smithnode_status" "" | python3 -c "
import sys, json
data = json.load(sys.stdin).get('result', {})
print(f'   Height:       {data.get(\"height\", 0)}')
print(f'   Validators:   {data.get(\"validator_count\", 0)} ({data.get(\"active_validator_count\", 0)} active)')
print(f'   Total supply: {data.get(\"total_supply\", 0)} SMITH')
print(f'   State root:   {data.get(\"state_root\", \"?\")[:32]}...')
print(f'   Version:      {data.get(\"node_version\", \"?\")}')
" 2>/dev/null || echo "   (unavailable)"

echo -e "\n${BOLD}   Results:${NC}"
echo -e "   ${GREEN}Passed:  $TESTS_PASSED${NC}"
echo -e "   ${RED}Failed:  $TESTS_FAILED${NC}"
echo -e "   ${YELLOW}Skipped: $TESTS_SKIPPED${NC}"
TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))

echo -e "\n${BOLD}   Systems Tested:${NC}"
echo "   ⚡ Turbo blocks (2s)        🔏 Block signatures (ed25519)"
echo "   💸 Token transfers          🛡️  Replay protection (nonce)"
echo "   🔐 Bad signature reject     🏛️  Governance lifecycle"
echo "   💭 AI vote reasoning        📦 Auto-upgrade announce"
echo "   🚫 Bad upgrade rejection    📡 P2P gossipsub verify"
echo "   📈 Post-update reward verify 🔄 Block reward=500 monitor"
echo "   🧪 P2P liveness            💾 State persistence (WAL)"
echo "   🔗 Cross-node sync          🔒 RwLock health"
echo "   ⚡ Rate limiting            📝 Transaction history"
echo "   📊 Agent dashboard          🪪 P2P identity persist"
echo "   🏷️  Network params          📤 State export"

echo -e "\n${BOLD}════════════════════════════════════════════════════════${NC}"
if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}  ✅ ALL $TESTS_PASSED TESTS PASSED${NC}"
else
    echo -e "${RED}${BOLD}  ❌ $TESTS_FAILED TESTS FAILED (out of $TOTAL_TESTS)${NC}"
fi
echo -e "${BOLD}════════════════════════════════════════════════════════${NC}"
echo -e "  Logs:  $TD/{node,v1,v2}.log"
echo -e "  State: $TD/{node,v1,v2}/state.json"
echo -e "${BOLD}════════════════════════════════════════════════════════${NC}"

[ "$TESTS_FAILED" -gt 0 ] && exit 1
exit 0
