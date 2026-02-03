//! Moltchain Node - AI-Validated Sovereign Rollup
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
use crate::stf::MoltchainState;
use crate::rpc::start_rpc_server;
use crate::p2p::MoltchainNetwork;

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
            tracing::info!("Initializing Moltchain node at {:?}", data_dir);
            std::fs::create_dir_all(&data_dir)?;
            
            // Create default config
            let config_path = data_dir.join("config.json");
            let default_config = serde_json::json!({
                "rpc_port": 26658,
                "p2p_port": 26656,
                "celestia_rpc": "http://localhost:26657",
                "validator_key": null
            });
            std::fs::write(&config_path, serde_json::to_string_pretty(&default_config)?)?;
            
            tracing::info!("Node initialized. Config written to {:?}", config_path);
        }

        Commands::Start { data_dir, rpc_bind, p2p_bind, peers } => {
            tracing::info!("🚀 Starting Moltchain node...");
            
            // Parse bind addresses
            let rpc_addr: std::net::SocketAddr = rpc_bind.parse()
                .expect("Invalid RPC bind address (use format: 127.0.0.1:26658)");
            let p2p_addr: std::net::SocketAddr = p2p_bind.parse()
                .expect("Invalid P2P bind address (use format: 0.0.0.0:26656)");
            
            // Initialize state
            let state = MoltchainState::new();
            
            // Start P2P network with state reference
            let (network, network_handle, mut event_rx) = MoltchainNetwork::new(p2p_addr.port(), state.clone()).await?;
            
            // Connect to bootstrap peers
            if !peers.is_empty() {
                tracing::info!("🔗 Connecting to {} bootstrap peers...", peers.len());
                for peer in &peers {
                    tracing::info!("   → {}", peer);
                    if let Err(e) = network_handle.dial_peer(peer).await {
                        tracing::warn!("⚠️ Failed to queue dial to {}: {}", peer, e);
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
