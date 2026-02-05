//! P2P Network Layer for SmithNode
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

use crate::stf::{SmithNodeState, CognitiveChallenge, ChallengeResponse, BlockHeader};

/// Current node version - used for P2P compatibility checks
pub const SMITH_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Topics for gossipsub
const TOPIC_CHALLENGES: &str = "smithnode/challenges/1.0.0";
const TOPIC_PROOFS: &str = "smithnode/proofs/1.0.0";
const TOPIC_BLOCKS: &str = "smithnode/blocks/1.0.0";
const TOPIC_STATE_SYNC: &str = "smithnode/state-sync/1.0.0";
const TOPIC_PRESENCE: &str = "smithnode/presence/1.0.0";
#[allow(dead_code)]
const TOPIC_UPGRADES: &str = "smithnode/upgrades/1.0.0";

/// Heartbeat interval for presence announcements (30 seconds)
pub const PRESENCE_HEARTBEAT_SECS: u64 = 30;
/// Validators are considered offline if no heartbeat in this time (90 seconds = 3 missed heartbeats)  
pub const PRESENCE_TIMEOUT_SECS: u64 = 90;

/// Network behaviour combining gossipsub and mDNS
#[derive(NetworkBehaviour)]
#[behaviour(to_swarm = "SmithNodeBehaviourEvent")]
pub struct SmithNodeBehaviour {
    gossipsub: gossipsub::Behaviour,
    mdns: mdns::tokio::Behaviour,
}

/// Events produced by the network behaviour
#[derive(Debug)]
pub enum SmithNodeBehaviourEvent {
    Gossipsub(gossipsub::Event),
    Mdns(mdns::Event),
}

impl From<gossipsub::Event> for SmithNodeBehaviourEvent {
    fn from(event: gossipsub::Event) -> Self {
        SmithNodeBehaviourEvent::Gossipsub(event)
    }
}

impl From<mdns::Event> for SmithNodeBehaviourEvent {
    fn from(event: mdns::Event) -> Self {
        SmithNodeBehaviourEvent::Mdns(event)
    }
}

/// P2P Message Types - Serializable for network transport
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum P2PMessage {
    /// Broadcast a new challenge to validators
    Challenge(ChallengeMessage),
    /// Submit a proof response
    Proof(ProofMessage),
    /// Broadcast a finalized block
    Block(BlockMessage),
    /// Request state sync from peers
    StateRequest(StateRequestMessage),
    /// Respond with full state snapshot
    StateResponse(StateResponseMessage),
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

/// State sync request - sent by new nodes joining the network
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StateRequestMessage {
    pub requester_peer_id: String,
    pub current_height: u64,  // 0 if starting fresh
}

/// State sync response - full state snapshot from a peer
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StateResponseMessage {
    pub responder_peer_id: String,
    pub height: u64,
    pub state_root: String,
    pub total_supply: u64,
    pub validators: Vec<ValidatorSnapshot>,
    /// Transaction history for full state replication
    #[serde(default)]
    pub tx_records: Vec<TxRecordSnapshot>,
}

/// Transaction record for state sync
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TxRecordSnapshot {
    pub hash: String,
    pub tx_type: String,
    pub from: String,
    pub to: Option<String>,
    pub amount: u64,
    pub status: String,
    pub timestamp: u64,
    pub height: u64,
    pub validators: Option<Vec<String>>,
    pub challenge_hash: Option<String>,
}

/// Validator info for state sync
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ValidatorSnapshot {
    pub public_key: String,
    pub balance: u64,
    pub validations_count: u64,
    pub reputation_score: u64,
    pub last_active_timestamp: u64,
}

/// Presence/Heartbeat message - validators broadcast their presence regularly
/// SIGNED to prevent impersonation attacks
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PresenceMessage {
    /// Validator's public key (hex)
    pub validator_pubkey: String,
    /// Current block height the validator is at
    pub height: u64,
    /// Timestamp of this heartbeat
    pub timestamp: u64,
    /// Node version
    pub version: String,
    /// Signature over (pubkey || height || timestamp) - prevents impersonation
    /// Format: ed25519 signature (64 bytes hex)
    pub signature: String,
}

impl PresenceMessage {
    /// Verify the signature on this presence message
    pub fn verify_signature(&self) -> bool {
        use ed25519_dalek::{Signature, Verifier, VerifyingKey};
        
        // Parse public key
        let pubkey_bytes: [u8; 32] = match hex::decode(&self.validator_pubkey) {
            Ok(bytes) if bytes.len() == 32 => bytes.try_into().unwrap(),
            _ => return false,
        };
        
        let verifying_key = match VerifyingKey::from_bytes(&pubkey_bytes) {
            Ok(k) => k,
            Err(_) => return false,
        };
        
        // Parse signature
        let sig_bytes: [u8; 64] = match hex::decode(&self.signature) {
            Ok(bytes) if bytes.len() == 64 => bytes.try_into().unwrap(),
            _ => return false,
        };
        let signature = Signature::from_bytes(&sig_bytes);
        
        // Build message: pubkey || height || timestamp
        let mut message = Vec::with_capacity(48);
        message.extend_from_slice(&pubkey_bytes);
        message.extend_from_slice(&self.height.to_le_bytes());
        message.extend_from_slice(&self.timestamp.to_le_bytes());
        
        verifying_key.verify(&message, &signature).is_ok()
    }
}

/// Commands that can be sent to the P2P network from other parts of the system
#[derive(Clone, Debug)]
pub enum NetworkCommand {
    BroadcastChallenge(CognitiveChallenge),
    BroadcastProof(ChallengeResponse),
    BroadcastBlock(BlockHeader),
    DialPeer(String),  // Multiaddr as string
    RequestStateSync,  // Request state from peers
    BroadcastState(StateResponseMessage),  // Send state to peers
    BroadcastPresence(PresenceMessage),  // Heartbeat presence announcement
}

/// Events emitted by the P2P network to be handled by state
#[derive(Clone, Debug)]
pub enum NetworkEvent {
    ChallengeReceived(ChallengeMessage),
    ProofReceived(ProofMessage),
    BlockReceived(BlockMessage),
    PeerConnected(String),
    PeerDisconnected(String),
    StateReceived(StateResponseMessage),  // Received state from peer
    StateRequested(String),  // Peer requested our state
    PresenceReceived(PresenceMessage),  // Validator heartbeat received
}

/// The P2P network handler
pub struct SmithNodeNetwork {
    swarm: Swarm<SmithNodeBehaviour>,
    challenge_topic: IdentTopic,
    proof_topic: IdentTopic,
    block_topic: IdentTopic,
    state_sync_topic: IdentTopic,
    presence_topic: IdentTopic,
    local_peer_id: String,
    state: SmithNodeState,
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
    
    /// Request state sync from peers (for new nodes joining)
    pub async fn request_state_sync(&self) -> anyhow::Result<()> {
        self.command_tx.send(NetworkCommand::RequestStateSync).await?;
        Ok(())
    }
    
    /// Broadcast our state to peers
    pub async fn broadcast_state(&self, state: StateResponseMessage) -> anyhow::Result<()> {
        self.command_tx.send(NetworkCommand::BroadcastState(state)).await?;
        Ok(())
    }
    
    /// Broadcast presence/heartbeat
    pub async fn broadcast_presence(&self, presence: PresenceMessage) -> anyhow::Result<()> {
        self.command_tx.send(NetworkCommand::BroadcastPresence(presence)).await?;
        Ok(())
    }
}

impl SmithNodeNetwork {
    pub async fn new(
        port: u16, 
        state: SmithNodeState,
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
        
        // Configure gossipsub for small networks (1-3 nodes)
        // Lower mesh requirements so publishing works with fewer peers
        let gossipsub_config = gossipsub::ConfigBuilder::default()
            .heartbeat_interval(Duration::from_secs(10))
            .validation_mode(gossipsub::ValidationMode::Strict)
            .message_id_fn(message_id_fn)
            // Small network settings - allow publishing with 0 peers
            .mesh_n(2)           // Target 2 peers in mesh (default: 6)
            .mesh_n_low(1)       // Minimum 1 peer before grafting (default: 4)
            .mesh_n_high(4)      // Max 4 peers before pruning (default: 12)
            .mesh_outbound_min(0) // Don't require outbound peers (default: 2)
            .gossip_lazy(2)      // Gossip to 2 peers (default: 6)
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
        
        let behaviour = SmithNodeBehaviour { gossipsub, mdns };
        
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
        let state_sync_topic = IdentTopic::new(TOPIC_STATE_SYNC);
        let presence_topic = IdentTopic::new(TOPIC_PRESENCE);
        
        // Subscribe to topics
        swarm.behaviour_mut().gossipsub.subscribe(&challenge_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&proof_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&block_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&state_sync_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&presence_topic)?;
        
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
            state_sync_topic,
            presence_topic,
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

    async fn handle_swarm_event<E>(&mut self, event: SwarmEvent<SmithNodeBehaviourEvent, E>)
    where E: std::fmt::Debug
    {
        match event {
            SwarmEvent::Behaviour(SmithNodeBehaviourEvent::Mdns(mdns::Event::Discovered(peers))) => {
                for (peer_id, addr) in peers {
                    tracing::info!("🔍 Discovered peer: {} at {}", peer_id, addr);
                    self.swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                    let _ = self.event_tx.send(NetworkEvent::PeerConnected(peer_id.to_string())).await;
                }
            }
            SwarmEvent::Behaviour(SmithNodeBehaviourEvent::Mdns(mdns::Event::Expired(peers))) => {
                for (peer_id, _) in peers {
                    tracing::info!("👋 Peer expired: {}", peer_id);
                    self.swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer_id);
                    let _ = self.event_tx.send(NetworkEvent::PeerDisconnected(peer_id.to_string())).await;
                }
            }
            SwarmEvent::Behaviour(SmithNodeBehaviourEvent::Gossipsub(gossipsub::Event::Message {
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
                    TOPIC_STATE_SYNC => {
                        self.handle_state_sync_message(&message.data).await;
                    }
                    TOPIC_PRESENCE => {
                        self.handle_presence_message(&message.data).await;
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
                            "🏆 Proof verified! Validator {} earned {} SMITH",
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
                        tracing::debug!("P2P broadcast skipped (no peers): {}", e);
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
                        tracing::debug!("P2P broadcast skipped (no peers): {}", e);
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
                        tracing::debug!("P2P broadcast skipped (no peers): {}", e);
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
            NetworkCommand::RequestStateSync => {
                // Request state from peers
                let msg = StateRequestMessage {
                    requester_peer_id: self.local_peer_id.clone(),
                    current_height: self.state.get_height(),
                };
                
                if let Ok(data) = serde_json::to_vec(&msg) {
                    if let Err(e) = self.swarm
                        .behaviour_mut()
                        .gossipsub
                        .publish(self.state_sync_topic.clone(), data)
                    {
                        tracing::debug!("P2P state sync request skipped (no peers): {}", e);
                    } else {
                        tracing::info!("📥 Requested state sync from peers (our height: {})", msg.current_height);
                    }
                }
            }
            NetworkCommand::BroadcastState(state_response) => {
                // Broadcast our state to peers
                if let Ok(data) = serde_json::to_vec(&state_response) {
                    if let Err(e) = self.swarm
                        .behaviour_mut()
                        .gossipsub
                        .publish(self.state_sync_topic.clone(), data)
                    {
                        tracing::debug!("P2P broadcast skipped (no peers): {}", e);
                    } else {
                        tracing::info!("📤 Broadcasted state snapshot (height: {}, {} validators)", 
                            state_response.height, state_response.validators.len());
                    }
                }
            }
            NetworkCommand::BroadcastPresence(presence) => {
                // Broadcast our presence/heartbeat
                if let Ok(data) = serde_json::to_vec(&presence) {
                    if let Err(e) = self.swarm
                        .behaviour_mut()
                        .gossipsub
                        .publish(self.presence_topic.clone(), data)
                    {
                        tracing::debug!("Failed to broadcast presence: {}", e);
                    }
                }
            }
        }
    }
    
    /// Handle state sync messages (requests and responses)
    async fn handle_state_sync_message(&mut self, data: &[u8]) {
        // Try to parse as a request first
        if let Ok(request) = serde_json::from_slice::<StateRequestMessage>(data) {
            // Someone is asking for state - respond if we have higher state
            let our_height = self.state.get_height();
            if our_height > request.current_height {
                tracing::info!("📤 Peer {} requested state (their height: {}, ours: {})",
                    &request.requester_peer_id[..16.min(request.requester_peer_id.len())],
                    request.current_height,
                    our_height
                );
                
                // Build and send state snapshot
                let validators: Vec<ValidatorSnapshot> = self.state.get_all_validators()
                    .into_iter()
                    .map(|v| ValidatorSnapshot {
                        public_key: hex::encode(v.public_key),
                        balance: v.balance,
                        validations_count: v.validations_count,
                        reputation_score: v.reputation_score,
                        last_active_timestamp: v.last_active_timestamp,
                    })
                    .collect();
                
                // Get transaction records (limit to last 1000 for bandwidth)
                let tx_records: Vec<TxRecordSnapshot> = self.state.get_tx_records_for_sync()
                    .into_iter()
                    .map(|tx| TxRecordSnapshot {
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
                
                let response = StateResponseMessage {
                    responder_peer_id: self.local_peer_id.clone(),
                    height: our_height,
                    state_root: hex::encode(self.state.get_state_root()),
                    total_supply: self.state.get_total_supply(),
                    validators,
                    tx_records,
                };
                
                if let Ok(response_data) = serde_json::to_vec(&response) {
                    let _ = self.swarm
                        .behaviour_mut()
                        .gossipsub
                        .publish(self.state_sync_topic.clone(), response_data);
                }
            }
            
            // Emit event
            let _ = self.event_tx.send(NetworkEvent::StateRequested(request.requester_peer_id)).await;
            return;
        }
        
        // Try to parse as a response
        if let Ok(response) = serde_json::from_slice::<StateResponseMessage>(data) {
            let our_height = self.state.get_height();
            
            // Only accept state that's newer than ours
            if response.height > our_height {
                tracing::info!("📥 Received state from peer {} (height: {}, {} validators)",
                    &response.responder_peer_id[..16.min(response.responder_peer_id.len())],
                    response.height,
                    response.validators.len()
                );
                
                // Emit event for external handler to apply state
                let _ = self.event_tx.send(NetworkEvent::StateReceived(response)).await;
            } else {
                tracing::debug!("Ignoring older state from peer (their height: {}, ours: {})",
                    response.height, our_height);
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
    
    /// Broadcast validator presence/heartbeat
    pub fn broadcast_presence(&mut self, data: Vec<u8>) -> anyhow::Result<()> {
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(self.presence_topic.clone(), data)?;
        Ok(())
    }
    
    /// Handle incoming presence/heartbeat message
    /// SECURITY: Verifies signature to prevent impersonation
    async fn handle_presence_message(&mut self, data: &[u8]) {
        match serde_json::from_slice::<PresenceMessage>(data) {
            Ok(presence) => {
                // CRITICAL: Verify signature to prevent impersonation
                if !presence.verify_signature() {
                    tracing::warn!(
                        "⚠️ Rejecting unsigned/invalid presence from {}...",
                        &presence.validator_pubkey[..16.min(presence.validator_pubkey.len())]
                    );
                    return;
                }
                
                // Verify timestamp is recent (within 2 minutes) to prevent replay
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                
                if presence.timestamp > now + 60 || presence.timestamp < now.saturating_sub(120) {
                    tracing::debug!("Rejecting stale presence message (timestamp: {})", presence.timestamp);
                    return;
                }
                
                // Update validator's online status in state
                self.state.update_validator_presence(
                    &presence.validator_pubkey,
                    presence.timestamp,
                    presence.height,
                );
                
                // Emit event for external handlers
                let _ = self.event_tx.send(NetworkEvent::PresenceReceived(presence)).await;
            }
            Err(e) => {
                tracing::debug!("Failed to parse presence message: {}", e);
            }
        }
    }
}
