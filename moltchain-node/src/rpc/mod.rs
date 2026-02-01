//! JSON-RPC Server for Moltchain
//!
//! Exposes APIs for AI agents to:
//! - Subscribe to new blocks
//! - Get current challenge
//! - Submit validation proofs
//! - Query state

use std::sync::Arc;
use jsonrpsee::server::{Server, ServerHandle, RpcModule};
use jsonrpsee::core::{async_trait, RpcResult, SubscriptionResult};
use jsonrpsee::proc_macros::rpc;
use jsonrpsee::PendingSubscriptionSink;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, broadcast};
use tower_http::cors::{CorsLayer, Any};
use futures::StreamExt;

use crate::stf::{MoltchainState, MoltTx, TxResult, ChallengeResponse as StfChallengeResponse, TxRecord};
use crate::p2p::NetworkHandle;

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
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeStatusResponse {
    pub height: u64,
    pub state_root: String,
    pub total_supply: u64,
    pub validator_count: usize,
    pub has_active_challenge: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegisterValidatorRequest {
    pub public_key: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    pub from: String,
    pub to: String,
    pub amount: u64,
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

    /// Get current committee info
    #[method(name = "moltchain_getCommittee")]
    async fn get_committee(&self) -> RpcResult<Option<CommitteeResponse>>;

    /// Get full state snapshot (for efficient polling or initial subscription state)
    #[method(name = "moltchain_getState")]
    async fn get_state(&self) -> RpcResult<StateSnapshot>;

    /// Subscribe to state updates
    #[subscription(name = "moltchain_subscribeState" => "moltchain_stateUpdate", unsubscribe = "moltchain_unsubscribeState", item = StateEvent)]
    async fn subscribe_state(&self) -> SubscriptionResult;
}

/// Event broadcaster for real-time updates
pub type EventSender = broadcast::Sender<StateEvent>;

/// RPC server implementation
pub struct MoltchainRpcServerImpl {
    state: Arc<MoltchainState>,
    network: Option<Arc<Mutex<NetworkHandle>>>,
    event_tx: EventSender,
}

impl MoltchainRpcServerImpl {
    pub fn new(state: MoltchainState, network: Option<NetworkHandle>, event_tx: EventSender) -> Self {
        Self {
            state: Arc::new(state),
            network: network.map(|n| Arc::new(Mutex::new(n))),
            event_tx,
        }
    }

    fn build_snapshot(&self) -> StateSnapshot {
        let status = NodeStatusResponse {
            height: self.state.get_height(),
            state_root: hex::encode(self.state.get_state_root()),
            total_supply: self.state.get_total_supply(),
            validator_count: self.state.get_all_validators().len(),
            has_active_challenge: self.state.get_current_challenge().is_some(),
        };

        let validators: Vec<ValidatorInfoResponse> = self.state.get_all_validators()
            .into_iter()
            .map(|v| ValidatorInfoResponse {
                public_key: hex::encode(v.public_key),
                balance: v.balance,
                validations_count: v.validations_count,
                reputation_score: v.reputation_score,
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
            has_active_challenge: self.state.get_current_challenge().is_some(),
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
            TxResult::Registered { public_key } => Ok(SubmitProofResponse {
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
    
    async fn get_validator(&self, pubkey: String) -> RpcResult<Option<ValidatorInfoResponse>> {
        Ok(self.state.get_validator(&pubkey).map(|v| ValidatorInfoResponse {
            public_key: hex::encode(v.public_key),
            balance: v.balance,
            validations_count: v.validations_count,
            reputation_score: v.reputation_score,
        }))
    }
    
    async fn get_validators(&self) -> RpcResult<Vec<ValidatorInfoResponse>> {
        Ok(self.state.get_all_validators().into_iter().map(|v| ValidatorInfoResponse {
            public_key: hex::encode(v.public_key),
            balance: v.balance,
            validations_count: v.validations_count,
            reputation_score: v.reputation_score,
        }).collect())
    }

    async fn transfer(&self, req: TransferRequest) -> RpcResult<TransferResponse> {
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
    port: u16,
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
        .build(format!("127.0.0.1:{}", port))
        .await?;
    
    let rpc_module = MoltchainRpcServerImpl::new(state, network, event_tx.clone()).into_rpc();
    
    let handle = server.start(rpc_module);
    
    tracing::info!("🌐 JSON-RPC server started on http://127.0.0.1:{}", port);
    tracing::info!("📡 WebSocket subscriptions available at ws://127.0.0.1:{}", port);
    
    Ok((handle, event_tx))
}
