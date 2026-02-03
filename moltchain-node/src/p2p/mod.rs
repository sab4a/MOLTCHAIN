//! P2P Network Layer for Moltchain
//!
//! Uses libp2p to create a decentralized network similar to BitTorrent.
//! Validators gossip challenges and proofs across the network.

use libp2p::{
    futures::StreamExt,
    gossipsub::{self, IdentTopic, MessageAuthenticity},
    mdns,
    noise,
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, Swarm,
};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Duration;
use tokio::sync::mpsc;

use crate::stf::{MoltchainState, CognitiveChallenge, ChallengeResponse, BlockHeader};

/// Topics for gossipsub
const TOPIC_CHALLENGES: &str = "moltchain/challenges/1.0.0";
const TOPIC_PROOFS: &str = "moltchain/proofs/1.0.0";
const TOPIC_BLOCKS: &str = "moltchain/blocks/1.0.0";

/// Network behaviour combining gossipsub and mDNS
#[derive(NetworkBehaviour)]
#[behaviour(to_swarm = "MoltchainBehaviourEvent")]
pub struct MoltchainBehaviour {
    gossipsub: gossipsub::Behaviour,
    mdns: mdns::tokio::Behaviour,
}

/// Events produced by the network behaviour
#[derive(Debug)]
pub enum MoltchainBehaviourEvent {
    Gossipsub(gossipsub::Event),
    Mdns(mdns::Event),
}

impl From<gossipsub::Event> for MoltchainBehaviourEvent {
    fn from(event: gossipsub::Event) -> Self {
        MoltchainBehaviourEvent::Gossipsub(event)
    }
}

impl From<mdns::Event> for MoltchainBehaviourEvent {
    fn from(event: mdns::Event) -> Self {
        MoltchainBehaviourEvent::Mdns(event)
    }
}

/// P2P Message Types - Serializable for network transport
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum P2PMessage {
    /// Broadcast a new challenge to validators
    Challenge(ChallengeMessage),
    /// Submit a proof response
    Proof(ProofMessage),
    /// Broadcast a finalized block
    Block(BlockMessage),
}

/// Challenge broadcast message
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChallengeMessage {
    pub challenge: CognitiveChallenge,
    pub broadcast_height: u64,
    pub broadcaster_peer_id: String,
}

/// Proof submission message  
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProofMessage {
    pub response: ChallengeResponse,
    pub submitted_at: u64,
}

/// Block broadcast message
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlockMessage {
    pub header: BlockHeader,
    pub proof_count: u64,
    pub state_root_hex: String,
}

/// Commands that can be sent to the P2P network from other parts of the system
#[derive(Clone, Debug)]
pub enum NetworkCommand {
    BroadcastChallenge(CognitiveChallenge),
    BroadcastProof(ChallengeResponse),
    BroadcastBlock(BlockHeader),
    DialPeer(String),  // Multiaddr as string
}

/// Events emitted by the P2P network to be handled by state
#[derive(Clone, Debug)]
pub enum NetworkEvent {
    ChallengeReceived(ChallengeMessage),
    ProofReceived(ProofMessage),
    BlockReceived(BlockMessage),
    PeerConnected(String),
    PeerDisconnected(String),
}

/// The P2P network handler
pub struct MoltchainNetwork {
    swarm: Swarm<MoltchainBehaviour>,
    challenge_topic: IdentTopic,
    proof_topic: IdentTopic,
    block_topic: IdentTopic,
    local_peer_id: String,
    state: MoltchainState,
    command_rx: mpsc::Receiver<NetworkCommand>,
    event_tx: mpsc::Sender<NetworkEvent>,
}

/// Handle to send commands to the network
#[derive(Clone)]
pub struct NetworkHandle {
    command_tx: mpsc::Sender<NetworkCommand>,
}

impl NetworkHandle {
    pub async fn broadcast_challenge(&self, challenge: CognitiveChallenge) -> anyhow::Result<()> {
        self.command_tx.send(NetworkCommand::BroadcastChallenge(challenge)).await?;
        Ok(())
    }

    pub async fn broadcast_proof(&self, response: ChallengeResponse) -> anyhow::Result<()> {
        self.command_tx.send(NetworkCommand::BroadcastProof(response)).await?;
        Ok(())
    }

    pub async fn broadcast_block(&self, header: BlockHeader) -> anyhow::Result<()> {
        self.command_tx.send(NetworkCommand::BroadcastBlock(header)).await?;
        Ok(())
    }
    
    /// Dial a peer by multiaddr
    pub async fn dial_peer(&self, addr: &str) -> anyhow::Result<()> {
        self.command_tx.send(NetworkCommand::DialPeer(addr.to_string())).await?;
        Ok(())
    }
}

impl MoltchainNetwork {
    pub async fn new(
        port: u16, 
        state: MoltchainState,
    ) -> anyhow::Result<(Self, NetworkHandle, mpsc::Receiver<NetworkEvent>)> {
        // Generate a random keypair for this node
        let local_key = libp2p::identity::Keypair::generate_ed25519();
        let local_peer_id = PeerId::from(local_key.public());
        
        tracing::info!("🔑 Local peer ID: {}", local_peer_id);
        
        // Configure gossipsub
        let message_id_fn = |message: &gossipsub::Message| {
            let mut hasher = DefaultHasher::new();
            message.data.hash(&mut hasher);
            gossipsub::MessageId::from(hasher.finish().to_string())
        };
        
        let gossipsub_config = gossipsub::ConfigBuilder::default()
            .heartbeat_interval(Duration::from_secs(10))
            .validation_mode(gossipsub::ValidationMode::Strict)
            .message_id_fn(message_id_fn)
            .build()
            .map_err(|e| anyhow::anyhow!("Gossipsub config error: {}", e))?;
        
        let gossipsub = gossipsub::Behaviour::new(
            MessageAuthenticity::Signed(local_key.clone()),
            gossipsub_config,
        )
        .map_err(|e| anyhow::anyhow!("Gossipsub error: {}", e))?;
        
        // Configure mDNS for local peer discovery
        let mdns = mdns::tokio::Behaviour::new(
            mdns::Config::default(),
            local_peer_id,
        )?;
        
        let behaviour = MoltchainBehaviour { gossipsub, mdns };
        
        // Build the swarm with DNS support for resolving hostnames
        let mut swarm = libp2p::SwarmBuilder::with_existing_identity(local_key)
            .with_tokio()
            .with_tcp(
                tcp::Config::default(),
                noise::Config::new,
                yamux::Config::default,
            )?
            .with_dns()?  // Enable DNS resolution for multiaddrs like /dns4/hostname/tcp/port
            .with_behaviour(|_| behaviour)?
            .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
            .build();
        
        // Create topics
        let challenge_topic = IdentTopic::new(TOPIC_CHALLENGES);
        let proof_topic = IdentTopic::new(TOPIC_PROOFS);
        let block_topic = IdentTopic::new(TOPIC_BLOCKS);
        
        // Subscribe to topics
        swarm.behaviour_mut().gossipsub.subscribe(&challenge_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&proof_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&block_topic)?;
        
        // Listen on all interfaces
        let listen_addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{}", port).parse()?;
        swarm.listen_on(listen_addr)?;

        // Create channels for communication
        let (command_tx, command_rx) = mpsc::channel(100);
        let (event_tx, event_rx) = mpsc::channel(100);
        
        let network = Self {
            swarm,
            challenge_topic,
            proof_topic,
            block_topic,
            local_peer_id: local_peer_id.to_string(),
            state,
            command_rx,
            event_tx,
        };

        let handle = NetworkHandle { command_tx };
        
        Ok((network, handle, event_rx))
    }
    
    /// Run the network event loop
    pub async fn run(mut self) -> anyhow::Result<()> {
        tracing::info!("🌐 P2P network starting...");
        
        loop {
            tokio::select! {
                // Handle incoming swarm events
                event = self.swarm.select_next_some() => {
                    self.handle_swarm_event(event).await;
                }
                // Handle outgoing commands
                Some(cmd) = self.command_rx.recv() => {
                    self.handle_command(cmd).await;
                }
            }
        }
    }

    async fn handle_swarm_event<E>(&mut self, event: SwarmEvent<MoltchainBehaviourEvent, E>)
    where E: std::fmt::Debug
    {
        match event {
            SwarmEvent::Behaviour(MoltchainBehaviourEvent::Mdns(mdns::Event::Discovered(peers))) => {
                for (peer_id, addr) in peers {
                    tracing::info!("🔍 Discovered peer: {} at {}", peer_id, addr);
                    self.swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                    let _ = self.event_tx.send(NetworkEvent::PeerConnected(peer_id.to_string())).await;
                }
            }
            SwarmEvent::Behaviour(MoltchainBehaviourEvent::Mdns(mdns::Event::Expired(peers))) => {
                for (peer_id, _) in peers {
                    tracing::info!("👋 Peer expired: {}", peer_id);
                    self.swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer_id);
                    let _ = self.event_tx.send(NetworkEvent::PeerDisconnected(peer_id.to_string())).await;
                }
            }
            SwarmEvent::Behaviour(MoltchainBehaviourEvent::Gossipsub(gossipsub::Event::Message {
                propagation_source,
                message_id,
                message,
            })) => {
                let topic = message.topic.as_str();
                tracing::info!(
                    "📨 Received message on {}: {:?} from {}",
                    topic,
                    message_id,
                    propagation_source
                );
                
                // Handle different message types based on topic
                match topic {
                    TOPIC_CHALLENGES => {
                        self.handle_challenge_message(&message.data).await;
                    }
                    TOPIC_PROOFS => {
                        self.handle_proof_message(&message.data).await;
                    }
                    TOPIC_BLOCKS => {
                        self.handle_block_message(&message.data).await;
                    }
                    _ => {}
                }
            }
            SwarmEvent::NewListenAddr { address, .. } => {
                tracing::info!("📡 Listening on {}", address);
            }
            SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                tracing::info!("🤝 Connected to peer: {}", peer_id);
            }
            SwarmEvent::ConnectionClosed { peer_id, .. } => {
                tracing::info!("👋 Disconnected from peer: {}", peer_id);
            }
            _ => {}
        }
    }

    async fn handle_challenge_message(&mut self, data: &[u8]) {
        match serde_json::from_slice::<ChallengeMessage>(data) {
            Ok(msg) => {
                tracing::info!(
                    "🎯 New challenge received: height={}, type={:?}, expires_at={}",
                    msg.challenge.height,
                    msg.challenge.challenge_type,
                    msg.challenge.expires_at
                );
                
                // Check if challenge is still valid
                if msg.challenge.is_expired() {
                    tracing::warn!("⚠️ Received expired challenge, ignoring");
                    return;
                }
                
                // Update local state with the new challenge if it's newer
                let current = self.state.get_current_challenge();
                let should_update = match &current {
                    None => true,
                    Some(existing) => msg.challenge.height > existing.height,
                };
                
                if should_update {
                    self.state.set_current_challenge(msg.challenge.clone());
                    tracing::info!(
                        "✅ Challenge accepted: {} pending txs to validate",
                        msg.challenge.pending_tx_hashes.len()
                    );
                }
                
                // Emit event for external handlers
                let _ = self.event_tx.send(NetworkEvent::ChallengeReceived(msg)).await;
            }
            Err(e) => {
                tracing::error!("❌ Failed to parse challenge message: {}", e);
            }
        }
    }

    async fn handle_proof_message(&mut self, data: &[u8]) {
        match serde_json::from_slice::<ProofMessage>(data) {
            Ok(msg) => {
                tracing::info!(
                    "✅ Proof submission received from validator: {}",
                    &msg.response.validator_pubkey[..16]
                );
                
                // Verify the proof signature and apply to state
                match self.state.verify_and_apply_proof(&msg.response) {
                    Ok(result) => {
                        tracing::info!(
                            "🏆 Proof verified! Validator {} earned {} MOLT",
                            &msg.response.validator_pubkey[..16],
                            result.reward
                        );
                    }
                    Err(e) => {
                        tracing::warn!("⚠️ Proof verification failed: {}", e);
                    }
                }
                
                // Emit event
                let _ = self.event_tx.send(NetworkEvent::ProofReceived(msg)).await;
            }
            Err(e) => {
                tracing::error!("❌ Failed to parse proof message: {}", e);
            }
        }
    }

    async fn handle_block_message(&mut self, data: &[u8]) {
        match serde_json::from_slice::<BlockMessage>(data) {
            Ok(msg) => {
                tracing::info!(
                    "📦 New block received: height={}, proofs={}, state_root={}",
                    msg.header.height,
                    msg.proof_count,
                    &msg.state_root_hex[..16]
                );
                
                // Verify block header and update state
                let current_height = self.state.get_height();
                if msg.header.height <= current_height {
                    tracing::warn!(
                        "⚠️ Received old block (height {}), current height is {}",
                        msg.header.height,
                        current_height
                    );
                    return;
                }
                
                // Apply block to state
                if let Err(e) = self.state.apply_block(&msg.header) {
                    tracing::error!("❌ Failed to apply block: {}", e);
                } else {
                    tracing::info!("✅ Block {} applied successfully", msg.header.height);
                }
                
                // Emit event
                let _ = self.event_tx.send(NetworkEvent::BlockReceived(msg)).await;
            }
            Err(e) => {
                tracing::error!("❌ Failed to parse block message: {}", e);
            }
        }
    }

    async fn handle_command(&mut self, cmd: NetworkCommand) {
        match cmd {
            NetworkCommand::BroadcastChallenge(challenge) => {
                let msg = ChallengeMessage {
                    challenge,
                    broadcast_height: self.state.get_height(),
                    broadcaster_peer_id: self.local_peer_id.clone(),
                };
                
                if let Ok(data) = serde_json::to_vec(&msg) {
                    if let Err(e) = self.swarm
                        .behaviour_mut()
                        .gossipsub
                        .publish(self.challenge_topic.clone(), data) 
                    {
                        tracing::error!("Failed to broadcast challenge: {}", e);
                    } else {
                        tracing::info!("📢 Broadcasted challenge for height {}", msg.broadcast_height);
                    }
                }
            }
            NetworkCommand::BroadcastProof(response) => {
                let msg = ProofMessage {
                    response,
                    submitted_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs(),
                };
                
                if let Ok(data) = serde_json::to_vec(&msg) {
                    if let Err(e) = self.swarm
                        .behaviour_mut()
                        .gossipsub
                        .publish(self.proof_topic.clone(), data)
                    {
                        tracing::error!("Failed to broadcast proof: {}", e);
                    } else {
                        tracing::info!("📢 Broadcasted proof submission");
                    }
                }
            }
            NetworkCommand::BroadcastBlock(header) => {
                let msg = BlockMessage {
                    header: header.clone(),
                    proof_count: self.state.get_pending_proof_count(),
                    state_root_hex: hex::encode(header.prev_state_root),
                };
                
                if let Ok(data) = serde_json::to_vec(&msg) {
                    if let Err(e) = self.swarm
                        .behaviour_mut()
                        .gossipsub
                        .publish(self.block_topic.clone(), data)
                    {
                        tracing::error!("Failed to broadcast block: {}", e);
                    } else {
                        tracing::info!("📢 Broadcasted new block {}", header.height);
                    }
                }
            }
            NetworkCommand::DialPeer(addr_str) => {
                match addr_str.parse::<Multiaddr>() {
                    Ok(addr) => {
                        tracing::info!("🔗 Dialing peer: {}", addr);
                        match self.swarm.dial(addr.clone()) {
                            Ok(_) => {
                                tracing::info!("📞 Dial initiated to {}", addr);
                            }
                            Err(e) => {
                                tracing::error!("❌ Failed to dial {}: {}", addr, e);
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("❌ Invalid multiaddr '{}': {}", addr_str, e);
                    }
                }
            }
        }
    }
    
    /// Broadcast a new challenge to the network
    pub fn broadcast_challenge(&mut self, data: Vec<u8>) -> anyhow::Result<()> {
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(self.challenge_topic.clone(), data)?;
        Ok(())
    }
    
    /// Broadcast a proof submission
    pub fn broadcast_proof(&mut self, data: Vec<u8>) -> anyhow::Result<()> {
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(self.proof_topic.clone(), data)?;
        Ok(())
    }
    
    /// Broadcast a new block
    pub fn broadcast_block(&mut self, data: Vec<u8>) -> anyhow::Result<()> {
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(self.block_topic.clone(), data)?;
        Ok(())
    }
}
