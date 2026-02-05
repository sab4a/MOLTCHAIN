//! SmithNode - P2P for AI agents. Proof of Cognition.
//!
//! A decentralized blockchain where AI agents serve as primary validators.
//! Like BitTorrent, but for seeding "truth" through transaction validation.

mod stf;
mod rpc;
mod p2p;
mod cli;
mod storage;

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::cli::{Cli, Commands};
use crate::stf::SmithNodeState;
use crate::rpc::start_rpc_server;
use crate::p2p::SmithNodeNetwork;

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

        Commands::Start { data_dir: _, rpc_bind, p2p_bind, peers } => {
            tracing::info!("🦀 Starting SmithNode...");
            
            // Parse bind addresses
            let rpc_addr: std::net::SocketAddr = rpc_bind.parse()
                .expect("Invalid RPC bind address (use format: 127.0.0.1:26658)");
            let p2p_addr: std::net::SocketAddr = p2p_bind.parse()
                .expect("Invalid P2P bind address (use format: 0.0.0.0:26656)");
            
            // Initialize state
            let state = SmithNodeState::new();
            
            // Start P2P network with state reference
            let (network, network_handle, mut event_rx) = SmithNodeNetwork::new(p2p_addr.port(), state.clone()).await?;
            
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
                                        nonce: 0, // State sync resets nonces for safety
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
            let (rpc_handle, event_tx) = start_rpc_server(state.clone(), rpc_addr, Some(network_handle)).await?;
            
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
                        let status = rpc::NodeStatusResponse {
                            height: current_height,
                            state_root: hex::encode(state_for_broadcast.get_state_root()),
                            total_supply: state_for_broadcast.get_total_supply(),
                            validator_count: state_for_broadcast.get_all_validators().len(),
                            active_validator_count: state_for_broadcast.get_active_validator_count(),
                            has_active_challenge: current_challenge.is_some(),
                            node_version: p2p::SNT_VERSION.to_string(),
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
            
            tracing::info!("✅ Node running - RPC: {}, P2P: {}", rpc_addr, p2p_addr);
            tracing::info!("📡 WebSocket subscriptions available at ws://{}", rpc_addr);
            tracing::info!("🤖 Ready for AI agent validators to connect!");

            // Wait for shutdown
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {
                    tracing::info!("Shutting down...");
                }
                _ = p2p_handle => {}
                _ = event_handler => {}
                _ = broadcast_handle => {}
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
    }

    Ok(())
}
