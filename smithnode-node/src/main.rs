//! SmithNode - P2P for AI agents. Proof of Cognition.
//!
//! A decentralized blockchain where AI agents serve as primary validators.
//! Like BitTorrent, but for seeding "truth" through transaction validation.

mod stf;
mod rpc;
mod p2p;
mod cli;
mod storage;
mod ai;

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::cli::{Cli, Commands};
use crate::stf::SmithNodeState;
use crate::rpc::start_rpc_server;
use crate::p2p::SmithNodeNetwork;

// NOTE: AI messaging functions DISABLED on devnet
// Focus on: Challenges (Proof of Cognition) + Governance (parameter voting)
// 
// Removed:
// - should_answer_question() - committee selection for AI Q&A
// - generate_ai_response() - auto AI response generation
//
// These can be re-enabled for mainnet when there's actual value in AI discussions

/// Built-in deterministic puzzle solver for validators without AI
/// Handles simple puzzles (pattern, math, text transform) without needing an LLM
fn builtin_solve_puzzle(puzzle: &stf::CognitivePuzzle) -> Option<String> {
    use stf::PuzzleType;
    
    match puzzle.puzzle_type {
        PuzzleType::PatternNext => {
            // Try to detect arithmetic/geometric patterns from the sequence
            if let Some(ref seq) = puzzle.sequence {
                let nums: Vec<i64> = seq.iter()
                    .filter_map(|s| s.parse::<i64>().ok())
                    .collect();
                if nums.len() >= 2 {
                    // Check arithmetic (constant difference)
                    let diff = nums[1] - nums[0];
                    let is_arithmetic = nums.windows(2).all(|w| w[1] - w[0] == diff);
                    if is_arithmetic {
                        return Some((nums.last().unwrap() + diff).to_string());
                    }
                    // Check geometric (constant ratio)
                    if nums[0] != 0 && nums[1] % nums[0] == 0 {
                        let ratio = nums[1] / nums[0];
                        let is_geometric = nums.windows(2).all(|w| w[0] != 0 && w[1] / w[0] == ratio);
                        if is_geometric {
                            return Some((nums.last().unwrap() * ratio).to_string());
                        }
                    }
                    // Check second-order differences
                    if nums.len() >= 3 {
                        let diffs: Vec<i64> = nums.windows(2).map(|w| w[1] - w[0]).collect();
                        let second_diff = diffs[1] - diffs[0];
                        let is_quadratic = diffs.windows(2).all(|w| w[1] - w[0] == second_diff);
                        if is_quadratic {
                            let next_diff = diffs.last().unwrap() + second_diff;
                            return Some((nums.last().unwrap() + next_diff).to_string());
                        }
                    }
                }
            }
            None
        }
        PuzzleType::NaturalLanguageMath => {
            // Parse natural language math from prompt
            // Prompts look like: "Calculate: 'five plus three'. Reply with ONLY the number."
            let prompt = puzzle.prompt.to_lowercase();
            // Extract the expression between quotes
            if let Some(start) = prompt.find('\'') {
                if let Some(end) = prompt.rfind('\'') {
                    if end > start {
                        let expr = &prompt[start+1..end];
                        return solve_nl_math(expr);
                    }
                }
            }
            None
        }
        PuzzleType::TextTransform => {
            if let Some(ref input) = puzzle.input_text {
                let prompt_lower = puzzle.prompt.to_lowercase();
                if prompt_lower.contains("reverse") && prompt_lower.contains("uppercase") {
                    return Some(input.chars().rev().collect::<String>().to_uppercase());
                } else if prompt_lower.contains("reverse") {
                    return Some(input.chars().rev().collect::<String>());
                } else if prompt_lower.contains("uppercase") {
                    return Some(input.to_uppercase());
                } else if prompt_lower.contains("vowel") {
                    return Some(input.chars().filter(|c| !matches!(c, 'a'|'e'|'i'|'o'|'u'|'A'|'E'|'I'|'O'|'U')).collect());
                } else if prompt_lower.contains("count") && prompt_lower.contains("character") {
                    return Some(input.len().to_string());
                }
            }
            None
        }
        PuzzleType::EncodingDecode => {
            // Decode hex, rot13, or reversed strings
            let prompt_lower = puzzle.prompt.to_lowercase();
            if let Some(ref input) = puzzle.input_text {
                if prompt_lower.contains("hex") {
                    if let Ok(bytes) = hex::decode(input) {
                        if let Ok(s) = String::from_utf8(bytes) {
                            return Some(s);
                        }
                    }
                } else if prompt_lower.contains("reversed") {
                    return Some(input.chars().rev().collect::<String>());
                } else if prompt_lower.contains("rot13") {
                    let decoded: String = input.chars().map(|c| {
                        if c.is_ascii_lowercase() {
                            (((c as u8 - b'a' + 13) % 26) + b'a') as char
                        } else if c.is_ascii_uppercase() {
                            (((c as u8 - b'A' + 13) % 26) + b'A') as char
                        } else {
                            c
                        }
                    }).collect();
                    return Some(decoded);
                }
            }
            None
        }
        _ => None, // CodeBugDetection, SemanticSummary require actual AI
    }
}

/// Solve natural language math expressions
fn solve_nl_math(expr: &str) -> Option<String> {
    // Normalize: collapse "multiplied by" into "multiplied" so it's one token
    let normalized = expr.replace("multiplied by", "multiplied");
    let words: Vec<&str> = normalized.split_whitespace().collect();
    
    let word_to_num = |w: &str| -> Option<i64> {
        match w {
            "zero" => Some(0), "one" => Some(1), "two" => Some(2),
            "three" => Some(3), "four" => Some(4), "five" => Some(5),
            "six" => Some(6), "seven" => Some(7), "eight" => Some(8),
            "nine" => Some(9), "ten" => Some(10), "eleven" => Some(11),
            "twelve" => Some(12), "thirteen" => Some(13), "fourteen" => Some(14),
            "fifteen" => Some(15), "sixteen" => Some(16), "seventeen" => Some(17),
            "eighteen" => Some(18), "nineteen" => Some(19), "twenty" => Some(20),
            _ => w.parse::<i64>().ok(),
        }
    };
    
    // Handle "X squared minus Y"
    if let Some(sq_pos) = words.iter().position(|&w| w == "squared") {
        if sq_pos > 0 {
            if let Some(base) = word_to_num(words[sq_pos - 1]) {
                let squared = base * base;
                if sq_pos + 2 < words.len() && words[sq_pos + 1] == "minus" {
                    if let Some(sub) = word_to_num(words[sq_pos + 2]) {
                        return Some((squared - sub).to_string());
                    }
                }
                return Some(squared.to_string());
            }
        }
    }
    
    // Handle "X op Y" or "X op Y op Z"
    if words.len() >= 3 {
        let a = word_to_num(words[0])?;
        let op1 = words[1];
        let b = word_to_num(words[2])?;
        
        if words.len() >= 5 {
            let op2 = words[3];
            let c = word_to_num(words[4])?;
            // Handle operator precedence: multiplication before addition
            match (op1, op2) {
                ("plus", "times" | "multiplied") => return Some((a + b * c).to_string()),
                ("times" | "multiplied", "plus") => return Some((a * b + c).to_string()),
                ("plus", "plus") => return Some((a + b + c).to_string()),
                ("times" | "multiplied", "times" | "multiplied") => return Some((a * b * c).to_string()),
                ("minus", "times" | "multiplied") => return Some((a - b * c).to_string()),
                _ => {}
            }
        }
        
        match op1 {
            "plus" => return Some((a + b).to_string()),
            "minus" => return Some((a - b).to_string()),
            "times" | "multiplied" => return Some((a * b).to_string()),
            _ => {}
        }
    }
    
    None
}

/// Poll the sequencer's RPC for a signed upgrade announcement.
/// This is the fallback when gossipsub doesn't deliver upgrade messages.
/// Returns the full UpgradeAnnouncement (with admin signature) so we can verify locally.
async fn poll_sequencer_for_upgrade(rpc_url: &str) -> anyhow::Result<Option<p2p::UpgradeAnnouncement>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    
    let rpc_payload = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "smithnode_getUpgradeAnnouncement",
        "params": [],
        "id": 1
    });
    
    let response = client.post(rpc_url).json(&rpc_payload).send().await?;
    let body: serde_json::Value = response.json().await?;
    
    if let Some(error) = body.get("error") {
        return Err(anyhow::anyhow!("RPC error: {}", error));
    }
    
    let result = body.get("result");
    if result.is_none() || result == Some(&serde_json::Value::Null) {
        return Ok(None);
    }
    
    let announcement: p2p::UpgradeAnnouncement = serde_json::from_value(result.unwrap().clone())?;
    
    // Verify the admin signature locally — don't trust the sequencer blindly
    if !announcement.verify() {
        tracing::warn!("📡 RPC fallback: upgrade from sequencer failed signature verification");
        return Ok(None);
    }
    
    Ok(Some(announcement))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Init { data_dir } => {
            tracing::info!("Initializing SmithNode at {:?}", data_dir);
            std::fs::create_dir_all(&data_dir)?;
            
            // Create default config
            let config_path = data_dir.join("config.json");
            let default_config = serde_json::json!({
                "rpc_port": 26658,
                "p2p_port": 26656,
                "celestia_rpc": null,
                "validator_key": null
            });
            std::fs::write(&config_path, serde_json::to_string_pretty(&default_config)?)?;
            
            tracing::info!("Node initialized. Config written to {:?}", config_path);
        }

        Commands::Start { data_dir, rpc_bind, p2p_bind, peers } => {
            tracing::info!("🦀 Starting SmithNode...");
            
            // Parse bind addresses
            let rpc_addr: std::net::SocketAddr = rpc_bind.parse()
                .expect("Invalid RPC bind address (use format: 127.0.0.1:26658)");
            let p2p_addr: std::net::SocketAddr = p2p_bind.parse()
                .expect("Invalid P2P bind address (use format: 0.0.0.0:26656)");
            
            // Ensure data directory exists
            std::fs::create_dir_all(&data_dir)?;
            
            // Initialize state with the user-specified data directory
            let state = SmithNodeState::with_data_dir(data_dir.clone());
            
            // Start P2P network with persistent identity
            let (mut network, network_handle, mut event_rx) = SmithNodeNetwork::new_with_data_dir(
                p2p_addr.port(), 
                state.clone(),
                Some(&data_dir)
            ).await?;
            
            // Generate node signing key for turbo block authentication
            let node_keypair_path = data_dir.join("node_key.json");
            let node_signing_key = if std::path::Path::new(&node_keypair_path).exists() {
                let key_data = std::fs::read_to_string(&node_keypair_path)?;
                let key_bytes: Vec<u8> = serde_json::from_str(&key_data)?;
                ed25519_dalek::SigningKey::from_bytes(&key_bytes.try_into().unwrap_or([0u8; 32]))
            } else {
                let mut rng = rand::rngs::OsRng;
                let key = ed25519_dalek::SigningKey::generate(&mut rng);
                let key_bytes = key.to_bytes().to_vec();
                std::fs::write(&node_keypair_path, serde_json::to_string(&key_bytes)?)?;
                key
            };
            let node_pubkey_hex = hex::encode(ed25519_dalek::VerifyingKey::from(&node_signing_key).to_bytes());
            tracing::info!("🔑 Node block signing key: {}...", &node_pubkey_hex[..16]);
            network.set_validator_signer(node_pubkey_hex.clone(), node_signing_key);
            
            // Connect to bootstrap peers
            if !peers.is_empty() {
                tracing::info!("🔗 Connecting to {} bootstrap peers...", peers.len());
                for peer in &peers {
                    tracing::info!("   → {}", peer);
                    if let Err(e) = network_handle.dial_peer(peer).await {
                        tracing::warn!("⚠️ Failed to queue dial to {}: {}", peer, e);
                    }
                }
                
                // Request state sync from peers if we're starting fresh
                if state.get_height() == 0 {
                    tracing::info!("📥 Requesting state sync from peers...");
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await; // Wait for connections
                    if let Err(e) = network_handle.request_state_sync().await {
                        tracing::warn!("⚠️ Failed to request state sync: {}", e);
                    }
                }
            }
            
            // Spawn network event handler
            let state_for_events = state.clone();
            let _network_for_events = network_handle.clone(); // Kept for future AI messaging on mainnet
            let event_handler = tokio::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    match event {
                        p2p::NetworkEvent::ChallengeReceived(msg) => {
                            tracing::debug!("Event: Challenge received for height {}", msg.challenge.height);
                        }
                        p2p::NetworkEvent::ProofReceived(msg) => {
                            tracing::debug!("Event: Proof received from {}", &msg.response.validator_pubkey[..16]);
                        }
                        p2p::NetworkEvent::BlockReceived(msg) => {
                            tracing::debug!("Event: Block {} received", msg.header.height);
                        }
                        p2p::NetworkEvent::PeerConnected(peer_id) => {
                            tracing::info!("📡 Peer connected: {}", peer_id);
                        }
                        p2p::NetworkEvent::PeerDisconnected(peer_id) => {
                            tracing::info!("📴 Peer disconnected: {}", peer_id);
                        }
                        p2p::NetworkEvent::StateReceived(state_msg) => {
                            tracing::info!("📥 Received state from peer: height={}, validators={}, txs={}",
                                state_msg.height, state_msg.validators.len(), state_msg.tx_records.len());
                            
                            // Convert to ValidatorInfo and apply
                            let validators: Vec<stf::ValidatorInfo> = state_msg.validators.iter()
                                .filter_map(|v| {
                                    let pubkey_bytes = hex::decode(&v.public_key).ok()?;
                                    if pubkey_bytes.len() != 32 { return None; }
                                    let mut pubkey = [0u8; 32];
                                    pubkey.copy_from_slice(&pubkey_bytes);
                                    Some(stf::ValidatorInfo {
                                        public_key: pubkey,
                                        balance: v.balance,
                                        validations_count: v.validations_count,
                                        reputation_score: v.reputation_score,
                                        last_active_timestamp: v.last_active_timestamp,
                                        last_validation_height: 0,
                                        is_online: true,
                                        nonce: v.nonce, // Preserve peer's nonce to prevent replay
                                    })
                                })
                                .collect();
                            
                            let state_root_bytes = hex::decode(&state_msg.state_root).unwrap_or_default();
                            let mut state_root = [0u8; 32];
                            if state_root_bytes.len() == 32 {
                                state_root.copy_from_slice(&state_root_bytes);
                            }
                            
                            if state_for_events.apply_peer_state(
                                state_msg.height, 
                                state_root, 
                                state_msg.total_supply, 
                                validators
                            ) {
                                tracing::info!("✅ State synced! Now at height {}", state_msg.height);
                                
                                // Merge tx_records from peer
                                if !state_msg.tx_records.is_empty() {
                                    let tx_records: Vec<stf::TxRecord> = state_msg.tx_records.into_iter()
                                        .map(|tx| stf::TxRecord {
                                            hash: tx.hash,
                                            tx_type: tx.tx_type,
                                            from: tx.from,
                                            to: tx.to,
                                            amount: tx.amount,
                                            status: tx.status,
                                            timestamp: tx.timestamp,
                                            height: tx.height,
                                            validators: tx.validators,
                                            challenge_hash: tx.challenge_hash,
                                        })
                                        .collect();
                                    state_for_events.merge_tx_records(tx_records);
                                }
                            }
                        }
                        p2p::NetworkEvent::StateRequested(peer_id) => {
                            tracing::debug!("Peer {} requested our state", &peer_id[..16.min(peer_id.len())]);
                        }
                        p2p::NetworkEvent::PresenceReceived(presence) => {
                            // P2P heartbeat received - state is already updated in the network handler
                            tracing::trace!("💓 Presence from validator {}...", &presence.validator_pubkey[..16.min(presence.validator_pubkey.len())]);
                        }
                        p2p::NetworkEvent::AIMessageReceived(ai_msg) => {
                            // AI messaging DISABLED on devnet - just log and store
                            // Focus on: Challenges (Proof of Cognition) + Governance (voting)
                            let topic = ai_msg.topic.clone().unwrap_or_else(|| "unknown".to_string());
                            tracing::debug!("📭 AI message received [{}] - storage only (no auto-response on devnet)", topic);
                            
                            // Store for history/debugging but don't auto-respond
                            p2p::store_ai_message(crate::rpc::AIMessageRecord {
                                message_id: ai_msg.message_hash.clone(),
                                from: ai_msg.from_validator.clone(),
                                to: ai_msg.to_validator.clone(),
                                topic: topic.clone(),
                                content: ai_msg.content.clone(),
                                response: ai_msg.response.clone(),
                                ai_provider: ai_msg.ai_provider.clone().unwrap_or_else(|| "none".to_string()),
                                model: ai_msg.model.clone().unwrap_or_else(|| "none".to_string()),
                                timestamp: ai_msg.timestamp,
                                signature: ai_msg.signature.clone(),
                                in_reply_to: ai_msg.in_reply_to.clone(),
                                message_type: ai_msg.message_type.clone(),
                                block_height: None,
                                tx_hash: ai_msg.tx_hash.clone(),
                            });
                            // NOTE: Auto-response DISABLED - validators focus on challenges & governance
                        }
                        p2p::NetworkEvent::RegistrationReceived(reg_msg) => {
                            tracing::info!("📝 Validator registered via P2P: {}...",
                                &reg_msg.public_key[..16.min(reg_msg.public_key.len())]);
                        }
                        p2p::NetworkEvent::GovernanceReceived(gov_msg) => {
                            tracing::info!("📋 Governance event received via P2P: {:?}", gov_msg.action);
                        }
                        p2p::NetworkEvent::TransferReceived(tx_msg) => {
                            tracing::debug!("💸 Transfer received via P2P: {} → {}", &tx_msg.from[..16.min(tx_msg.from.len())], &tx_msg.to[..16.min(tx_msg.to.len())]);
                        }
                    }
                }
            });
            
            // Spawn P2P network
            let p2p_handle = tokio::spawn(async move {
                if let Err(e) = network.run().await {
                    tracing::error!("P2P network error: {}", e);
                }
            });

            // Start RPC server with network handle for broadcasting
            let network_handle_for_rpc = network_handle.clone();
            let (rpc_handle, event_tx) = start_rpc_server(state.clone(), rpc_addr, Some(network_handle_for_rpc)).await?;
            
            // Spawn state broadcaster - sends snapshots every second
            let state_for_broadcast = state.clone();
            let broadcast_handle = tokio::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
                let mut last_height = 0u64;
                let mut last_challenge_hash: Option<String> = None;
                
                loop {
                    interval.tick().await;
                    
                    let current_height = state_for_broadcast.get_height();
                    let current_challenge = state_for_broadcast.get_current_challenge();
                    let current_challenge_hash = current_challenge.as_ref().map(|c| hex::encode(c.challenge_hash));
                    
                    // Broadcast if height or challenge changed, and we have subscribers
                    let height_changed = current_height != last_height;
                    let challenge_changed = current_challenge_hash != last_challenge_hash;
                    
                    if event_tx.receiver_count() > 0 && (height_changed || challenge_changed) {
                        let peer_info = p2p::get_local_peer_info();
                        let status = rpc::NodeStatusResponse {
                            height: current_height,
                            state_root: hex::encode(state_for_broadcast.get_state_root()),
                            total_supply: state_for_broadcast.get_total_supply(),
                            validator_count: state_for_broadcast.get_all_validators().len(),
                            active_validator_count: state_for_broadcast.get_active_validator_count(),
                            has_active_challenge: current_challenge.is_some(),
                            node_version: p2p::SMITH_VERSION.to_string(),
                            peer_id: peer_info.map(|p| p.peer_id.clone()),
                            p2p_multiaddrs: peer_info.map(|p| p.get_multiaddrs()).unwrap_or_default(),
                            bootstrap_peers: p2p::get_bootstrap_peers(),
                        };

                        let validators: Vec<rpc::ValidatorInfoResponse> = state_for_broadcast.get_all_validators()
                            .into_iter()
                            .map(|v| rpc::ValidatorInfoResponse {
                                public_key: hex::encode(v.public_key),
                                balance: v.balance,
                                validations_count: v.validations_count,
                                reputation_score: v.reputation_score,
                                last_active_timestamp: v.last_active_timestamp,
                                is_online: v.is_online,
                                nonce: v.nonce,
                            })
                            .collect();

                        let challenge = current_challenge.map(|c| rpc::ChallengeResponse {
                            challenge_hash: hex::encode(c.challenge_hash),
                            challenge_type: format!("{:?}", c.challenge_type),
                            height: c.height,
                            difficulty: c.difficulty,
                            pending_tx_count: c.pending_tx_hashes.len(),
                            expires_at: c.expires_at,
                            remaining_seconds: c.remaining_time(),
                            cognitive_puzzle: c.cognitive_puzzle.as_ref().map(rpc::puzzle_to_response),
                        });
                        last_challenge_hash = current_challenge_hash;
                    }
                }
            });
            
            // Spawn automatic block producer — TURBO MODE
            // Blocks are produced every 2 seconds WITHOUT waiting for AI puzzles.
            // AI is used for: (1) async P2P liveness challenges, (2) governance reasoning.
            // This makes SmithNode competitive with Solana/Sui block times.
            let state_for_blocks = state.clone();
            let network_for_blocks = network_handle.clone();
            let block_producer_handle = tokio::spawn(async move {
                // Wait for initial startup
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
                
                loop {
                    interval.tick().await;
                    
                    // Tick governance to expire stale proposals
                    state_for_blocks.tick_governance();
                    
                    // Only produce blocks if we have validators
                    let has_validators = state_for_blocks.get_active_validator_count() > 0;
                    
                    if has_validators {
                        // TURBO: Produce block immediately — no puzzle, no waiting
                        let block_info = state_for_blocks.produce_turbo_block();
                        if let Some((height, prev_state_root, state_root, challenge_hash, total_supply)) = block_info {
                            tracing::info!("⚡ Turbo block {} produced (2s)", height);
                            
                            // Broadcast the block via P2P
                            if let Err(e) = network_for_blocks.broadcast_turbo_block(
                                height, prev_state_root, state_root, challenge_hash, total_supply
                            ).await {
                                tracing::warn!("Failed to broadcast turbo block: {}", e);
                            }
                        }
                    }
                }
            });
            
            tracing::info!("✅ Node running - RPC: {}, P2P: {}", rpc_addr, p2p_addr);
            tracing::info!("📡 WebSocket subscriptions available at ws://{}", rpc_addr);
            tracing::info!("⚡ TURBO block production: every 2 seconds");
            tracing::info!("🤖 AI used for: governance reasoning + P2P liveness challenges");
            tracing::info!("🤖 Ready for AI agent validators to connect!");

            // Wait for shutdown
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {
                    tracing::info!("Shutting down...");
                }
                _ = p2p_handle => {}
                _ = event_handler => {}
                _ = broadcast_handle => {}
                _ = block_producer_handle => {}
            }

            rpc_handle.stop()?;
        }

        Commands::Keygen { output } => {
            use ed25519_dalek::SigningKey;
            use rand::RngCore;

            let mut csprng = rand::thread_rng();
            let mut secret_bytes = [0u8; 32];
            csprng.fill_bytes(&mut secret_bytes);
            
            let signing_key = SigningKey::from_bytes(&secret_bytes);
            let verifying_key = signing_key.verifying_key();

            let keypair = serde_json::json!({
                "private_key": hex::encode(signing_key.to_bytes()),
                "public_key": hex::encode(verifying_key.to_bytes()),
            });

            if let Some(path) = output {
                std::fs::write(&path, serde_json::to_string_pretty(&keypair)?)?;
                tracing::info!("Keypair written to {:?}", path);
            } else {
                println!("{}", serde_json::to_string_pretty(&keypair)?);
            }
        }
        
        Commands::AnnounceUpgrade { keypair, version, url, checksum, mandatory, notes, rpc_url } => {
            use ed25519_dalek::{SigningKey, Signer};
            
            tracing::info!("📦 Announcing upgrade v{} to the network...", version);
            
            // Load admin keypair
            let keypair_data: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(&keypair)
                    .map_err(|e| anyhow::anyhow!("Failed to read keypair file: {}", e))?
            )?;
            let private_key_hex = keypair_data["private_key"].as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing private_key in keypair file"))?;
            let public_key_hex = keypair_data["public_key"].as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing public_key in keypair file"))?;
            
            let private_key_bytes: [u8; 32] = hex::decode(private_key_hex)?
                .try_into()
                .map_err(|_| anyhow::anyhow!("Invalid private key length"))?;
            let signing_key = SigningKey::from_bytes(&private_key_bytes);
            
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            
            // Detect platform from URL for the checksum mapping
            let platform = std::env::consts::OS;
            let arch = std::env::consts::ARCH;
            
            let mut download_urls = p2p::UpgradeUrls::default();
            let mut checksums = p2p::UpgradeChecksums::default();
            
            // Map URL and checksum to the correct platform field
            match (platform, arch) {
                ("macos", "aarch64") => {
                    download_urls.darwin_arm64 = Some(url.clone());
                    checksums.darwin_arm64 = Some(checksum.clone());
                }
                ("macos", "x86_64") => {
                    download_urls.darwin_x64 = Some(url.clone());
                    checksums.darwin_x64 = Some(checksum.clone());
                }
                ("linux", "x86_64") => {
                    download_urls.linux_x64 = Some(url.clone());
                    checksums.linux_x64 = Some(checksum.clone());
                }
                ("linux", "aarch64") => {
                    download_urls.linux_arm64 = Some(url.clone());
                    checksums.linux_arm64 = Some(checksum.clone());
                }
                _ => {
                    // Fallback: put it in linux_x64 for Fly.io
                    download_urls.linux_x64 = Some(url.clone());
                    checksums.linux_x64 = Some(checksum.clone());
                }
            }
            
            // Build signature message: version || timestamp || mandatory || checksums
            let mut sign_msg = Vec::new();
            sign_msg.extend_from_slice(version.as_bytes());
            sign_msg.extend_from_slice(&timestamp.to_le_bytes());
            sign_msg.push(if mandatory { 1 } else { 0 });
            if let Some(ref c) = checksums.darwin_arm64 { sign_msg.extend_from_slice(c.as_bytes()); }
            if let Some(ref c) = checksums.darwin_x64 { sign_msg.extend_from_slice(c.as_bytes()); }
            if let Some(ref c) = checksums.linux_x64 { sign_msg.extend_from_slice(c.as_bytes()); }
            if let Some(ref c) = checksums.linux_arm64 { sign_msg.extend_from_slice(c.as_bytes()); }
            if let Some(ref c) = checksums.windows_x64 { sign_msg.extend_from_slice(c.as_bytes()); }
            
            let sig = signing_key.sign(&sign_msg);
            
            let announcement = p2p::UpgradeAnnouncement {
                version: version.clone(),
                download_urls,
                checksums,
                timestamp,
                mandatory,
                release_notes: notes.clone(),
                admin_pubkey: public_key_hex.to_string(),
                signature: hex::encode(sig.to_bytes()),
            };
            
            // Send the announcement to the running node via RPC
            // The node will broadcast it via P2P gossipsub
            let client = reqwest::Client::new();
            let rpc_payload = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "smithnode_announceUpgrade",
                "params": [announcement],
                "id": 1
            });
            
            match client.post(&rpc_url).json(&rpc_payload).send().await {
                Ok(resp) => {
                    let body = resp.text().await.unwrap_or_default();
                    if body.contains("error") {
                        // Fallback: write to a file that the node can pick up
                        let announce_path = std::path::Path::new(".smithnode").join("pending_upgrade.json");
                        std::fs::create_dir_all(".smithnode")?;
                        std::fs::write(&announce_path, serde_json::to_string_pretty(&announcement)?)?;
                        tracing::info!("📦 Upgrade announcement saved to {:?}", announce_path);
                        tracing::info!("   The node will pick it up and broadcast via P2P");
                    } else {
                        tracing::info!("✅ Upgrade v{} announced to network via RPC", version);
                    }
                }
                Err(_) => {
                    // Node may not have the RPC method yet — save to file for manual broadcast
                    let announce_path = std::path::Path::new(".smithnode").join("pending_upgrade.json");
                    std::fs::create_dir_all(".smithnode")?;
                    std::fs::write(&announce_path, serde_json::to_string_pretty(&announcement)?)?;
                    tracing::info!("📦 Upgrade announcement saved to {:?}", announce_path);
                    tracing::info!("   Copy this file to the running node's data dir");
                    tracing::info!("   or broadcast it manually via P2P");
                }
            }
            
            tracing::info!("══════════════════════════════════════════════════");
            tracing::info!("📦 UPGRADE ANNOUNCEMENT");
            tracing::info!("   Version: {}", version);
            tracing::info!("   URL: {}", url);
            tracing::info!("   Checksum: {}", checksum);
            tracing::info!("   Mandatory: {}", mandatory);
            tracing::info!("   Admin: {}...", &public_key_hex[..16]);
            if let Some(ref n) = notes {
                tracing::info!("   Notes: {}", n);
            }
            tracing::info!("══════════════════════════════════════════════════");
        }

        Commands::Validator { data_dir, keypair, p2p_bind, peers, rpc_bind, ai_provider, ai_api_key, ai_model, ai_endpoint, sequencer_rpc } => {
            use ed25519_dalek::{SigningKey, Signer, Signature};
            use sha2::{Sha256, Digest};

            tracing::info!("🤖 Starting SmithNode P2P VALIDATOR...");
            tracing::info!("   This node will participate directly in P2P consensus");
            
            // Load keypair
            let keypair_data: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(&keypair)
                    .map_err(|e| anyhow::anyhow!("Failed to read keypair file: {}", e))?
            )?;
            
            let private_key_hex = keypair_data["private_key"].as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing private_key in keypair file"))?;
            let public_key_hex = keypair_data["public_key"].as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing public_key in keypair file"))?;
            
            let private_key_bytes: [u8; 32] = hex::decode(private_key_hex)?
                .try_into()
                .map_err(|_| anyhow::anyhow!("Invalid private key length"))?;
            let signing_key = SigningKey::from_bytes(&private_key_bytes);
            
            tracing::info!("🔑 Validator public key: {}...", &public_key_hex[..16]);
            
            // Parse addresses
            let p2p_addr: std::net::SocketAddr = p2p_bind.parse()
                .expect("Invalid P2P bind address");
            
            // Ensure data directory exists
            std::fs::create_dir_all(&data_dir)?;
            
            // Initialize state with the user-specified data directory
            let state = SmithNodeState::with_data_dir(data_dir.clone());
            
            // Start P2P network with persistent identity
            let (network, network_handle, mut event_rx) = SmithNodeNetwork::new_with_data_dir(
                p2p_addr.port(), 
                state.clone(),
                Some(&data_dir)
            ).await?;
            
            // Connect to bootstrap peers
            tracing::info!("🔗 Connecting to {} bootstrap peers...", peers.len());
            for peer in &peers {
                tracing::info!("   → {}", peer);
                if let Err(e) = network_handle.dial_peer(peer).await {
                    tracing::warn!("⚠️ Failed to dial {}: {}", peer, e);
                }
            }
            
            // Wait for connections and sync state
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            if state.get_height() == 0 {
                tracing::info!("📥 Requesting state sync from peers...");
                let _ = network_handle.request_state_sync().await;
                // Wait for state sync to complete before doing anything
                for i in 0..10 {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    if state.get_height() > 0 || state.get_all_validators().len() > 0 {
                        tracing::info!("✅ State sync completed after {}s", i + 1);
                        break;
                    }
                }
            }
            
            // Register via P2P gossip broadcast — all nodes apply the same registration
            // This keeps state in sync across the network (no local-only mutation)
            let pubkey_bytes: [u8; 32] = hex::decode(public_key_hex)?.try_into()
                .map_err(|_| anyhow::anyhow!("Invalid public key"))?;
            let already_registered = state.get_validator(public_key_hex).is_some();
            if already_registered {
                tracing::info!("✅ Already registered as validator (via state sync)");
            } else {
                tracing::info!("📝 Registering via P2P broadcast...");
                
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                let mut reg_msg_bytes = Vec::with_capacity(40);
                reg_msg_bytes.extend_from_slice(&pubkey_bytes);
                reg_msg_bytes.extend_from_slice(&timestamp.to_le_bytes());
                let reg_sig: Signature = signing_key.sign(&reg_msg_bytes);
                
                let reg_msg = p2p::RegisterValidatorMessage {
                    public_key: public_key_hex.to_string(),
                    timestamp,
                    signature: hex::encode(reg_sig.to_bytes()),
                };
                
                // Send registration to P2P layer — it will self-register locally
                // and queue for gossip retry if mesh isn't ready yet
                if let Err(e) = network_handle.broadcast_registration(reg_msg).await {
                    tracing::warn!("⚠️ Failed to send registration: {}", e);
                }
                
                // Wait for propagation (P2P layer retries gossip every 3s)
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                if state.get_validator(public_key_hex).is_some() {
                    tracing::info!("✅ Registered as validator (confirmed in state)");
                } else {
                    tracing::warn!("⚠️ Registration may still be propagating via P2P retries...");
                }
            }
            
            // Clone what we need for the validation loop
            let state_for_validator = state.clone();
            let network_handle_for_validator = network_handle.clone();
            let public_key_hex_owned = public_key_hex.to_string();
            let signing_key_clone = signing_key.clone();
            
            // Initialize AI client if configured
            let ai_client: Option<ai::AIClient> = if let Some(ref provider) = ai_provider {
                let config = match provider.to_lowercase().as_str() {
                    "ollama" => {
                        let mut config = ai::AIConfig::ollama(
                            ai_model.as_deref().unwrap_or("llama2")
                        );
                        if let Some(ref endpoint) = ai_endpoint {
                            config.endpoint = Some(endpoint.clone());
                        }
                        config
                    }
                    "openai" => {
                        let key = ai_api_key.as_deref()
                            .expect("--ai-api-key required for OpenAI");
                        let mut config = ai::AIConfig::openai(key);
                        if let Some(ref model) = ai_model {
                            config.model = model.clone();
                        }
                        config
                    }
                    "anthropic" => {
                        let key = ai_api_key.as_deref()
                            .expect("--ai-api-key required for Anthropic");
                        let mut config = ai::AIConfig::anthropic(key);
                        if let Some(ref model) = ai_model {
                            config.model = model.clone();
                        }
                        config
                    }
                    "groq" => {
                        let key = ai_api_key.as_deref()
                            .expect("--ai-api-key required for Groq");
                        let mut config = ai::AIConfig::groq(key);
                        if let Some(ref model) = ai_model {
                            config.model = model.clone();
                        }
                        config
                    }
                    "together" => {
                        let key = ai_api_key.as_deref()
                            .expect("--ai-api-key required for Together");
                        ai::AIConfig {
                            provider: ai::AIProvider::Together,
                            api_key: Some(key.to_string()),
                            model: ai_model.clone().unwrap_or_else(|| "meta-llama/Llama-3-70b-chat-hf".to_string()),
                            endpoint: ai_endpoint.clone(),
                            max_tokens: 1000,
                            temperature: 0.3,
                        }
                    }
                    other => {
                        tracing::error!("❌ Unknown AI provider: '{}'. Supported: ollama, openai, anthropic, groq, together", other);
                        std::process::exit(1);
                    }
                };
                tracing::info!("🧠 AI solver enabled: provider={}, model={}", provider, config.model);
                Some(ai::AIClient::new(config))
            } else {
                tracing::info!("🔧 No AI provider specified. Using built-in deterministic solver.");
                tracing::info!("   Tip: Use --ai-provider ollama --ai-model llama2 for real AI solving");
                None
            };
            
            // Spawn P2P validator loop — TURBO MODE
            // No more puzzle-solving for blocks. Instead:
            // 1. Heartbeats (keep active status for turbo block rewards)
            // 2. Async P2P liveness challenges (prove AI is running)
            let validator_handle = tokio::spawn(async move {
                let mut last_heartbeat = std::time::Instant::now();
                let mut last_liveness_challenge = std::time::Instant::now();
                
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    
                    // Send heartbeat every 15 seconds (faster for turbo mode)
                    if last_heartbeat.elapsed() > std::time::Duration::from_secs(15) {
                        let height = state_for_validator.get_height();
                        let timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs();
                        
                        // Sign presence: pubkey || height || timestamp
                        let mut msg = Vec::with_capacity(48);
                        msg.extend_from_slice(&pubkey_bytes);
                        msg.extend_from_slice(&height.to_le_bytes());
                        msg.extend_from_slice(&timestamp.to_le_bytes());
                        let presence_sig: Signature = signing_key_clone.sign(&msg);
                        
                        let presence = p2p::PresenceMessage {
                            validator_pubkey: public_key_hex_owned.clone(),
                            height,
                            timestamp,
                            version: p2p::SMITH_VERSION.to_string(),
                            signature: hex::encode(presence_sig.to_bytes()),
                        };
                        
                        if let Err(e) = network_handle_for_validator.broadcast_presence(presence).await {
                            tracing::debug!("Failed to broadcast presence: {}", e);
                        } else {
                            tracing::debug!("💓 Heartbeat sent");
                        }
                        last_heartbeat = std::time::Instant::now();
                    }
                    
                    // P2P Liveness Challenge: every 30 seconds, challenge a random peer
                    // This proves AI capability without blocking block production
                    if last_liveness_challenge.elapsed() > std::time::Duration::from_secs(30) {
                        // Pick a random peer to challenge
                        let peers = p2p::get_p2p_validator_tracker().get_online_p2p_validators();
                        let other_peers: Vec<_> = peers.iter()
                            .filter(|p| p.public_key != public_key_hex_owned)
                            .collect();
                        
                        if !other_peers.is_empty() {
                            // Generate a liveness puzzle using AI or built-in
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_secs();
                            
                            // Create a simple challenge seed
                            let challenge_seed: [u8; 32] = {
                                use sha2::{Sha256, Digest};
                                let mut hasher = Sha256::new();
                                hasher.update(b"liveness");
                                hasher.update(&pubkey_bytes);
                                hasher.update(&now.to_le_bytes());
                                hasher.finalize().into()
                            };
                            
                            // Generate puzzle deterministically from seed
                            let puzzle = stf::CognitivePuzzle::generate(&challenge_seed, 1);
                            let puzzle_prompt = puzzle.prompt.clone();
                            
                            // Pick random target
                            let idx = (now as usize) % other_peers.len();
                            let target = &other_peers[idx];
                            
                            // Compute expected answer hash (we'll verify later)
                            let answer_hash = hex::encode::<[u8; 32]>({
                                use sha2::{Sha256, Digest};
                                let mut hasher = Sha256::new();
                                hasher.update(b"liveness_answer");
                                hasher.update(&challenge_seed);
                                hasher.finalize().into()
                            });
                            
                            let challenge_id = hex::encode(&challenge_seed[..16]);
                            
                            // Sign the challenge
                            let mut sig_msg = Vec::new();
                            sig_msg.extend_from_slice(challenge_id.as_bytes());
                            sig_msg.extend_from_slice(target.public_key.as_bytes());
                            let sig: Signature = signing_key_clone.sign(&sig_msg);
                            
                            let challenge = p2p::LivenessChallenge {
                                challenger: public_key_hex_owned.clone(),
                                target: target.public_key.clone(),
                                puzzle_prompt,
                                answer_hash,
                                challenge_id,
                                expires_at: now + 30,
                                signature: hex::encode(sig.to_bytes()),
                            };
                            
                            tracing::info!("🧪 Sending liveness challenge to {}...", 
                                &target.public_key[..16.min(target.public_key.len())]);
                            
                            if let Err(e) = network_handle_for_validator.broadcast_liveness_challenge(challenge).await {
                                tracing::debug!("Failed to send liveness challenge: {}", e);
                            }
                        }
                        
                        last_liveness_challenge = std::time::Instant::now();
                    }
                }
            });
            
            // Spawn network event handler (same as Start command)
            let state_for_events = state.clone();
            let event_handler = tokio::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    match event {
                        p2p::NetworkEvent::ChallengeReceived(msg) => {
                            tracing::debug!("📡 P2P Challenge for height {}", msg.challenge.height);
                        }
                        p2p::NetworkEvent::ProofReceived(msg) => {
                            tracing::debug!("📡 P2P Proof from {}...", &msg.response.validator_pubkey[..16]);
                        }
                        p2p::NetworkEvent::BlockReceived(msg) => {
                            tracing::info!("📡 P2P Block {} received", msg.header.height);
                        }
                        p2p::NetworkEvent::PeerConnected(peer_id) => {
                            tracing::info!("🤝 Peer connected: {}", peer_id);
                        }
                        p2p::NetworkEvent::PeerDisconnected(peer_id) => {
                            tracing::info!("👋 Peer disconnected: {}", peer_id);
                        }
                        p2p::NetworkEvent::StateReceived(state_msg) => {
                            tracing::info!("📥 State sync: height={}", state_msg.height);
                            // Apply state (same as Start command)
                            let validators: Vec<stf::ValidatorInfo> = state_msg.validators.iter()
                                .filter_map(|v| {
                                    let pubkey_bytes = hex::decode(&v.public_key).ok()?;
                                    if pubkey_bytes.len() != 32 { return None; }
                                    let mut pubkey = [0u8; 32];
                                    pubkey.copy_from_slice(&pubkey_bytes);
                                    Some(stf::ValidatorInfo {
                                        public_key: pubkey,
                                        balance: v.balance,
                                        validations_count: v.validations_count,
                                        reputation_score: v.reputation_score,
                                        last_active_timestamp: v.last_active_timestamp,
                                        last_validation_height: 0,
                                        is_online: true,
                                        nonce: v.nonce, // Preserve peer's nonce to prevent replay
                                    })
                                })
                                .collect();
                            
                            let state_root_bytes = hex::decode(&state_msg.state_root).unwrap_or_default();
                            let mut state_root = [0u8; 32];
                            if state_root_bytes.len() == 32 {
                                state_root.copy_from_slice(&state_root_bytes);
                            }
                            
                            if state_for_events.apply_peer_state(state_msg.height, state_root, state_msg.total_supply, validators) {
                                tracing::info!("✅ State synced! Now at height {}", state_msg.height);
                                
                                // M2 fix: Merge tx_records from peer (same as Start command)
                                if !state_msg.tx_records.is_empty() {
                                    let tx_records: Vec<stf::TxRecord> = state_msg.tx_records.into_iter()
                                        .map(|tx| stf::TxRecord {
                                            hash: tx.hash,
                                            tx_type: tx.tx_type,
                                            from: tx.from,
                                            to: tx.to,
                                            amount: tx.amount,
                                            status: tx.status,
                                            timestamp: tx.timestamp,
                                            height: tx.height,
                                            validators: tx.validators,
                                            challenge_hash: tx.challenge_hash,
                                        })
                                        .collect();
                                    state_for_events.merge_tx_records(tx_records);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            });
            
            // Spawn P2P network
            let mut network = network;
            network.set_validator_signer(
                public_key_hex.to_string(),
                signing_key.clone(),
            );
            let p2p_handle = tokio::spawn(async move {
                if let Err(e) = network.run().await {
                    tracing::error!("P2P error: {}", e);
                }
            });
            
            // Clone network_handle for auto-update task before it's consumed by RPC
            let network_handle_for_update = network_handle.clone();
            
            // Optionally start RPC for monitoring
            // L2 fix: Also start state broadcaster when RPC is enabled
            let rpc_handle = if let Some(rpc_addr_str) = rpc_bind {
                let rpc_addr: std::net::SocketAddr = rpc_addr_str.parse()?;
                let (handle, event_tx) = start_rpc_server(state.clone(), rpc_addr, Some(network_handle)).await?;
                tracing::info!("📊 Monitoring RPC: {}", rpc_addr);
                
                // L2 fix: Spawn state broadcaster for validator RPC subscribers
                let state_for_broadcast = state.clone();
                tokio::spawn(async move {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
                    let mut last_height = 0u64;
                    let mut last_challenge_hash: Option<String> = None;
                    
                    loop {
                        interval.tick().await;
                        if event_tx.receiver_count() == 0 { continue; }
                        
                        let current_height = state_for_broadcast.get_height();
                        let current_challenge = state_for_broadcast.get_current_challenge();
                        let current_challenge_hash = current_challenge.as_ref().map(|c| hex::encode(c.challenge_hash));
                        
                        let height_changed = current_height != last_height;
                        let challenge_changed = current_challenge_hash != last_challenge_hash;
                        
                        if height_changed || challenge_changed {
                            let peer_info = p2p::get_local_peer_info();
                            let status = rpc::NodeStatusResponse {
                                height: current_height,
                                state_root: hex::encode(state_for_broadcast.get_state_root()),
                                total_supply: state_for_broadcast.get_total_supply(),
                                validator_count: state_for_broadcast.get_all_validators().len(),
                                active_validator_count: state_for_broadcast.get_active_validator_count(),
                                has_active_challenge: current_challenge.is_some(),
                                node_version: p2p::SMITH_VERSION.to_string(),
                                peer_id: peer_info.map(|p| p.peer_id.clone()),
                                p2p_multiaddrs: peer_info.map(|p| p.get_multiaddrs()).unwrap_or_default(),
                                bootstrap_peers: p2p::get_bootstrap_peers(),
                            };

                            let validators: Vec<rpc::ValidatorInfoResponse> = state_for_broadcast.get_all_validators()
                                .into_iter()
                                .map(|v| rpc::ValidatorInfoResponse {
                                    public_key: hex::encode(v.public_key),
                                    balance: v.balance,
                                    validations_count: v.validations_count,
                                    reputation_score: v.reputation_score,
                                    last_active_timestamp: v.last_active_timestamp,
                                    is_online: v.is_online,
                                    nonce: v.nonce,
                                })
                                .collect();

                            let challenge = current_challenge.map(|c| rpc::ChallengeResponse {
                                challenge_hash: hex::encode(c.challenge_hash),
                                challenge_type: format!("{:?}", c.challenge_type),
                                height: c.height,
                                difficulty: c.difficulty,
                                pending_tx_count: c.pending_tx_hashes.len(),
                                expires_at: c.expires_at,
                                remaining_seconds: c.remaining_time(),
                                cognitive_puzzle: c.cognitive_puzzle.as_ref().map(rpc::puzzle_to_response),
                            });

                            let snapshot = rpc::StateSnapshot {
                                status,
                                validators,
                                challenge,
                                timestamp: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs(),
                            };

                            let _ = event_tx.send(rpc::StateEvent::Snapshot(snapshot));
                            last_height = current_height;
                            last_challenge_hash = current_challenge_hash;
                        }
                    }
                });
                
                Some(handle)
            } else {
                None
            };
            
            tracing::info!("══════════════════════════════════════════════════");
            tracing::info!("✅ P2P VALIDATOR RUNNING");
            tracing::info!("   Mode: True P2P peer (no RPC dependency)");
            tracing::info!("   P2P: {}", p2p_addr);
            tracing::info!("   Validator: {}...", &public_key_hex[..16]);
            tracing::info!("══════════════════════════════════════════════════");

            // Auto-update checker: periodically check for verified upgrades and self-update
            let state_for_update = state.clone();
            let data_dir_for_update = data_dir.clone();
            let p2p_port_for_update = p2p_addr.port();
            let sequencer_rpc_for_update = sequencer_rpc.clone();
            let auto_update_handle = tokio::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
                
                // ── PERSIST applied_version across exec() restarts ──
                let applied_version_file = data_dir_for_update.join("applied_upgrade.txt");
                let mut applied_version: Option<String> = std::fs::read_to_string(&applied_version_file)
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                
                loop {
                    interval.tick().await;
                    
                    let tracker = p2p::get_version_tracker();
                    let mut upgrade_opt = tracker.get_latest_upgrade();
                    
                    // ── RPC FALLBACK: If gossipsub didn't deliver the upgrade, poll sequencer RPC ──
                    if upgrade_opt.is_none() {
                        if let Some(ref rpc_url) = sequencer_rpc_for_update {
                            match poll_sequencer_for_upgrade(rpc_url).await {
                                Ok(Some(upgrade)) => {
                                    tracing::info!("📡 RPC fallback: discovered upgrade v{} from sequencer", upgrade.version);
                                    // Record it in the version tracker so P2P code also knows
                                    tracker.record_upgrade(upgrade.clone());
                                    upgrade_opt = Some(upgrade);
                                }
                                Ok(None) => {
                                    // No upgrade available from sequencer
                                }
                                Err(e) => {
                                    tracing::debug!("📡 RPC fallback poll failed: {}", e);
                                }
                            }
                        }
                    }
                    
                    if let Some(upgrade) = upgrade_opt {
                        // Skip if we already tried this version
                        if applied_version.as_ref() == Some(&upgrade.version) {
                            continue;
                        }
                        
                        // Skip if we're already running this version
                        if upgrade.version == p2p::SMITH_VERSION {
                            continue;
                        }
                        
                        tracing::info!("══════════════════════════════════════════════════");
                        tracing::info!("📦 NEW UPGRADE AVAILABLE: v{}", upgrade.version);
                        if upgrade.mandatory {
                            tracing::warn!("⚠️  This is a MANDATORY upgrade!");
                        }
                        if let Some(ref notes) = upgrade.release_notes {
                            tracing::info!("📝 Release notes: {}", notes);
                        }
                        
                        // ── STAGGERED RESTART ──
                        // Add a random delay (0-30s) so all peers don't restart at once
                        // This keeps the P2P mesh alive during rolling upgrades
                        {
                            use rand::Rng;
                            let jitter_secs: u64 = rand::thread_rng().gen_range(0..30);
                            tracing::info!("⏳ Staggering upgrade by {}s to preserve P2P mesh...", jitter_secs);
                            tokio::time::sleep(tokio::time::Duration::from_secs(jitter_secs)).await;
                        }
                        
                        // Get platform-specific URL and checksum
                        let platform = std::env::consts::OS;
                        let arch = std::env::consts::ARCH;
                        
                        let (download_url, expected_checksum) = match (platform, arch) {
                            ("macos", "aarch64") => (
                                upgrade.download_urls.darwin_arm64.clone(),
                                upgrade.checksums.darwin_arm64.clone(),
                            ),
                            ("macos", "x86_64") => (
                                upgrade.download_urls.darwin_x64.clone(),
                                upgrade.checksums.darwin_x64.clone(),
                            ),
                            ("linux", "x86_64") => (
                                upgrade.download_urls.linux_x64.clone(),
                                upgrade.checksums.linux_x64.clone(),
                            ),
                            ("linux", "aarch64") => (
                                upgrade.download_urls.linux_arm64.clone(),
                                upgrade.checksums.linux_arm64.clone(),
                            ),
                            _ => (None, None),
                        };
                        
                        if let (Some(url), Some(checksum)) = (download_url, expected_checksum) {
                            // ── P2P BINARY RELAY: Try peer seeds first, then HTTP ──
                            let download_key = format!("{}_{}", 
                                match platform { "macos" => "darwin", p => p },
                                match arch { "aarch64" => "arm64", "x86_64" => "x64", a => a }
                            );
                            let peer_seeds = p2p::get_seed_urls(&upgrade.version, &download_key);
                            
                            // Build URL list: peer seeds first (P2P relay), then admin HTTP URL
                            let mut try_urls: Vec<String> = peer_seeds;
                            try_urls.push(url.clone());
                            
                            if try_urls.len() > 1 {
                                tracing::info!("🌱 {} P2P seed(s) available + 1 HTTP source", try_urls.len() - 1);
                            }
                            
                            let mut download_success = false;
                            let mut downloaded_bytes: Option<Vec<u8>> = None;
                            
                            for (i, try_url) in try_urls.iter().enumerate() {
                                let source = if i < try_urls.len() - 1 { "P2P seed" } else { "HTTP" };
                                tracing::info!("⬇️  [{}] Downloading from: {}", source, try_url);
                                
                                match reqwest::get(try_url).await {
                                    Ok(response) if response.status().is_success() => {
                                        match response.bytes().await {
                                            Ok(bytes) => {
                                                // Verify SHA256 checksum
                                                use sha2::{Sha256, Digest};
                                                let mut hasher = Sha256::new();
                                                hasher.update(&bytes);
                                                let computed_checksum = hex::encode(hasher.finalize());
                                                
                                                if computed_checksum != checksum {
                                                    tracing::warn!("⚠️ [{}] Checksum mismatch from {}", source, try_url);
                                                    tracing::warn!("   Expected: {}", checksum);
                                                    tracing::warn!("   Got:      {}", computed_checksum);
                                                    continue; // Try next URL
                                                }
                                                
                                                tracing::info!("✅ Checksum verified via {}: {}", source, &checksum[..16]);
                                                downloaded_bytes = Some(bytes.to_vec());
                                                download_success = true;
                                                break;
                                            }
                                            Err(e) => {
                                                tracing::warn!("⚠️ [{}] Failed to read response: {}", source, e);
                                                continue;
                                            }
                                        }
                                    }
                                    Ok(response) => {
                                        tracing::warn!("⚠️ [{}] HTTP {}", source, response.status());
                                        continue;
                                    }
                                    Err(e) => {
                                        tracing::warn!("⚠️ [{}] Download failed: {}", source, e);
                                        continue;
                                    }
                                }
                            }
                            
                            if !download_success || downloaded_bytes.is_none() {
                                tracing::error!("❌ All download sources failed for v{}", upgrade.version);
                                applied_version = Some(upgrade.version.clone());
                                let _ = std::fs::write(&applied_version_file, &upgrade.version);
                                continue;
                            }
                            
                            let bytes = downloaded_bytes.unwrap();
                            
                            // ── ANNOUNCE AS P2P SEED ──
                            // After successful download, tell peers we have the binary
                            {
                                let seed_announcement = p2p::BinarySeedAnnouncement {
                                    version: upgrade.version.clone(),
                                    platform: download_key.clone(),
                                    // Peers can download from our RPC port (mini binary server)
                                    seed_url: format!("http://127.0.0.1:{}/upgrade-binary", p2p_port_for_update + 10),
                                    checksum: checksum.clone(),
                                    peer_id: p2p::get_local_peer_info()
                                        .map(|p| p.peer_id.clone())
                                        .unwrap_or_default(),
                                    timestamp: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs(),
                                };
                                let _ = network_handle_for_update.broadcast_binary_seed(seed_announcement).await;
                            }
                            
                            // ── FLUSH STATE BEFORE RESTART ──
                            tracing::info!("💾 Flushing state to disk before restart...");
                            if let Err(e) = state_for_update.save() {
                                tracing::error!("❌ Failed to save state before upgrade: {}", e);
                                tracing::error!("   Aborting upgrade to prevent state loss");
                                applied_version = Some(upgrade.version.clone());
                                let _ = std::fs::write(&applied_version_file, &upgrade.version);
                                continue;
                            }
                            tracing::info!("✅ State flushed successfully");
                            
                            // ── PERSIST applied_version BEFORE exec() ──
                            // So after restart, we don't re-download the same version
                            let _ = std::fs::write(&applied_version_file, &upgrade.version);
                            
                            // Get current executable path
                            match std::env::current_exe() {
                                Ok(current_exe) => {
                                    let backup_path = current_exe.with_extension("old");
                                    let new_path = current_exe.with_extension("new");
                                    
                                    // Write new binary to .new file
                                    if let Err(e) = std::fs::write(&new_path, &bytes) {
                                        tracing::error!("❌ Failed to write new binary: {}", e);
                                        applied_version = Some(upgrade.version.clone());
                                        continue;
                                    }
                                    
                                    // Make it executable (Unix)
                                    #[cfg(unix)]
                                    {
                                        use std::os::unix::fs::PermissionsExt;
                                        let _ = std::fs::set_permissions(
                                            &new_path,
                                            std::fs::Permissions::from_mode(0o755),
                                        );
                                    }
                                    
                                    // Atomic swap: current -> .old, .new -> current
                                    if let Err(e) = std::fs::rename(&current_exe, &backup_path) {
                                        tracing::error!("❌ Failed to backup current binary: {}", e);
                                        let _ = std::fs::remove_file(&new_path);
                                        applied_version = Some(upgrade.version.clone());
                                        continue;
                                    }
                                    
                                    if let Err(e) = std::fs::rename(&new_path, &current_exe) {
                                        tracing::error!("❌ Failed to install new binary: {}", e);
                                        // Rollback
                                        let _ = std::fs::rename(&backup_path, &current_exe);
                                        applied_version = Some(upgrade.version.clone());
                                        continue;
                                    }
                                    
                                    tracing::info!("══════════════════════════════════════════════════");
                                    tracing::info!("✅ UPGRADE INSTALLED: v{}", upgrade.version);
                                    tracing::info!("   Binary updated at: {:?}", current_exe);
                                    tracing::info!("   Backup at: {:?}", backup_path);
                                    tracing::info!("   🔄 Restarting node...");
                                    tracing::info!("══════════════════════════════════════════════════");
                                    
                                    // Re-exec ourselves with the same arguments
                                    let args: Vec<String> = std::env::args().collect();
                                    
                                    #[cfg(unix)]
                                    {
                                        use std::os::unix::process::CommandExt;
                                        let err = std::process::Command::new(&current_exe)
                                            .args(&args[1..])
                                            .exec();
                                        // If exec returns, it failed
                                        tracing::error!("❌ Failed to re-exec: {}", err);
                                        // Rollback
                                        let _ = std::fs::rename(&backup_path, &current_exe);
                                    }
                                    
                                    #[cfg(not(unix))]
                                    {
                                        // On non-Unix, just exit and let a process manager restart
                                        tracing::info!("   Please restart the node manually (non-Unix platform)");
                                        std::process::exit(0);
                                    }
                                }
                                Err(e) => {
                                    tracing::error!("❌ Failed to determine current executable: {}", e);
                                }
                            }
                        } else {
                            tracing::info!("ℹ️  No download URL for this platform ({}/{})", platform, arch);
                        }
                        
                        applied_version = Some(upgrade.version.clone());
                        let _ = std::fs::write(&applied_version_file, &upgrade.version);
                        tracing::info!("══════════════════════════════════════════════════");
                    }
                }
            });

            // Wait for shutdown
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {
                    tracing::info!("Shutting down validator...");
                }
                _ = p2p_handle => {}
                _ = event_handler => {}
                _ = validator_handle => {}
                _ = auto_update_handle => {}
            }

            if let Some(h) = rpc_handle {
                h.stop()?;
            }
        }
    }

    Ok(())
}
