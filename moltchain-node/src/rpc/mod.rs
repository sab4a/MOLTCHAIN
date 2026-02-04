//! JSON-RPC Server for Moltchain
//!
//! Exposes APIs for AI agents to:
//! - Subscribe to new blocks
//! - Get current challenge
//! - Submit validation proofs
//! - Query state

use std::sync::Arc;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use jsonrpsee::server::{Server, ServerHandle};
use jsonrpsee::core::{async_trait, RpcResult, SubscriptionResult};
use jsonrpsee::types::ErrorObjectOwned;
use jsonrpsee::proc_macros::rpc;
use jsonrpsee::PendingSubscriptionSink;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, broadcast, RwLock};
use tower_http::cors::{CorsLayer, Any};

use crate::stf::{MoltchainState, MoltTx, TxResult, ChallengeResponse as StfChallengeResponse, TxRecord};
use crate::p2p::NetworkHandle;

// ============ RATE LIMITING ============

/// Rate limiter configuration
const RATE_LIMIT_WINDOW_SECS: u64 = 60;           // 1 minute window
const GLOBAL_RATE_LIMIT: usize = 1000;             // Max 1000 requests per minute per validator
const REGISTER_RATE_LIMIT: usize = 10;             // Max 10 registrations per minute per IP/validator
const CHALLENGE_RATE_LIMIT: usize = 500;           // Max 500 challenge requests per minute (global)
const TRANSFER_RATE_LIMIT: usize = 50;             // Max 50 transfers per minute per sender

/// Rate limit entry tracking request counts
#[derive(Clone, Debug)]
struct RateLimitEntry {
    count: usize,
    window_start: Instant,
}

impl RateLimitEntry {
    fn new() -> Self {
        Self {
            count: 1,
            window_start: Instant::now(),
        }
    }
    
    /// Check if rate limit is exceeded, and increment counter if not
    fn check_and_increment(&mut self, limit: usize) -> bool {
        let now = Instant::now();
        
        // Reset if window has passed
        if now.duration_since(self.window_start) > Duration::from_secs(RATE_LIMIT_WINDOW_SECS) {
            self.count = 1;
            self.window_start = now;
            return true; // Allowed
        }
        
        // Check limit
        if self.count >= limit {
            return false; // Rate limited
        }
        
        self.count += 1;
        true // Allowed
    }
}

/// Rate limiter for RPC requests
#[derive(Clone)]
pub struct RateLimiter {
    /// Tracks: (operation_type, key) -> RateLimitEntry
    /// key can be validator pubkey or IP address
    entries: Arc<RwLock<HashMap<(String, String), RateLimitEntry>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Check if an operation is rate limited
    /// Returns Ok(()) if allowed, Err(message) if rate limited
    pub async fn check(&self, operation: &str, key: &str, limit: usize) -> Result<(), String> {
        let mut entries = self.entries.write().await;
        let cache_key = (operation.to_string(), key.to_string());
        
        let entry = entries.entry(cache_key).or_insert_with(RateLimitEntry::new);
        
        if entry.check_and_increment(limit) {
            Ok(())
        } else {
            Err(format!(
                "Rate limit exceeded for {}: max {} requests per {} seconds",
                operation, limit, RATE_LIMIT_WINDOW_SECS
            ))
        }
    }
    
    /// Cleanup old entries (call periodically)
    pub async fn cleanup(&self) {
        let mut entries = self.entries.write().await;
        let now = Instant::now();
        let window = Duration::from_secs(RATE_LIMIT_WINDOW_SECS * 2);
        
        entries.retain(|_, entry| {
            now.duration_since(entry.window_start) < window
        });
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

/// RPC request/response types
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChallengeResponse {
    pub challenge_hash: String,
    pub challenge_type: String,
    pub height: u64,
    pub difficulty: u8,
    pub pending_tx_count: usize,
    pub expires_at: u64,
    pub remaining_seconds: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubmitProofRequest {
    pub validator_pubkey: String,
    pub challenge_hash: String,
    pub signature: String,
    pub verdict_digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubmitProofResponse {
    pub success: bool,
    pub reward: Option<u64>,
    pub new_balance: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ValidatorInfoResponse {
    pub public_key: String,
    pub balance: u64,
    pub validations_count: u64,
    pub reputation_score: u64,
    pub last_active_timestamp: u64,
    pub is_online: bool,
    pub nonce: u64,                   // Current nonce for transfers (to prevent replay)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeStatusResponse {
    pub height: u64,
    pub state_root: String,
    pub total_supply: u64,
    pub validator_count: usize,
    pub active_validator_count: usize, // Online in last 5 minutes
    pub has_active_challenge: bool,
    pub node_version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegisterValidatorRequest {
    pub public_key: String,
}

/// Heartbeat/presence request - validators announce they're online
/// MUST include signature to prevent impersonation
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PresenceRequest {
    pub validator_pubkey: String,
    /// Signature over (pubkey || height || timestamp) for authentication
    /// If not provided, presence will only update local state (not P2P broadcast)
    pub signature: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PresenceResponse {
    pub success: bool,
    pub active_validators: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    pub from: String,
    pub to: String,
    pub amount: u64,
    pub nonce: u64,             // Sequence number to prevent replay attacks
    pub signature: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferResponse {
    pub success: bool,
    pub tx_hash: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PaginatedTransactionsResponse {
    pub transactions: Vec<TxRecord>,
    pub total: usize,
    pub page: usize,
    pub per_page: usize,
    pub total_pages: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommitteeMemberResponse {
    pub pubkey: String,
    pub submitted_proof: bool,
    pub proof_valid: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommitteeResponse {
    pub block_height: u64,
    pub members: Vec<CommitteeMemberResponse>,
    pub challenge_hash: String,
    pub expires_at: u64,
    pub approvals: usize,
    pub threshold: usize,
    pub finalized: bool,
}

/// Full state snapshot for subscriptions
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub status: NodeStatusResponse,
    pub validators: Vec<ValidatorInfoResponse>,
    pub challenge: Option<ChallengeResponse>,
    pub timestamp: u64,
}

/// Full state export for P2P sync
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FullStateExport {
    pub height: u64,
    pub state_root: String,
    pub total_supply: u64,
    pub validators: Vec<ValidatorInfoResponse>,
    pub node_version: String,
}

/// Node info including P2P peer ID
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeInfoResponse {
    pub node_version: String,
    pub peer_id: Option<String>,
    pub p2p_port: u16,
    pub rpc_port: u16,
    pub height: u64,
    pub validator_count: usize,
}

/// Event types for subscriptions
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum StateEvent {
    #[serde(rename = "snapshot")]
    Snapshot(StateSnapshot),
    #[serde(rename = "block")]
    NewBlock { height: u64, state_root: String },
    #[serde(rename = "challenge")]
    NewChallenge(ChallengeResponse),
    #[serde(rename = "transaction")]
    NewTransaction(TxRecord),
}

/// RPC trait definition
#[rpc(server)]
pub trait MoltchainRpcApi {
    /// Get current node status
    #[method(name = "moltchain_status")]
    async fn status(&self) -> RpcResult<NodeStatusResponse>;
    
    /// Get current cognitive challenge
    #[method(name = "moltchain_getChallenge")]
    async fn get_challenge(&self) -> RpcResult<Option<ChallengeResponse>>;
    
    /// Generate a new challenge (triggers block building)
    #[method(name = "moltchain_newChallenge")]
    async fn new_challenge(&self) -> RpcResult<ChallengeResponse>;
    
    /// Submit a validation proof
    #[method(name = "moltchain_submitProof")]
    async fn submit_proof(&self, req: SubmitProofRequest) -> RpcResult<SubmitProofResponse>;
    
    /// Register as a validator
    #[method(name = "moltchain_registerValidator")]
    async fn register_validator(&self, req: RegisterValidatorRequest) -> RpcResult<SubmitProofResponse>;
    
    /// Send presence/heartbeat (announces validator is online)
    #[method(name = "moltchain_presence")]
    async fn presence(&self, req: PresenceRequest) -> RpcResult<PresenceResponse>;
    
    /// Get validator info
    #[method(name = "moltchain_getValidator")]
    async fn get_validator(&self, pubkey: String) -> RpcResult<Option<ValidatorInfoResponse>>;
    
    /// Get all validators
    #[method(name = "moltchain_getValidators")]
    async fn get_validators(&self) -> RpcResult<Vec<ValidatorInfoResponse>>;

    /// Transfer MOLT tokens
    #[method(name = "moltchain_transfer")]
    async fn transfer(&self, req: TransferRequest) -> RpcResult<TransferResponse>;

    /// Get recent transactions (paginated, optionally filtered by type)
    #[method(name = "moltchain_getTransactions")]
    async fn get_transactions(&self, page: Option<usize>, per_page: Option<usize>, tx_type: Option<String>) -> RpcResult<PaginatedTransactionsResponse>;

    /// Get block/transaction by hash
    #[method(name = "moltchain_getBlock")]
    async fn get_block(&self, hash: String) -> RpcResult<Option<TxRecord>>;

    /// Get current committee info
    #[method(name = "moltchain_getCommittee")]
    async fn get_committee(&self) -> RpcResult<Option<CommitteeResponse>>;

    /// Get full state snapshot (for efficient polling or initial subscription state)
    #[method(name = "moltchain_getState")]
    async fn get_state(&self) -> RpcResult<StateSnapshot>;

    /// Get full state export for P2P sync (validators + balances)
    #[method(name = "moltchain_exportState")]
    async fn export_state(&self) -> RpcResult<FullStateExport>;

    /// Import state from another node (for initial sync)
    #[method(name = "moltchain_importState")]
    async fn import_state(&self, state: FullStateExport) -> RpcResult<SubmitProofResponse>;

    /// Subscribe to state updates
    #[subscription(name = "moltchain_subscribeState" => "moltchain_stateUpdate", unsubscribe = "moltchain_unsubscribeState", item = StateEvent)]
    async fn subscribe_state(&self) -> SubscriptionResult;
}

/// Event broadcaster for real-time updates
pub type EventSender = broadcast::Sender<StateEvent>;

/// RPC server implementation with rate limiting
pub struct MoltchainRpcServerImpl {
    state: Arc<MoltchainState>,
    network: Option<Arc<Mutex<NetworkHandle>>>,
    event_tx: EventSender,
    rate_limiter: RateLimiter,
}

impl MoltchainRpcServerImpl {
    pub fn new(state: MoltchainState, network: Option<NetworkHandle>, event_tx: EventSender) -> Self {
        Self {
            state: Arc::new(state),
            network: network.map(|n| Arc::new(Mutex::new(n))),
            event_tx,
            rate_limiter: RateLimiter::new(),
        }
    }

    fn build_snapshot(&self) -> StateSnapshot {
        let status = NodeStatusResponse {
            height: self.state.get_height(),
            state_root: hex::encode(self.state.get_state_root()),
            total_supply: self.state.get_total_supply(),
            validator_count: self.state.get_all_validators().len(),
            active_validator_count: self.state.get_active_validator_count(),
            has_active_challenge: self.state.get_current_challenge().is_some(),
            node_version: crate::p2p::NODE_VERSION.to_string(),
        };

        let validators: Vec<ValidatorInfoResponse> = self.state.get_all_validators()
            .into_iter()
            .map(|v| ValidatorInfoResponse {
                public_key: hex::encode(v.public_key),
                balance: v.balance,
                validations_count: v.validations_count,
                reputation_score: v.reputation_score,
                last_active_timestamp: v.last_active_timestamp,
                is_online: v.is_online,
                nonce: v.nonce,
            })
            .collect();

        let challenge = self.state.get_current_challenge().map(|c| ChallengeResponse {
            challenge_hash: hex::encode(c.challenge_hash),
            challenge_type: format!("{:?}", c.challenge_type),
            height: c.height,
            difficulty: c.difficulty,
            pending_tx_count: c.pending_tx_hashes.len(),
            expires_at: c.expires_at,
            remaining_seconds: c.remaining_time(),
        });

        StateSnapshot {
            status,
            validators,
            challenge,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }
}

#[async_trait]
impl MoltchainRpcApiServer for MoltchainRpcServerImpl {
    async fn status(&self) -> RpcResult<NodeStatusResponse> {
        Ok(NodeStatusResponse {
            height: self.state.get_height(),
            state_root: hex::encode(self.state.get_state_root()),
            total_supply: self.state.get_total_supply(),
            validator_count: self.state.get_all_validators().len(),
            active_validator_count: self.state.get_active_validator_count(),
            has_active_challenge: self.state.get_current_challenge().is_some(),
            node_version: crate::p2p::NODE_VERSION.to_string(),
        })
    }
    
    async fn get_challenge(&self) -> RpcResult<Option<ChallengeResponse>> {
        Ok(self.state.get_current_challenge().map(|c| ChallengeResponse {
            challenge_hash: hex::encode(c.challenge_hash),
            challenge_type: format!("{:?}", c.challenge_type),
            height: c.height,
            difficulty: c.difficulty,
            pending_tx_count: c.pending_tx_hashes.len(),
            expires_at: c.expires_at,
            remaining_seconds: c.remaining_time(),
        }))
    }
    
    async fn new_challenge(&self) -> RpcResult<ChallengeResponse> {
        // Rate limit challenge generation to prevent spam
        if let Err(e) = self.rate_limiter.check("new_challenge", "global", CHALLENGE_RATE_LIMIT).await {
            return Err(ErrorObjectOwned::owned(-32000, e, None::<()>));
        }
        
        let c = self.state.generate_challenge();
        
        // Broadcast challenge over P2P if network is available
        if let Some(network) = &self.network {
            let network = network.lock().await;
            if let Err(e) = network.broadcast_challenge(c.clone()).await {
                tracing::warn!("Failed to broadcast challenge over P2P: {}", e);
            }
        }
        
        Ok(ChallengeResponse {
            challenge_hash: hex::encode(c.challenge_hash),
            challenge_type: format!("{:?}", c.challenge_type),
            height: c.height,
            difficulty: c.difficulty,
            pending_tx_count: c.pending_tx_hashes.len(),
            expires_at: c.expires_at,
            remaining_seconds: c.remaining_time(),
        })
    }
    
    async fn submit_proof(&self, req: SubmitProofRequest) -> RpcResult<SubmitProofResponse> {
        // Parse hex inputs
        let validator_pubkey: [u8; 32] = match hex::decode(&req.validator_pubkey) {
            Ok(bytes) if bytes.len() == 32 => bytes.try_into().unwrap(),
            _ => return Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Invalid validator pubkey (must be 32 bytes hex)".into()),
            }),
        };
        
        let challenge_hash: [u8; 32] = match hex::decode(&req.challenge_hash) {
            Ok(bytes) if bytes.len() == 32 => bytes.try_into().unwrap(),
            _ => return Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Invalid challenge hash (must be 32 bytes hex)".into()),
            }),
        };
        
        let signature: [u8; 64] = match hex::decode(&req.signature) {
            Ok(bytes) if bytes.len() == 64 => bytes.try_into().unwrap(),
            _ => return Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Invalid signature (must be 64 bytes hex)".into()),
            }),
        };
        
        let verdict_digest: [u8; 32] = match hex::decode(&req.verdict_digest) {
            Ok(bytes) if bytes.len() == 32 => bytes.try_into().unwrap(),
            _ => return Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Invalid verdict digest (must be 32 bytes hex)".into()),
            }),
        };
        
        // Apply the transaction
        let tx = MoltTx::SubmitProof {
            validator_pubkey,
            challenge_hash,
            signature,
            verdict_digest,
        };
        
        match self.state.apply_tx(tx) {
            TxResult::Success { reward, new_balance } => {
                // Broadcast proof over P2P if network is available
                if let Some(network) = &self.network {
                    let proof_response = StfChallengeResponse {
                        challenge_hash: req.challenge_hash.clone(),
                        validator_pubkey: req.validator_pubkey.clone(),
                        signature: req.signature.clone(),
                        verdict_digest: req.verdict_digest.clone(),
                        tx_verdicts: None,
                        puzzle_answer: None,
                        submitted_at_ms: None,
                    };
                    let network = network.lock().await;
                    if let Err(e) = network.broadcast_proof(proof_response).await {
                        tracing::warn!("Failed to broadcast proof over P2P: {}", e);
                    }
                }
                
                Ok(SubmitProofResponse {
                    success: true,
                    reward: Some(reward),
                    new_balance: Some(new_balance),
                    error: None,
                })
            },
            TxResult::BlockFinalized { reward, new_balance, block_height, state_root } => {
                // Broadcast proof AND block over P2P
                if let Some(network) = &self.network {
                    let proof_response = StfChallengeResponse {
                        challenge_hash: req.challenge_hash.clone(),
                        validator_pubkey: req.validator_pubkey.clone(),
                        signature: req.signature.clone(),
                        verdict_digest: req.verdict_digest.clone(),
                        tx_verdicts: None,
                        puzzle_answer: None,
                        submitted_at_ms: None,
                    };
                    
                    let network = network.lock().await;
                    
                    // Broadcast the proof
                    if let Err(e) = network.broadcast_proof(proof_response).await {
                        tracing::warn!("Failed to broadcast proof over P2P: {}", e);
                    }
                    
                    // Broadcast the finalized block
                    let block_header = crate::stf::BlockHeader {
                        height: block_height,
                        prev_state_root: state_root,
                        tx_root: [0u8; 32], // Could compute this properly
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                        challenge_hash: challenge_hash,
                    };
                    
                    if let Err(e) = network.broadcast_block(block_header).await {
                        tracing::warn!("Failed to broadcast block over P2P: {}", e);
                    } else {
                        tracing::info!("📢 Block {} broadcasted to P2P network", block_height);
                    }
                }
                
                Ok(SubmitProofResponse {
                    success: true,
                    reward: Some(reward),
                    new_balance: Some(new_balance),
                    error: None,
                })
            },
            TxResult::Registered { .. } => Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Unexpected registration result".into()),
            }),
            TxResult::ContractDeployed { .. } | TxResult::ContractResult { .. } => Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Unexpected contract result".into()),
            }),
            TxResult::Error(e) => Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some(e),
            }),
        }
    }
    
    async fn register_validator(&self, req: RegisterValidatorRequest) -> RpcResult<SubmitProofResponse> {
        // Rate limit registrations to prevent spam attacks
        if let Err(e) = self.rate_limiter.check("register", &req.public_key, REGISTER_RATE_LIMIT).await {
            return Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some(e),
            });
        }
        
        let public_key: [u8; 32] = match hex::decode(&req.public_key) {
            Ok(bytes) if bytes.len() == 32 => bytes.try_into().unwrap(),
            _ => return Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Invalid public key (must be 32 bytes hex)".into()),
            }),
        };
        
        let tx = MoltTx::RegisterValidator { public_key };
        
        match self.state.apply_tx(tx) {
            TxResult::Success { reward, new_balance } => Ok(SubmitProofResponse {
                success: true,
                reward: Some(reward),
                new_balance: Some(new_balance),
                error: None,
            }),
            TxResult::BlockFinalized { reward, new_balance, .. } => Ok(SubmitProofResponse {
                success: true,
                reward: Some(reward),
                new_balance: Some(new_balance),
                error: None,
            }),
            TxResult::Registered { public_key: _ } => Ok(SubmitProofResponse {
                success: true,
                reward: Some(0),
                new_balance: Some(0),
                error: None,
            }),
            TxResult::ContractDeployed { .. } | TxResult::ContractResult { .. } => Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Unexpected contract result".into()),
            }),
            TxResult::Error(e) => Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some(e),
            }),
        }
    }
    
    async fn presence(&self, req: PresenceRequest) -> RpcResult<PresenceResponse> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let height = self.state.get_height();
        
        // Update validator's presence in local state (always works)
        self.state.update_validator_presence(
            &req.validator_pubkey,
            now,
            height,
        );
        
        // Broadcast presence over P2P only if signature is provided
        if let (Some(network), Some(signature)) = (&self.network, req.signature) {
            // Verify signature before broadcasting
            let presence_msg = crate::p2p::PresenceMessage {
                validator_pubkey: req.validator_pubkey.clone(),
                height,
                timestamp: now,
                version: crate::p2p::NODE_VERSION.to_string(),
                signature,
            };
            
            // Only broadcast if signature is valid
            if presence_msg.verify_signature() {
                let network = network.lock().await;
                if let Err(e) = network.broadcast_presence(presence_msg).await {
                    tracing::debug!("Failed to broadcast presence: {}", e);
                }
            } else {
                tracing::warn!(
                    "⚠️ Invalid presence signature from {}...",
                    &req.validator_pubkey[..16.min(req.validator_pubkey.len())]
                );
            }
        }
        
        Ok(PresenceResponse {
            success: true,
            active_validators: self.state.get_active_validator_count(),
        })
    }
    
    async fn get_validator(&self, pubkey: String) -> RpcResult<Option<ValidatorInfoResponse>> {
        Ok(self.state.get_validator(&pubkey).map(|v| ValidatorInfoResponse {
            public_key: hex::encode(v.public_key),
            balance: v.balance,
            validations_count: v.validations_count,
            reputation_score: v.reputation_score,
            last_active_timestamp: v.last_active_timestamp,
            is_online: v.is_online,
            nonce: v.nonce,
        }))
    }
    
    async fn get_validators(&self) -> RpcResult<Vec<ValidatorInfoResponse>> {
        Ok(self.state.get_all_validators().into_iter().map(|v| ValidatorInfoResponse {
            public_key: hex::encode(v.public_key),
            balance: v.balance,
            validations_count: v.validations_count,
            reputation_score: v.reputation_score,
            last_active_timestamp: v.last_active_timestamp,
            is_online: v.is_online,
            nonce: v.nonce,
        }).collect())
    }

    async fn transfer(&self, req: TransferRequest) -> RpcResult<TransferResponse> {
        // Rate limit transfers per sender
        if let Err(e) = self.rate_limiter.check("transfer", &req.from, TRANSFER_RATE_LIMIT).await {
            return Ok(TransferResponse {
                success: false,
                tx_hash: None,
                error: Some(e),
            });
        }
        
        // Parse hex inputs
        let from: [u8; 32] = match hex::decode(&req.from) {
            Ok(bytes) if bytes.len() == 32 => bytes.try_into().unwrap(),
            _ => return Ok(TransferResponse {
                success: false,
                tx_hash: None,
                error: Some("Invalid 'from' address (must be 32 bytes hex)".into()),
            }),
        };

        let to: [u8; 32] = match hex::decode(&req.to) {
            Ok(bytes) if bytes.len() == 32 => bytes.try_into().unwrap(),
            _ => return Ok(TransferResponse {
                success: false,
                tx_hash: None,
                error: Some("Invalid 'to' address (must be 32 bytes hex)".into()),
            }),
        };

        let signature: [u8; 64] = match hex::decode(&req.signature) {
            Ok(bytes) if bytes.len() == 64 => bytes.try_into().unwrap(),
            _ => return Ok(TransferResponse {
                success: false,
                tx_hash: None,
                error: Some("Invalid signature (must be 64 bytes hex)".into()),
            }),
        };

        // Create and apply the transfer transaction
        let tx = MoltTx::Transfer {
            from,
            to,
            amount: req.amount,
            nonce: req.nonce,
            signature,
        };

        let tx_hash = hex::encode(tx.hash());

        match self.state.apply_tx(tx) {
            TxResult::Success { .. } => {
                tracing::info!(
                    "💸 Transfer: {} MOLT from {}... to {}...",
                    req.amount,
                    &req.from[..16],
                    &req.to[..16]
                );
                Ok(TransferResponse {
                    success: true,
                    tx_hash: Some(tx_hash),
                    error: None,
                })
            }
            TxResult::BlockFinalized { .. } => Ok(TransferResponse {
                success: false,
                tx_hash: None,
                error: Some("Unexpected block finalization from transfer".into()),
            }),
            TxResult::Registered { .. } => Ok(TransferResponse {
                success: false,
                tx_hash: None,
                error: Some("Unexpected registration result".into()),
            }),
            TxResult::ContractDeployed { .. } | TxResult::ContractResult { .. } => Ok(TransferResponse {
                success: false,
                tx_hash: None,
                error: Some("Unexpected contract result".into()),
            }),
            TxResult::Error(e) => Ok(TransferResponse {
                success: false,
                tx_hash: None,
                error: Some(e),
            }),
        }
    }

    async fn get_transactions(&self, page: Option<usize>, per_page: Option<usize>, tx_type: Option<String>) -> RpcResult<PaginatedTransactionsResponse> {
        let page = page.unwrap_or(1).max(1);
        let per_page = per_page.unwrap_or(20).min(100).max(1);
        let filter = tx_type.filter(|t| t != "all");
        let (transactions, total) = self.state.get_transactions_paginated(page, per_page, filter);
        let total_pages = (total + per_page - 1) / per_page.max(1);
        
        Ok(PaginatedTransactionsResponse {
            transactions,
            total,
            page,
            per_page,
            total_pages,
        })
    }

    async fn get_block(&self, hash: String) -> RpcResult<Option<TxRecord>> {
        Ok(self.state.get_transaction_by_hash(&hash))
    }

    async fn get_committee(&self) -> RpcResult<Option<CommitteeResponse>> {
        Ok(self.state.get_committee().map(|c| CommitteeResponse {
            block_height: c.block_height,
            members: c.members.into_iter().map(|m| CommitteeMemberResponse {
                pubkey: m.pubkey,
                submitted_proof: m.submitted_proof,
                proof_valid: m.proof_valid,
            }).collect(),
            challenge_hash: hex::encode(c.challenge_hash),
            expires_at: c.expires_at,
            approvals: c.approvals,
            threshold: c.threshold,
            finalized: c.finalized,
        }))
    }

    async fn get_state(&self) -> RpcResult<StateSnapshot> {
        Ok(self.build_snapshot())
    }

    async fn export_state(&self) -> RpcResult<FullStateExport> {
        let validators: Vec<ValidatorInfoResponse> = self.state.get_all_validators()
            .into_iter()
            .map(|v| ValidatorInfoResponse {
                public_key: hex::encode(v.public_key),
                balance: v.balance,
                validations_count: v.validations_count,
                reputation_score: v.reputation_score,
                last_active_timestamp: v.last_active_timestamp,
                is_online: v.is_online,
                nonce: v.nonce,
            })
            .collect();
        
        Ok(FullStateExport {
            height: self.state.get_height(),
            state_root: hex::encode(self.state.get_state_root()),
            total_supply: self.state.get_total_supply(),
            validators,
            node_version: env!("CARGO_PKG_VERSION").to_string(),
        })
    }

    async fn import_state(&self, state_export: FullStateExport) -> RpcResult<SubmitProofResponse> {
        // Only import if we're behind
        let our_height = self.state.get_height();
        if state_export.height <= our_height {
            return Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some(format!(
                    "Cannot import older state (ours: {}, theirs: {})",
                    our_height, state_export.height
                )),
            });
        }
        
        tracing::info!(
            "📥 Importing state: height {} -> {}, {} validators",
            our_height,
            state_export.height,
            state_export.validators.len()
        );
        
        // Convert validators
        let validators: Vec<crate::stf::ValidatorInfo> = state_export.validators
            .into_iter()
            .filter_map(|v| {
                let pubkey_bytes = hex::decode(&v.public_key).ok()?;
                if pubkey_bytes.len() != 32 { return None; }
                let mut pubkey = [0u8; 32];
                pubkey.copy_from_slice(&pubkey_bytes);
                Some(crate::stf::ValidatorInfo {
                    public_key: pubkey,
                    balance: v.balance,
                    validations_count: v.validations_count,
                    reputation_score: v.reputation_score,
                    last_active_timestamp: v.last_active_timestamp,
                    last_validation_height: 0,
                    is_online: v.is_online,
                    nonce: v.nonce,
                })
            })
            .collect();
        
        // Parse state root
        let state_root_bytes = hex::decode(&state_export.state_root).unwrap_or_default();
        let mut state_root = [0u8; 32];
        if state_root_bytes.len() == 32 {
            state_root.copy_from_slice(&state_root_bytes);
        }
        
        // Apply the state
        if self.state.apply_peer_state(
            state_export.height,
            state_root,
            state_export.total_supply,
            validators,
        ) {
            tracing::info!("✅ State imported successfully! Now at height {}", state_export.height);
            Ok(SubmitProofResponse {
                success: true,
                reward: None,
                new_balance: None,
                error: None,
            })
        } else {
            Ok(SubmitProofResponse {
                success: false,
                reward: None,
                new_balance: None,
                error: Some("Failed to apply state".into()),
            })
        }
    }

    async fn subscribe_state(&self, pending: PendingSubscriptionSink) -> SubscriptionResult {
        let sink = pending.accept().await?;
        let mut rx = self.event_tx.subscribe();
        
        // Send initial snapshot
        let snapshot = self.build_snapshot();
        let _ = sink.send(jsonrpsee::SubscriptionMessage::from_json(&StateEvent::Snapshot(snapshot))?);
        
        // Forward events to subscriber
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        if let Ok(msg) = jsonrpsee::SubscriptionMessage::from_json(&event) {
                            if sink.send(msg).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        
        Ok(())
    }
}

/// Start the RPC server with event broadcasting
pub async fn start_rpc_server(
    state: MoltchainState, 
    addr: std::net::SocketAddr,
    network: Option<NetworkHandle>,
) -> anyhow::Result<(ServerHandle, EventSender)> {
    // Create event broadcast channel
    let (event_tx, _) = broadcast::channel::<StateEvent>(100);
    
    // Configure CORS to allow requests from any origin
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let middleware = tower::ServiceBuilder::new().layer(cors);

    let server = Server::builder()
        .set_middleware(middleware)
        .build(addr)
        .await?;
    
    let rpc_module = MoltchainRpcServerImpl::new(state, network, event_tx.clone()).into_rpc();
    
    let handle = server.start(rpc_module);
    
    tracing::info!("🌐 JSON-RPC server started on http://{}", addr);
    tracing::info!("📡 WebSocket subscriptions available at ws://{}", addr);
    
    Ok((handle, event_tx))
}
