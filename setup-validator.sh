#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
#  SmithNode Validator Setup Wizard
#  https://github.com/sab4a/MOLTCHAIN
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/sab4a/MOLTCHAIN/main/setup-validator.sh | bash
#
#  Or run locally:
#    bash setup-validator.sh
#
#  Non-interactive / AI-agent mode:
#    bash setup-validator.sh --auto
#    bash setup-validator.sh --auto --import-keypair /path/to/keypair.json
#    bash setup-validator.sh --auto --ai-provider groq --ai-api-key gsk_xxx
# ============================================================================

# ── Colors ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

# ── Network constants ──────────────────────────────────────────────────────
BOOTSTRAP_PEER="/ip4/168.220.90.95/tcp/26656/p2p/12D3KooWJyB16VuipGPx4dQUXvP6icoWedvA5NHujvUDBqa9xRsA"
SEQUENCER_RPC="https://smithnode-rpc.fly.dev"
GITHUB_REPO="sab4a/MOLTCHAIN"
INSTALL_DIR="$HOME/.smithnode"
BINARY_PATH="$INSTALL_DIR/smithnode"
KEYPAIR_PATH="$INSTALL_DIR/keypair.json"

# ── Defaults (overridable by flags) ────────────────────────────────────────
AUTO_MODE=false
INSTALL_METHOD=""        # "binary" or "source"
IMPORT_KEYPAIR=""        # path to existing keypair
AI_PROVIDER=""
AI_API_KEY=""
AI_MODEL=""
AI_ENDPOINT=""
START_AFTER=true

# ── Parse CLI flags ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto)           AUTO_MODE=true; shift ;;
    --binary)         INSTALL_METHOD="binary"; shift ;;
    --source)         INSTALL_METHOD="source"; shift ;;
    --import-keypair) IMPORT_KEYPAIR="$2"; shift 2 ;;
    --ai-provider)    AI_PROVIDER="$2"; shift 2 ;;
    --ai-api-key)     AI_API_KEY="$2"; shift 2 ;;
    --ai-model)       AI_MODEL="$2"; shift 2 ;;
    --ai-endpoint)    AI_ENDPOINT="$2"; shift 2 ;;
    --install-dir)    INSTALL_DIR="$2"; BINARY_PATH="$INSTALL_DIR/smithnode"; KEYPAIR_PATH="$INSTALL_DIR/keypair.json"; shift 2 ;;
    --no-start)       START_AFTER=false; shift ;;
    --help|-h)
      echo "SmithNode Validator Setup Wizard"
      echo ""
      echo "Usage: bash setup-validator.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --auto              Non-interactive mode (for AI agents)"
      echo "  --binary            Download pre-built binary (default in --auto)"
      echo "  --source            Build from source (requires Rust)"
      echo "  --import-keypair F  Import existing keypair from file F"
      echo "  --ai-provider P     Set AI provider: ollama, openai, anthropic, groq, together"
      echo "  --ai-api-key K      Set AI API key"
      echo "  --ai-model M        Set AI model name"
      echo "  --ai-endpoint U     Set AI endpoint URL"
      echo "  --install-dir D     Set install directory (default: ~/.smithnode)"
      echo "  --no-start          Don't start validator after setup"
      echo "  --help              Show this help"
      exit 0
      ;;
    *) echo -e "${RED}Unknown flag: $1${NC}"; exit 1 ;;
  esac
done

# ── Helpers ─────────────────────────────────────────────────────────────────
banner() {
  echo ""
  echo -e "${CYAN}${BOLD}╔═══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}║       SmithNode Validator Setup Wizard  ⛓️🤖      ║${NC}"
  echo -e "${CYAN}${BOLD}║   The first blockchain validated by AI agents     ║${NC}"
  echo -e "${CYAN}${BOLD}╚═══════════════════════════════════════════════════╝${NC}"
  echo ""
}

info()    { echo -e "${CYAN}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1"; }
step()    { echo -e "\n${BOLD}[$1/$TOTAL_STEPS] $2${NC}"; }

ask() {
  local prompt="$1"
  local default="${2:-}"
  if [[ -n "$default" ]]; then
    echo -en "${CYAN}?${NC} ${prompt} ${DIM}(${default})${NC}: "
  else
    echo -en "${CYAN}?${NC} ${prompt}: "
  fi
  read -r REPLY
  if [[ -z "$REPLY" && -n "$default" ]]; then
    REPLY="$default"
  fi
}

ask_choice() {
  local prompt="$1"
  shift
  local options=("$@")
  echo -e "\n${CYAN}?${NC} ${prompt}"
  for i in "${!options[@]}"; do
    echo -e "  ${BOLD}$((i+1)))${NC} ${options[$i]}"
  done
  echo -en "  ${DIM}Enter choice [1-${#options[@]}]:${NC} "
  read -r REPLY
  # Validate
  if [[ ! "$REPLY" =~ ^[0-9]+$ ]] || (( REPLY < 1 || REPLY > ${#options[@]} )); then
    REPLY=1
  fi
}

detect_os() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Linux)  OS_LABEL="linux" ;;
    Darwin) OS_LABEL="macos" ;;
    *)      error "Unsupported OS: $OS"; exit 1 ;;
  esac
  case "$ARCH" in
    x86_64|amd64)  ARCH_LABEL="x64" ;;
    aarch64|arm64) ARCH_LABEL="arm64" ;;
    *)             error "Unsupported architecture: $ARCH"; exit 1 ;;
  esac
  PLATFORM="${OS_LABEL}-${ARCH_LABEL}"
}

check_command() {
  command -v "$1" &>/dev/null
}

check_network() {
  local status
  status=$(curl -s --max-time 10 -X POST "$SEQUENCER_RPC" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' 2>/dev/null || echo "")
  if [[ -z "$status" ]]; then
    warn "Cannot reach sequencer at $SEQUENCER_RPC"
    warn "Your validator may not be able to sync. Check your internet connection."
    return 1
  fi
  local height version validators
  height=$(echo "$status" | grep -o '"height":[0-9]*' | head -1 | cut -d: -f2)
  version=$(echo "$status" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
  validators=$(echo "$status" | grep -o '"validator_count":[0-9]*' | head -1 | cut -d: -f2)
  success "Network online — v${version}, height ${height}, ${validators} validators"
  return 0
}

TOTAL_STEPS=5

# ═══════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════

banner
detect_os
info "Detected platform: ${BOLD}${PLATFORM}${NC}"

# Check network first
info "Checking SmithNode network..."
check_network || true

mkdir -p "$INSTALL_DIR"

# ── Step 1: Installation Method ────────────────────────────────────────────
step 1 "Install SmithNode binary"

if [[ -f "$BINARY_PATH" ]]; then
  current_ver=$("$BINARY_PATH" --version 2>/dev/null | head -1 || echo "unknown")
  info "Existing binary found: $current_ver"
  if [[ "$AUTO_MODE" == true ]]; then
    INSTALL_METHOD="${INSTALL_METHOD:-skip}"
  else
    ask_choice "SmithNode is already installed. What would you like to do?" \
      "Keep current installation" \
      "Download latest binary (recommended)" \
      "Build from source (requires Rust 1.70+)"
    case "$REPLY" in
      1) INSTALL_METHOD="skip" ;;
      2) INSTALL_METHOD="binary" ;;
      3) INSTALL_METHOD="source" ;;
    esac
  fi
elif [[ "$AUTO_MODE" == true ]]; then
  INSTALL_METHOD="${INSTALL_METHOD:-binary}"
else
  ask_choice "How would you like to install SmithNode?" \
    "Download pre-built binary (fastest, recommended)" \
    "Build from source (requires Rust 1.70+)"
  case "$REPLY" in
    1) INSTALL_METHOD="binary" ;;
    2) INSTALL_METHOD="source" ;;
  esac
fi

case "$INSTALL_METHOD" in
  binary)
    info "Downloading SmithNode binary for ${PLATFORM}..."
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/latest/download/smithnode-${PLATFORM}"
    
    if curl -fsSL --max-time 120 -o "${BINARY_PATH}.tmp" "$DOWNLOAD_URL" 2>/dev/null; then
      mv "${BINARY_PATH}.tmp" "$BINARY_PATH"
      chmod +x "$BINARY_PATH"
      success "Binary downloaded to $BINARY_PATH"
    else
      warn "Binary download failed (release may not exist for ${PLATFORM} yet)"
      info "Falling back to building from source..."
      INSTALL_METHOD="source"
    fi
    ;;
esac

if [[ "$INSTALL_METHOD" == "source" ]]; then
  if ! check_command cargo; then
    error "Rust is not installed. Install it first:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
  fi
  
  BUILD_DIR=$(mktemp -d)
  info "Cloning repository..."
  git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "$BUILD_DIR/MOLTCHAIN" 2>/dev/null
  
  info "Building release binary (this may take 2-5 minutes)..."
  cd "$BUILD_DIR/MOLTCHAIN/smithnode-node"
  cargo build --release 2>&1 | tail -5
  
  cp target/release/smithnode "$BINARY_PATH"
  chmod +x "$BINARY_PATH"
  cd - >/dev/null
  rm -rf "$BUILD_DIR"
  success "Built and installed to $BINARY_PATH"
fi

if [[ "$INSTALL_METHOD" == "skip" ]]; then
  success "Keeping current installation"
fi

# Verify binary works
if [[ -f "$BINARY_PATH" ]]; then
  BIN_VERSION=$("$BINARY_PATH" --version 2>/dev/null | head -1 || echo "unknown")
  success "SmithNode binary ready: ${BIN_VERSION}"
else
  error "Binary not found at $BINARY_PATH"
  exit 1
fi

# ── Step 2: Keypair ────────────────────────────────────────────────────────
step 2 "Validator keypair"

if [[ -n "$IMPORT_KEYPAIR" ]]; then
  # Import from flag
  if [[ ! -f "$IMPORT_KEYPAIR" ]]; then
    error "Keypair file not found: $IMPORT_KEYPAIR"
    exit 1
  fi
  cp "$IMPORT_KEYPAIR" "$KEYPAIR_PATH"
  chmod 600 "$KEYPAIR_PATH"
  success "Imported keypair from $IMPORT_KEYPAIR"

elif [[ -f "$KEYPAIR_PATH" ]]; then
  # Existing keypair found
  PUBKEY=$(grep -o '"public_key":"[^"]*"' "$KEYPAIR_PATH" 2>/dev/null | cut -d'"' -f4 | head -1 || echo "")
  if [[ -n "$PUBKEY" ]]; then
    info "Existing keypair found: ${PUBKEY:0:16}..."
  fi
  
  if [[ "$AUTO_MODE" == true ]]; then
    success "Using existing keypair"
  else
    ask_choice "A keypair already exists. What would you like to do?" \
      "Keep existing keypair (recommended)" \
      "Generate a new keypair (old one will be backed up)" \
      "Import keypair from a file"
    case "$REPLY" in
      1) success "Keeping existing keypair" ;;
      2)
        # Backup old
        BACKUP="${KEYPAIR_PATH}.backup.$(date +%s)"
        mv "$KEYPAIR_PATH" "$BACKUP"
        warn "Old keypair backed up to $BACKUP"
        "$BINARY_PATH" keygen -o "$KEYPAIR_PATH"
        chmod 600 "$KEYPAIR_PATH"
        success "New keypair generated"
        ;;
      3)
        ask "Enter path to your keypair file"
        if [[ -f "$REPLY" ]]; then
          cp "$REPLY" "$KEYPAIR_PATH"
          chmod 600 "$KEYPAIR_PATH"
          success "Imported keypair from $REPLY"
        else
          error "File not found: $REPLY"
          exit 1
        fi
        ;;
    esac
  fi

else
  # No keypair — generate or import
  if [[ "$AUTO_MODE" == true ]]; then
    info "Generating new validator keypair..."
    "$BINARY_PATH" keygen -o "$KEYPAIR_PATH"
    chmod 600 "$KEYPAIR_PATH"
    success "New keypair generated"
  else
    ask_choice "No keypair found. What would you like to do?" \
      "Generate a new keypair (recommended for new validators)" \
      "Import an existing keypair from a file"
    case "$REPLY" in
      1)
        "$BINARY_PATH" keygen -o "$KEYPAIR_PATH"
        chmod 600 "$KEYPAIR_PATH"
        success "New keypair generated"
        ;;
      2)
        ask "Enter path to your keypair file"
        if [[ -f "$REPLY" ]]; then
          cp "$REPLY" "$KEYPAIR_PATH"
          chmod 600 "$KEYPAIR_PATH"
          success "Imported keypair from $REPLY"
        else
          error "File not found: $REPLY"
          exit 1
        fi
        ;;
    esac
  fi
fi

# Show pubkey
PUBKEY=$(grep -o '"public_key":"[^"]*"' "$KEYPAIR_PATH" 2>/dev/null | cut -d'"' -f4 | head -1 || echo "unknown")
info "Your validator public key: ${BOLD}${PUBKEY}${NC}"

# ── Step 3: AI Provider ───────────────────────────────────────────────────
step 3 "AI provider (optional)"

echo -e "${DIM}  AI helps solve harder cognitive challenges. The built-in solver"
echo -e "  handles basic puzzles without any AI provider.${NC}"

if [[ "$AUTO_MODE" == true && -z "$AI_PROVIDER" ]]; then
  info "No AI provider specified — using built-in deterministic solver"
elif [[ "$AUTO_MODE" == true ]]; then
  success "AI provider: $AI_PROVIDER"
elif [[ -z "$AI_PROVIDER" ]]; then
  ask_choice "Choose an AI provider (or skip):" \
    "None — use built-in solver (no setup needed)" \
    "Ollama — free, private, runs locally (recommended)" \
    "Groq — fast cloud AI (has free tier)" \
    "OpenAI — GPT models" \
    "Anthropic — Claude models" \
    "Together AI — open-source models"
  case "$REPLY" in
    1) AI_PROVIDER="" ;;
    2)
      AI_PROVIDER="ollama"
      if check_command ollama; then
        success "Ollama detected"
        # Check if a model is available
        OLLAMA_MODELS=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' || echo "")
        if [[ -n "$OLLAMA_MODELS" ]]; then
          info "Available models: $OLLAMA_MODELS"
          ask "Which model to use?" "$(echo "$OLLAMA_MODELS" | head -1)"
          AI_MODEL="$REPLY"
        else
          warn "No models found. Pull one first: ollama pull llama2"
          ask "Model name to use" "llama2"
          AI_MODEL="$REPLY"
        fi
      else
        warn "Ollama not found. Install it: https://ollama.ai"
        ask "Model name to use when Ollama is available" "llama2"
        AI_MODEL="$REPLY"
      fi
      AI_ENDPOINT="${AI_ENDPOINT:-http://localhost:11434}"
      ;;
    3)
      AI_PROVIDER="groq"
      ask "Enter your Groq API key"
      AI_API_KEY="$REPLY"
      AI_MODEL="${AI_MODEL:-llama-3.1-70b-versatile}"
      ;;
    4)
      AI_PROVIDER="openai"
      ask "Enter your OpenAI API key"
      AI_API_KEY="$REPLY"
      AI_MODEL="${AI_MODEL:-gpt-4-turbo-preview}"
      ;;
    5)
      AI_PROVIDER="anthropic"
      ask "Enter your Anthropic API key"
      AI_API_KEY="$REPLY"
      AI_MODEL="${AI_MODEL:-claude-3-sonnet-20240229}"
      ;;
    6)
      AI_PROVIDER="together"
      ask "Enter your Together AI API key"
      AI_API_KEY="$REPLY"
      AI_MODEL="${AI_MODEL:-meta-llama/Llama-3-70b-chat-hf}"
      ;;
  esac
fi

# ── Step 4: Build launch command ──────────────────────────────────────────
step 4 "Configure validator"

CMD=("$BINARY_PATH" validator
  --keypair "$KEYPAIR_PATH"
  --data-dir "$INSTALL_DIR/data"
  --peer "$BOOTSTRAP_PEER"
  --sequencer-rpc "$SEQUENCER_RPC"
)

if [[ -n "$AI_PROVIDER" ]]; then
  CMD+=(--ai-provider "$AI_PROVIDER")
  [[ -n "$AI_API_KEY" ]]  && CMD+=(--ai-api-key "$AI_API_KEY")
  [[ -n "$AI_MODEL" ]]    && CMD+=(--ai-model "$AI_MODEL")
  [[ -n "$AI_ENDPOINT" ]] && CMD+=(--ai-endpoint "$AI_ENDPOINT")
fi

# Save launch command to a script for easy restart
LAUNCH_SCRIPT="$INSTALL_DIR/start.sh"
{
  echo "#!/usr/bin/env bash"
  echo "# SmithNode Validator Launch Script"
  echo "# Generated by setup-validator.sh on $(date)"
  echo "# Re-run setup: curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/setup-validator.sh | bash"
  echo ""
  echo "set -euo pipefail"
  echo ""
  # Write command with proper quoting
  echo -n "exec"
  for arg in "${CMD[@]}"; do
    printf ' "%s"' "$arg"
  done
  echo ""
} > "$LAUNCH_SCRIPT"
chmod +x "$LAUNCH_SCRIPT"

success "Launch script saved to $LAUNCH_SCRIPT"
info "You can restart anytime with: ${BOLD}bash $LAUNCH_SCRIPT${NC}"

# ── Step 5: Summary & Launch ──────────────────────────────────────────────
step 5 "Ready to launch"

echo ""
echo -e "${CYAN}╭──────────────────────────────────────────────────╮${NC}"
echo -e "${CYAN}│${NC}  ${BOLD}Validator Configuration${NC}                          ${CYAN}│${NC}"
echo -e "${CYAN}├──────────────────────────────────────────────────┤${NC}"
echo -e "${CYAN}│${NC}  Binary:     $BINARY_PATH"
echo -e "${CYAN}│${NC}  Keypair:    $KEYPAIR_PATH"
echo -e "${CYAN}│${NC}  Public Key: ${PUBKEY:0:20}..."
echo -e "${CYAN}│${NC}  Data Dir:   $INSTALL_DIR/data"
echo -e "${CYAN}│${NC}  Bootstrap:  168.220.90.95:26656"
if [[ -n "$AI_PROVIDER" ]]; then
echo -e "${CYAN}│${NC}  AI:         ${AI_PROVIDER} (${AI_MODEL:-default})"
else
echo -e "${CYAN}│${NC}  AI:         built-in solver (no AI)"
fi
echo -e "${CYAN}╰──────────────────────────────────────────────────╯${NC}"
echo ""

echo -e "${DIM}  On startup your validator will:${NC}"
echo -e "${DIM}  1. Connect to the P2P network via libp2p${NC}"
echo -e "${DIM}  2. Sync state from peers${NC}"
echo -e "${DIM}  3. Auto-register & receive 100 SMITH${NC}"
echo -e "${DIM}  4. Start earning block rewards (~2s blocks)${NC}"
echo -e "${DIM}  5. Auto-update when new versions are released${NC}"
echo ""

if [[ "$START_AFTER" == false ]]; then
  success "Setup complete! Start your validator with:"
  echo ""
  echo -e "  ${BOLD}bash $LAUNCH_SCRIPT${NC}"
  echo ""
  exit 0
fi

if [[ "$AUTO_MODE" == true ]]; then
  info "Starting validator..."
  exec "${CMD[@]}"
else
  ask_choice "Start your validator now?" \
    "Yes — start validating! 🚀" \
    "No — I'll start it later"
  case "$REPLY" in
    1)
      echo ""
      success "Launching SmithNode validator..."
      echo -e "${DIM}  Press Ctrl+C to stop${NC}"
      echo ""
      exec "${CMD[@]}"
      ;;
    2)
      echo ""
      success "Setup complete! Start your validator anytime with:"
      echo ""
      echo -e "  ${BOLD}bash $LAUNCH_SCRIPT${NC}"
      echo ""
      echo -e "  Or manually:"
      echo -e "  ${DIM}${CMD[*]}${NC}"
      echo ""
      ;;
  esac
fi
