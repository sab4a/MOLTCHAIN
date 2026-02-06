#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# SmithNode — 10 Local Validators → Fly.io Sequencer
#═══════════════════════════════════════════════════════════════════════════════
# Spins up 10 local P2P validator nodes that connect to the deployed Fly.io
# sequencer at smithnode-rpc.fly.dev. Each validator:
#   1. Generates a fresh ed25519 keypair
#   2. Connects to Fly.io via P2P (libp2p TCP)
#   3. Registers itself as a validator
#   4. Sends heartbeats, solves challenges, participates in consensus
#   5. Listens for upgrade announcements (auto-update pipeline)
#
# Usage:  ./run-10-validators.sh           # start all 10
#         ./run-10-validators.sh stop       # kill all 10
#         ./run-10-validators.sh status     # show status of all 10
#         ./run-10-validators.sh logs 3     # tail logs of validator 3
#═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="$SCRIPT_DIR/target/release/smithnode"
BASE_DIR="$SCRIPT_DIR/.validators"
NUM_VALIDATORS=10
FLY_IP="168.220.90.95"
FLY_P2P_PORT=26656
FLY_RPC="https://smithnode-rpc.fly.dev"
FLY_PEER_ID="12D3KooWJyB16VuipGPx4dQUXvP6icoWedvA5NHujvUDBqa9xRsA"
FLY_MULTIADDR="/ip4/${FLY_IP}/tcp/${FLY_P2P_PORT}/p2p/${FLY_PEER_ID}"

# P2P ports: 27001-27010, RPC ports: 28001-28010
P2P_BASE_PORT=27001
RPC_BASE_PORT=28001

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[VALIDATORS]${NC} $*"; }
warn() { echo -e "${YELLOW}[VALIDATORS]${NC} $*"; }
err() { echo -e "${RED}[VALIDATORS]${NC} $*"; }

#═══════════════════════════════════════════════════════════════════════════════
# STOP — kill all validator processes
#═══════════════════════════════════════════════════════════════════════════════
stop_all() {
    log "Stopping all validators..."
    local killed=0
    for i in $(seq 1 $NUM_VALIDATORS); do
        local pidfile="$BASE_DIR/validator-$i/validator.pid"
        if [[ -f "$pidfile" ]]; then
            local pid
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                ((killed++))
                echo -e "  ${RED}✗${NC} Validator $i (PID $pid) stopped"
            fi
            rm -f "$pidfile"
        fi
    done
    # Also kill any strays
    pkill -f "smithnode validator.*27[0-9][0-9][0-9]" 2>/dev/null || true
    log "Stopped $killed validator(s)"
}

#═══════════════════════════════════════════════════════════════════════════════
# STATUS — show health of all validators
#═══════════════════════════════════════════════════════════════════════════════
status_all() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  SmithNode — 10 Validator Status${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
    printf "%-4s %-8s %-10s %-12s %-18s %s\n" "#" "PID" "STATUS" "RPC PORT" "PUBKEY" "BALANCE"
    echo "────────────────────────────────────────────────────────────────────"
    
    for i in $(seq 1 $NUM_VALIDATORS); do
        local pidfile="$BASE_DIR/validator-$i/validator.pid"
        local keyfile="$BASE_DIR/validator-$i/keypair.json"
        local pid="—"
        local status="${RED}DEAD${NC}"
        local rpc_port=$((RPC_BASE_PORT + i - 1))
        local pubkey="—"
        local balance="—"
        
        if [[ -f "$keyfile" ]]; then
            pubkey=$(python3 -c "import json; print(json.load(open('$keyfile'))['public_key'][:16])" 2>/dev/null || echo "—")
        fi
        
        if [[ -f "$pidfile" ]]; then
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                status="${GREEN}ALIVE${NC}"
                # Try to get balance from local RPC
                local resp
                resp=$(curl -s --max-time 2 -X POST "http://127.0.0.1:$rpc_port" \
                    -H "Content-Type: application/json" \
                    -d "{\"jsonrpc\":\"2.0\",\"method\":\"smithnode_status\",\"params\":[],\"id\":1}" 2>/dev/null || echo "")
                if [[ -n "$resp" ]] && echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['height'])" 2>/dev/null; then
                    balance=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print('h=' + str(d['result']['height']))" 2>/dev/null || echo "—")
                fi
            else
                status="${RED}DEAD${NC}"
            fi
        fi
        
        printf "%-4s %-8s " "$i" "$pid"
        echo -en "$status"
        printf "     %-12s %-18s %s\n" "$rpc_port" "${pubkey}..." "$balance"
    done
    
    echo ""
    # Fly.io node status
    echo -e "${CYAN}  Fly.io Sequencer:${NC}"
    local fly_resp
    fly_resp=$(curl -s --max-time 5 -X POST "$FLY_RPC" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null || echo "")
    if [[ -n "$fly_resp" ]]; then
        echo "$fly_resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)['result']
print(f\"    Height: {d['height']}  Supply: {d['total_supply']}  Validators: {d['validator_count']}  Active: {d['active_validator_count']}  Version: {d['node_version']}\")
" 2>/dev/null || echo "    (failed to parse)"
    else
        echo -e "    ${RED}UNREACHABLE${NC}"
    fi
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

#═══════════════════════════════════════════════════════════════════════════════
# LOGS — tail a specific validator's log
#═══════════════════════════════════════════════════════════════════════════════
show_logs() {
    local n=${1:-1}
    local logfile="$BASE_DIR/validator-$n/validator.log"
    if [[ ! -f "$logfile" ]]; then
        err "No log file for validator $n"
        exit 1
    fi
    tail -f "$logfile"
}

#═══════════════════════════════════════════════════════════════════════════════
# START — spin up all 10 validators
#═══════════════════════════════════════════════════════════════════════════════
start_all() {
    # Verify binary exists
    if [[ ! -x "$BINARY" ]]; then
        err "Binary not found: $BINARY"
        err "Run: cd $SCRIPT_DIR && cargo build --release"
        exit 1
    fi

    log "Binary: $BINARY"
    log "Fly.io peer: $FLY_MULTIADDR"
    log "RPC endpoint: $FLY_RPC"
    echo ""

    # Check Fly.io is reachable
    log "Checking Fly.io sequencer..."
    local fly_status
    fly_status=$(curl -s --max-time 10 -X POST "$FLY_RPC" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null || echo "")
    if [[ -z "$fly_status" ]]; then
        err "Cannot reach Fly.io node at $FLY_RPC"
        err "Make sure 'fly deploy' succeeded and the machine is running"
        exit 1
    fi
    log "✅ Fly.io node is live"
    echo "$fly_status" | python3 -c "
import sys, json
d = json.load(sys.stdin)['result']
print(f\"   Height: {d['height']}  Validators: {d['validator_count']}  Version: {d['node_version']}\")
" 2>/dev/null || true
    echo ""

    # Stop any existing validators first
    stop_all 2>/dev/null || true
    sleep 1

    mkdir -p "$BASE_DIR"

    # Generate keypairs and start validators
    for i in $(seq 1 $NUM_VALIDATORS); do
        local dir="$BASE_DIR/validator-$i"
        local keyfile="$dir/keypair.json"
        local logfile="$dir/validator.log"
        local pidfile="$dir/validator.pid"
        local p2p_port=$((P2P_BASE_PORT + i - 1))
        local rpc_port=$((RPC_BASE_PORT + i - 1))

        mkdir -p "$dir"

        # Generate keypair if it doesn't exist
        if [[ ! -f "$keyfile" ]]; then
            "$BINARY" keygen -o "$keyfile" 2>/dev/null
            log "🔑 Generated keypair for validator $i"
        fi

        local pubkey
        pubkey=$(python3 -c "import json; print(json.load(open('$keyfile'))['public_key'])" 2>/dev/null)

        # Copy the node_key.json (admin key) into each validator's data dir
        # so they trust upgrade announcements from our admin key
        if [[ -f "$SCRIPT_DIR/.smithnode-data/node_key.json" ]]; then
            cp "$SCRIPT_DIR/.smithnode-data/node_key.json" "$dir/node_key.json"
        fi

        # Build peer list — connect to Fly.io AND to other local validators
        local peer_args="--peer $FLY_MULTIADDR"
        # Each validator also dials the previous one for local mesh
        if [[ $i -gt 1 ]]; then
            # We don't know previous peer IDs in advance, but mDNS handles local discovery
            # So we only need the Fly.io peer for bootstrap
            :
        fi

        # Start validator
        RUST_LOG=info \
        SMITHNODE_DATA_DIR="$dir" \
        "$BINARY" validator \
            --data-dir "$dir" \
            --keypair "$keyfile" \
            --p2p-bind "0.0.0.0:$p2p_port" \
            $peer_args \
            --rpc-bind "127.0.0.1:$rpc_port" \
            --sequencer-rpc "$FLY_RPC" \
            > "$logfile" 2>&1 &

        local pid=$!
        echo "$pid" > "$pidfile"

        echo -e "  ${GREEN}✓${NC} Validator $i  PID=$pid  P2P=:$p2p_port  RPC=:$rpc_port  Key=${pubkey:0:16}..."

        # Stagger startups by 1s to avoid port conflicts and allow mDNS discovery
        sleep 1
    done

    echo ""
    log "═══════════════════════════════════════════════════════════"
    log "  All $NUM_VALIDATORS validators launched!"
    log "  They will auto-discover each other via mDNS"
    log "  and connect to Fly.io via P2P TCP"
    log ""
    log "  Useful commands:"
    log "    ./run-10-validators.sh status     # check health"
    log "    ./run-10-validators.sh logs 3     # tail validator 3"
    log "    ./run-10-validators.sh stop       # kill all"
    log "═══════════════════════════════════════════════════════════"
    echo ""

    # Wait a few seconds then show status
    log "Waiting 10s for P2P mesh to form..."
    sleep 10
    status_all
}

#═══════════════════════════════════════════════════════════════════════════════
# MAIN
#═══════════════════════════════════════════════════════════════════════════════
case "${1:-start}" in
    start)   start_all ;;
    stop)    stop_all ;;
    status)  status_all ;;
    logs)    show_logs "${2:-1}" ;;
    *)
        echo "Usage: $0 {start|stop|status|logs N}"
        exit 1
        ;;
esac
