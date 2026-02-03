//! Moltchain State Management
//!
//! Core state structure holding balances, challenges, and validator info.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::path::PathBuf;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

use super::transaction::{MoltTx, TxResult};
use super::challenge::{CognitiveChallenge, ChallengeType, CognitivePuzzle};
use crate::storage::{Storage, PersistedState};

/// Active validator threshold - validators must have been active within this time to be considered online
const ACTIVE_THRESHOLD_SECS: u64 = 300; // 5 minutes

/// Validator information
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ValidatorInfo {
    pub public_key: [u8; 32],
    pub balance: u64,
    pub validations_count: u64,
    pub reputation_score: u64,
    pub last_validation_height: u64,
    #[serde(default)]
    pub last_active_timestamp: u64, // Unix timestamp of last activity
    #[serde(default)]
    pub is_online: bool,            // Considered online if active in last 5 minutes
}

/// Transaction record for history
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TxRecord {
    pub hash: String,
    pub tx_type: String,
    pub from: String,
    pub to: Option<String>,
    pub amount: u64,
    pub status: String,
    pub timestamp: u64,
    pub height: u64,
}

/// Block header for the rollup
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlockHeader {
    pub height: u64,
    pub prev_state_root: [u8; 32],
    pub tx_root: [u8; 32],
    pub timestamp: u64,
    pub challenge_hash: [u8; 32],
}

/// Committee member for block validation
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommitteeMember {
    pub pubkey: String,
    pub submitted_proof: bool,
    pub proof_valid: bool,
}

/// Block committee - validators selected to validate a block
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlockCommittee {
    pub block_height: u64,
    pub members: Vec<CommitteeMember>,
    pub challenge_hash: [u8; 32],
    pub created_at: u64,
    pub expires_at: u64,
    pub finalized: bool,
    pub approvals: usize,
    pub threshold: usize, // 2/3 of committee must approve
}

/// The core state of Moltchain
#[derive(Clone)]
pub struct MoltchainState {
    inner: Arc<RwLock<StateInner>>,
    storage: Arc<Storage>,
}

struct StateInner {
    /// Mapping: public_key_hex -> ValidatorInfo
    validators: HashMap<String, ValidatorInfo>,
    
    /// Current block height
    height: u64,
    
    /// Current state root (Merkle root of state)
    state_root: [u8; 32],
    
    /// Current active challenge
    current_challenge: Option<CognitiveChallenge>,
    
    /// Current block committee
    current_committee: Option<BlockCommittee>,
    
    /// Transaction history (for simplicity, in-memory)
    tx_history: Vec<MoltTx>,
    
    /// Transaction records with metadata
    tx_records: Vec<TxRecord>,
    
    /// Pending transactions for next block
    pending_txs: Vec<MoltTx>,
    
    /// Total token supply
    total_supply: u64,
    
    /// Reward per valid proof submission
    reward_per_proof: u64,
    
    /// Committee size (how many validators per block)
    committee_size: usize,
}

impl MoltchainState {
    pub fn new() -> Self {
        Self::with_data_dir(Storage::default_data_dir())
    }

    pub fn with_data_dir(data_dir: PathBuf) -> Self {
        let storage = Arc::new(Storage::new(data_dir));
        
        // Try to load existing state
        let persisted = storage.load_state();
        
        let inner = if let Some(state) = persisted {
            tracing::info!("📊 Restored state: {} validators, {} transactions, height {}", 
                state.validators.len(), state.tx_records.len(), state.height);
            StateInner {
                validators: state.validators,
                height: state.height,
                state_root: state.state_root,
                current_challenge: None,
                current_committee: None,
                tx_history: Vec::new(),
                tx_records: state.tx_records,
                pending_txs: Vec::new(),
                total_supply: state.total_supply,
                reward_per_proof: 100,
                committee_size: 5, // 5 validators per committee
            }
        } else {
            StateInner {
                validators: HashMap::new(),
                height: 0,
                state_root: [0u8; 32],
                current_challenge: None,
                current_committee: None,
                tx_history: Vec::new(),
                tx_records: Vec::new(),
                pending_txs: Vec::new(),
                total_supply: 0,
                reward_per_proof: 100,
                committee_size: 5, // 5 validators per committee
            }
        };

        Self {
            inner: Arc::new(RwLock::new(inner)),
            storage,
        }
    }

    /// Persist current state to disk
    pub fn save(&self) -> anyhow::Result<()> {
        let inner = self.inner.read().unwrap();
        let persisted = PersistedState {
            validators: inner.validators.clone(),
            height: inner.height,
            state_root: inner.state_root,
            tx_records: inner.tx_records.clone(),
            total_supply: inner.total_supply,
        };
        self.storage.save_state(&persisted)
    }

    /// Select committee members based on reputation-weighted random selection
    /// ONLY selects from ACTIVE validators (online in last 5 minutes)
    fn select_committee(&self, inner: &StateInner, seed: &[u8; 32]) -> Vec<String> {
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Filter to only ACTIVE validators (online in last 5 minutes)
        let validators: Vec<_> = inner.validators.iter()
            .filter(|(_, v)| {
                let time_since_active = current_time.saturating_sub(v.last_active_timestamp);
                time_since_active <= ACTIVE_THRESHOLD_SECS
            })
            .collect();
        
        if validators.is_empty() {
            tracing::warn!("⚠️ No active validators available for committee selection!");
            return Vec::new();
        }
        
        tracing::info!("🤖 Selecting committee from {} ACTIVE validators", validators.len());
        
        // Calculate total reputation weight from active validators only
        let total_weight: u64 = validators.iter()
            .map(|(_, v)| v.reputation_score.max(1))
            .sum();
        
        if total_weight == 0 {
            return Vec::new();
        }
        
        // Select committee_size members (or all if fewer validators)
        let committee_size = inner.committee_size.min(validators.len());
        let mut selected: Vec<String> = Vec::with_capacity(committee_size);
        let mut used_indices: std::collections::HashSet<usize> = std::collections::HashSet::new();
        
        // Use seed for deterministic random selection
        let mut rng_state = u64::from_le_bytes(seed[0..8].try_into().unwrap());
        
        for _ in 0..committee_size {
            // Simple LCG random number generator
            rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
            let rand_val = rng_state % total_weight;
            
            // Find validator based on weighted selection
            let mut cumulative: u64 = 0;
            for (idx, (pubkey, validator)) in validators.iter().enumerate() {
                if used_indices.contains(&idx) {
                    continue;
                }
                cumulative += validator.reputation_score.max(1);
                if cumulative > rand_val {
                    selected.push(pubkey.to_string());
                    used_indices.insert(idx);
                    break;
                }
            }
        }
        
        selected
    }

    /// Generate a new cognitive challenge with committee selection
    pub fn generate_challenge(&self) -> CognitiveChallenge {
        let mut inner = self.inner.write().unwrap();
        
        // Create challenge hash from current state
        let mut hasher = Sha256::new();
        hasher.update(&inner.state_root);
        hasher.update(&inner.height.to_le_bytes());
        hasher.update(&std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_le_bytes());
        
        let challenge_hash: [u8; 32] = hasher.finalize().into();
        
        // Select committee for this block
        let committee_members = self.select_committee(&inner, &challenge_hash);
        let committee_size = committee_members.len();
        let threshold = if committee_size > 0 { (committee_size * 2 / 3).max(1) } else { 1 };
        
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Create committee
        let committee = BlockCommittee {
            block_height: inner.height + 1,
            members: committee_members.iter().map(|pk| CommitteeMember {
                pubkey: pk.clone(),
                submitted_proof: false,
                proof_valid: false,
            }).collect(),
            challenge_hash,
            created_at: now,
            expires_at: now + 60, // 60 second window
            finalized: false,
            approvals: 0,
            threshold,
        };
        
        if !committee.members.is_empty() {
            tracing::info!(
                "👥 Committee selected for block {}: {} members, threshold: {}/{}",
                committee.block_height,
                committee.members.len(),
                threshold,
                committee.members.len()
            );
            for member in &committee.members {
                tracing::debug!("   - {}...", &member.pubkey[..16]);
            }
        }
        
        inner.current_committee = Some(committee);
        
        // Generate a cognitive puzzle for this challenge
        let puzzle = CognitivePuzzle::generate(&challenge_hash, 1);
        
        tracing::info!(
            "🧠 Cognitive puzzle generated: {:?} - '{}'",
            puzzle.puzzle_type,
            &puzzle.prompt[..50.min(puzzle.prompt.len())]
        );
        
        // Create a transaction verification challenge with cognitive puzzle
        let challenge = CognitiveChallenge {
            challenge_type: ChallengeType::TransactionVerification,
            challenge_hash,
            height: inner.height,
            difficulty: 1, // Base difficulty
            pending_tx_hashes: inner.pending_txs.iter()
                .map(|tx| tx.hash())
                .collect(),
            created_at: now,
            expires_at: now + 60, // 60 second window
            cognitive_puzzle: Some(puzzle),
        };
        
        inner.current_challenge = Some(challenge.clone());
        challenge
    }

    /// Get current committee info
    pub fn get_committee(&self) -> Option<BlockCommittee> {
        self.inner.read().unwrap().current_committee.clone()
    }

    /// Check if a validator is in the current committee
    pub fn is_in_committee(&self, pubkey_hex: &str) -> bool {
        let inner = self.inner.read().unwrap();
        if let Some(ref committee) = inner.current_committee {
            return committee.members.iter().any(|m| m.pubkey == pubkey_hex);
        }
        false
    }

    /// Get the current active challenge
    pub fn get_current_challenge(&self) -> Option<CognitiveChallenge> {
        self.inner.read().unwrap().current_challenge.clone()
    }

    /// Apply a transaction to the state
    pub fn apply_tx(&self, tx: MoltTx) -> TxResult {
        let result = match tx {
            MoltTx::SubmitProof {
                ref validator_pubkey,
                ref challenge_hash,
                ref signature,
                ref verdict_digest,
            } => {
                self.process_proof_submission(
                    validator_pubkey,
                    challenge_hash,
                    signature,
                    verdict_digest,
                )
            }
            MoltTx::Transfer {
                ref from,
                ref to,
                amount,
                ref signature,
            } => {
                self.process_transfer(from, to, amount, signature)
            }
            MoltTx::RegisterValidator { ref public_key } => {
                self.register_validator(public_key)
            }
            // Smart contract transactions - not implemented yet
            MoltTx::DeployContract { .. } => {
                TxResult::Error("Smart contracts not yet implemented".into())
            }
            MoltTx::CallContract { .. } => {
                TxResult::Error("Smart contracts not yet implemented".into())
            }
        };

        // Auto-save after successful transactions
        if result.is_success() {
            if let Err(e) = self.save() {
                tracing::warn!("Failed to persist state: {}", e);
            }
        }

        result
    }

    /// Process a proof submission from an AI validator
    fn process_proof_submission(
        &self,
        validator_pubkey: &[u8; 32],
        challenge_hash: &[u8; 32],
        signature: &[u8; 64],
        verdict_digest: &[u8; 32],
    ) -> TxResult {
        let mut inner = self.inner.write().unwrap();
        
        let pubkey_hex = hex::encode(validator_pubkey);
        
        // 1. Verify the challenge exists and matches
        let current_challenge = match &inner.current_challenge {
            Some(c) => c.clone(),
            None => return TxResult::Error("No active challenge".into()),
        };
        
        if &current_challenge.challenge_hash != challenge_hash {
            return TxResult::Error("Challenge hash mismatch".into());
        }
        
        // 2. Check if validator is in current committee (if committee exists)
        let committee_mode = inner.current_committee.is_some() && 
            inner.current_committee.as_ref().unwrap().members.len() > 1;
        
        if committee_mode {
            let committee = inner.current_committee.as_ref().unwrap();
            let is_member = committee.members.iter().any(|m| m.pubkey == pubkey_hex);
            
            if !is_member {
                return TxResult::Error(format!(
                    "Validator {} not in committee for block {}",
                    &pubkey_hex[..16],
                    committee.block_height
                ));
            }
            
            // Check if already submitted
            let already_submitted = committee.members.iter()
                .find(|m| m.pubkey == pubkey_hex)
                .map(|m| m.submitted_proof)
                .unwrap_or(false);
            
            if already_submitted {
                return TxResult::Error("Validator already submitted proof for this block".into());
            }
        }
        
        // 3. Verify the signature
        let verifying_key = match VerifyingKey::from_bytes(validator_pubkey) {
            Ok(k) => k,
            Err(_) => return TxResult::Error("Invalid public key".into()),
        };
        
        // Message is: challenge_hash || verdict_digest
        let mut message = Vec::with_capacity(64);
        message.extend_from_slice(challenge_hash);
        message.extend_from_slice(verdict_digest);
        
        let sig = Signature::from_bytes(signature);
        
        if verifying_key.verify(&message, &sig).is_err() {
            return TxResult::Error("Signature verification failed".into());
        }
        
        // 4. Update committee member status
        let mut should_finalize = false;
        let mut committee_approvals = 0;
        let mut committee_threshold = 1;
        let mut committee_members_count = 1;
        
        if committee_mode {
            let committee = inner.current_committee.as_mut().unwrap();
            
            // Mark this validator as having submitted
            if let Some(member) = committee.members.iter_mut().find(|m| m.pubkey == pubkey_hex) {
                member.submitted_proof = true;
                member.proof_valid = true;
            }
            
            committee.approvals += 1;
            committee_approvals = committee.approvals;
            committee_threshold = committee.threshold;
            committee_members_count = committee.members.len();
            
            tracing::info!(
                "✅ Validator {}... approved block {} ({}/{})",
                &pubkey_hex[..16],
                committee.block_height,
                committee.approvals,
                committee.threshold
            );
            
            // Check if threshold reached
            if committee.approvals >= committee.threshold && !committee.finalized {
                should_finalize = true;
                committee.finalized = true;
            }
        } else {
            // Single validator mode (backwards compatible for < committee_size validators)
            should_finalize = true;
        }
        
        // 5. Update validator stats (always, even if block not finalized yet)
        let height = inner.height;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let validator = inner.validators
            .entry(pubkey_hex.clone())
            .or_insert_with(|| ValidatorInfo {
                public_key: *validator_pubkey,
                balance: 0,
                validations_count: 0,
                reputation_score: 100,
                last_validation_height: 0,
                last_active_timestamp: now,
                is_online: true,
            });
        
        validator.validations_count += 1;
        validator.last_validation_height = height;
        validator.last_active_timestamp = now;
        validator.is_online = true;
        validator.reputation_score = (validator.reputation_score + 1).min(1000);
        
        // 6. If threshold reached, finalize block and distribute rewards
        if should_finalize {
            // Collect all approving validators for reward distribution
            let approving_validators: Vec<String> = if committee_mode {
                let committee = inner.current_committee.as_ref().unwrap();
                committee.members.iter()
                    .filter(|m| m.proof_valid)
                    .map(|m| m.pubkey.clone())
                    .collect()
            } else {
                vec![pubkey_hex.clone()]
            };
            
            let num_approvers = approving_validators.len() as u64;
            let reward_per_validator = inner.reward_per_proof / num_approvers.max(1);
            
            // Distribute rewards to all approving committee members
            for approver_pubkey in &approving_validators {
                if let Some(v) = inner.validators.get_mut(approver_pubkey) {
                    v.balance += reward_per_validator;
                }
            }
            
            inner.total_supply += reward_per_validator * num_approvers;
            
            // Record the transaction
            let tx_hash = {
                let mut hasher = Sha256::new();
                hasher.update(b"block_finalized");
                hasher.update(&inner.height.to_le_bytes());
                hasher.update(challenge_hash);
                hex::encode::<[u8; 32]>(hasher.finalize().into())
            };
            
            let current_height = inner.height;
            inner.tx_records.push(TxRecord {
                hash: tx_hash.clone(),
                tx_type: "block".to_string(),
                from: pubkey_hex.clone(), // Triggering validator
                to: None,
                amount: reward_per_validator * num_approvers,
                status: "confirmed".to_string(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                height: current_height,
            });
            
            // Finalize block
            inner.height += 1;
            
            // Compute new state root
            let new_state_root = {
                let mut hasher = Sha256::new();
                hasher.update(&inner.state_root);
                hasher.update(&inner.height.to_le_bytes());
                hasher.update(&inner.total_supply.to_le_bytes());
                hasher.update(challenge_hash);
                let result: [u8; 32] = hasher.finalize().into();
                result
            };
            inner.state_root = new_state_root;
            
            // Clear challenge and committee
            inner.current_challenge = None;
            inner.current_committee = None;
            
            let new_balance = inner.validators.get(&pubkey_hex).map(|v| v.balance).unwrap_or(0);
            
            tracing::info!(
                "📦 Block {} FINALIZED! {} validators approved, {} MOLT distributed",
                inner.height,
                num_approvers,
                reward_per_validator * num_approvers
            );
            tracing::info!(
                "🔗 New state root: {}",
                &hex::encode(&new_state_root)[..32]
            );
            
            TxResult::Success {
                reward: reward_per_validator,
                new_balance,
            }
        } else {
            // Proof accepted but block not yet finalized (waiting for more committee votes)
            let new_balance = inner.validators.get(&pubkey_hex).map(|v| v.balance).unwrap_or(0);
            
            tracing::info!(
                "⏳ Proof accepted from {}..., waiting for threshold ({}/{})",
                &pubkey_hex[..16],
                committee_approvals,
                committee_threshold
            );
            
            // Return 0 reward for now - reward distributed when block finalizes
            TxResult::Success {
                reward: 0,
                new_balance,
            }
        }
    }

    /// Process a token transfer
    fn process_transfer(
        &self,
        from: &[u8; 32],
        to: &[u8; 32],
        amount: u64,
        signature: &[u8; 64],
    ) -> TxResult {
        let mut inner = self.inner.write().unwrap();
        
        let from_hex = hex::encode(from);
        let to_hex = hex::encode(to);
        
        // Verify sender has enough balance
        let sender = match inner.validators.get(&from_hex) {
            Some(v) => v.clone(),
            None => return TxResult::Error("Sender not found".into()),
        };
        
        if sender.balance < amount {
            return TxResult::Error("Insufficient balance".into());
        }
        
        // Verify signature
        let verifying_key = match VerifyingKey::from_bytes(from) {
            Ok(k) => k,
            Err(_) => return TxResult::Error("Invalid sender public key".into()),
        };
        
        let mut message = Vec::new();
        message.extend_from_slice(to);
        message.extend_from_slice(&amount.to_le_bytes());
        
        // Signature::from_bytes doesn't return Result in ed25519-dalek 2.x
        let sig = Signature::from_bytes(signature);
        
        if verifying_key.verify(&message, &sig).is_err() {
            return TxResult::Error("Transfer signature verification failed".into());
        }
        
        // Execute transfer
        inner.validators.get_mut(&from_hex).unwrap().balance -= amount;
        
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let recipient = inner.validators
            .entry(to_hex.clone())
            .or_insert_with(|| ValidatorInfo {
                public_key: *to,
                balance: 0,
                validations_count: 0,
                reputation_score: 50,
                last_validation_height: 0,
                last_active_timestamp: now,
                is_online: false, // Recipient not necessarily online
            });
        recipient.balance += amount;
        
        let new_balance = recipient.balance;
        let height = inner.height;
        
        // Record the transaction
        let tx_hash = {
            let mut hasher = Sha256::new();
            hasher.update(b"transfer");
            hasher.update(from);
            hasher.update(to);
            hasher.update(&amount.to_le_bytes());
            hex::encode::<[u8; 32]>(hasher.finalize().into())
        };
        
        inner.tx_records.push(TxRecord {
            hash: tx_hash,
            tx_type: "transfer".to_string(),
            from: from_hex,
            to: Some(to_hex),
            amount,
            status: "confirmed".to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            height,
        });
        
        TxResult::Success {
            reward: 0,
            new_balance,
        }
    }

    /// Register a new validator
    fn register_validator(&self, public_key: &[u8; 32]) -> TxResult {
        let mut inner = self.inner.write().unwrap();
        
        let pubkey_hex = hex::encode(public_key);
        
        if inner.validators.contains_key(&pubkey_hex) {
            return TxResult::Error("Validator already registered".into());
        }
        
        // Initial funding for new validators
        const INITIAL_VALIDATOR_BALANCE: u64 = 100;
        
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        inner.validators.insert(pubkey_hex.clone(), ValidatorInfo {
            public_key: *public_key,
            balance: INITIAL_VALIDATOR_BALANCE,
            validations_count: 0,
            reputation_score: 50, // Start with neutral reputation
            last_validation_height: 0,
            last_active_timestamp: now,
            is_online: true, // New registrations are considered online
        });
        
        // Update total supply
        inner.total_supply += INITIAL_VALIDATOR_BALANCE;
        
        let height = inner.height;
        
        // Record the registration
        let tx_hash = {
            let mut hasher = Sha256::new();
            hasher.update(b"register");
            hasher.update(public_key);
            hex::encode::<[u8; 32]>(hasher.finalize().into())
        };
        
        inner.tx_records.push(TxRecord {
            hash: tx_hash,
            tx_type: "register".to_string(),
            from: pubkey_hex.clone(),
            to: None,
            amount: INITIAL_VALIDATOR_BALANCE,
            status: "confirmed".to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            height,
        });
        
        tracing::info!("📝 New validator registered: {}... (funded with {} MOLT)", &pubkey_hex[..16], INITIAL_VALIDATOR_BALANCE);
        
        TxResult::Registered {
            public_key: pubkey_hex,
        }
    }

    /// Get validator info by public key
    pub fn get_validator(&self, pubkey_hex: &str) -> Option<ValidatorInfo> {
        self.inner.read().unwrap().validators.get(pubkey_hex).cloned()
    }

    /// Get all transaction records
    pub fn get_transactions(&self, limit: usize) -> Vec<TxRecord> {
        let inner = self.inner.read().unwrap();
        inner.tx_records.iter().rev().take(limit).cloned().collect()
    }

    /// Get transactions with pagination (page is 1-indexed) and optional type filter
    pub fn get_transactions_paginated(&self, page: usize, per_page: usize, tx_type: Option<String>) -> (Vec<TxRecord>, usize) {
        let inner = self.inner.read().unwrap();
        
        // Filter by type if specified (skip if "all" or empty)
        let filtered: Vec<&TxRecord> = if let Some(ref filter_type) = tx_type {
            if filter_type == "all" || filter_type.is_empty() {
                inner.tx_records.iter().collect()
            } else {
                inner.tx_records
                    .iter()
                    .filter(|tx| &tx.tx_type == filter_type)
                    .collect()
            }
        } else {
            inner.tx_records.iter().collect()
        };
        
        let total = filtered.len();
        let offset = (page - 1) * per_page;
        
        // Get transactions in reverse order (newest first) with pagination
        let transactions: Vec<TxRecord> = filtered
            .into_iter()
            .rev()
            .skip(offset)
            .take(per_page)
            .cloned()
            .collect();
        
        (transactions, total)
    }

    /// Get current block height
    pub fn get_height(&self) -> u64 {
        self.inner.read().unwrap().height
    }

    /// Get state root
    pub fn get_state_root(&self) -> [u8; 32] {
        self.inner.read().unwrap().state_root
    }

    /// Finalize current block and advance height
    pub fn finalize_block(&self) -> BlockHeader {
        let mut inner = self.inner.write().unwrap();
        
        // Compute new state root
        let mut hasher = Sha256::new();
        for (key, val) in &inner.validators {
            hasher.update(key.as_bytes());
            hasher.update(&val.balance.to_le_bytes());
        }
        let new_state_root: [u8; 32] = hasher.finalize().into();
        
        // Compute tx root
        let mut tx_hasher = Sha256::new();
        for tx in &inner.pending_txs {
            tx_hasher.update(&tx.hash());
        }
        let tx_root: [u8; 32] = tx_hasher.finalize().into();
        
        let prev_state_root = inner.state_root;
        let challenge_hash = inner.current_challenge
            .as_ref()
            .map(|c| c.challenge_hash)
            .unwrap_or([0u8; 32]);
        
        let header = BlockHeader {
            height: inner.height,
            prev_state_root,
            tx_root,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            challenge_hash,
        };
        
        // Move pending txs to history
        let pending = std::mem::take(&mut inner.pending_txs);
        inner.tx_history.extend(pending);
        
        // Update state
        inner.state_root = new_state_root;
        inner.height += 1;
        inner.current_challenge = None;
        
        header
    }

    /// Get total supply
    pub fn get_total_supply(&self) -> u64 {
        self.inner.read().unwrap().total_supply
    }

    /// Get all validators
    pub fn get_all_validators(&self) -> Vec<ValidatorInfo> {
        self.inner.read().unwrap().validators.values().cloned().collect()
    }
    
    /// Get count of active validators (online in last 5 minutes)
    pub fn get_active_validator_count(&self) -> usize {
        let inner = self.inner.read().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        inner.validators.values()
            .filter(|v| now - v.last_active_timestamp < ACTIVE_THRESHOLD_SECS)
            .count()
    }
    
    /// Get all active validators (online in last 5 minutes)
    pub fn get_active_validators(&self) -> Vec<ValidatorInfo> {
        let inner = self.inner.read().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        inner.validators.values()
            .filter(|v| now - v.last_active_timestamp < ACTIVE_THRESHOLD_SECS)
            .cloned()
            .collect()
    }
    
    /// Update online status for all validators (call periodically)
    pub fn update_online_status(&self) {
        let mut inner = self.inner.write().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        for validator in inner.validators.values_mut() {
            validator.is_online = now - validator.last_active_timestamp < ACTIVE_THRESHOLD_SECS;
        }
    }

    /// Set the current challenge (used when receiving from P2P)
    pub fn set_current_challenge(&self, challenge: CognitiveChallenge) {
        let mut inner = self.inner.write().unwrap();
        inner.current_challenge = Some(challenge);
    }

    /// Verify and apply a proof from P2P network
    pub fn verify_and_apply_proof(&self, response: &super::challenge::ChallengeResponse) -> Result<ProofResult, String> {
        // Parse hex strings to bytes
        let validator_pubkey: [u8; 32] = hex::decode(&response.validator_pubkey)
            .map_err(|e| format!("Invalid validator pubkey hex: {}", e))?
            .try_into()
            .map_err(|_| "Invalid validator pubkey length")?;
        
        let challenge_hash: [u8; 32] = hex::decode(&response.challenge_hash)
            .map_err(|e| format!("Invalid challenge hash hex: {}", e))?
            .try_into()
            .map_err(|_| "Invalid challenge hash length")?;
        
        let signature: [u8; 64] = hex::decode(&response.signature)
            .map_err(|e| format!("Invalid signature hex: {}", e))?
            .try_into()
            .map_err(|_| "Invalid signature length")?;
        
        let verdict_digest: [u8; 32] = hex::decode(&response.verdict_digest)
            .map_err(|e| format!("Invalid verdict digest hex: {}", e))?
            .try_into()
            .map_err(|_| "Invalid verdict digest length")?;
        
        // Apply the proof submission
        let tx = MoltTx::SubmitProof {
            validator_pubkey,
            challenge_hash,
            signature,
            verdict_digest,
        };
        
        match self.apply_tx(tx) {
            TxResult::Success { reward, new_balance } => Ok(ProofResult { reward, new_balance }),
            TxResult::Registered { .. } => Err("Unexpected registration result".into()),
            TxResult::ContractDeployed { .. } | TxResult::ContractResult { .. } => {
                Err("Unexpected contract result".into())
            }
            TxResult::Error(e) => Err(e),
        }
    }

    /// Apply a block header received from P2P
    pub fn apply_block(&self, header: &BlockHeader) -> Result<(), String> {
        let mut inner = self.inner.write().unwrap();
        
        // Verify block height is sequential
        if header.height != inner.height + 1 && header.height != inner.height {
            return Err(format!(
                "Block height mismatch: expected {} or {}, got {}",
                inner.height,
                inner.height + 1,
                header.height
            ));
        }
        
        // Verify previous state root matches (if not genesis)
        if header.height > 0 && header.prev_state_root != inner.state_root {
            return Err("State root mismatch".into());
        }
        
        // Apply block
        inner.height = header.height;
        inner.state_root = header.prev_state_root;
        inner.current_challenge = None; // Clear current challenge
        
        // Move pending txs to history
        let pending = std::mem::take(&mut inner.pending_txs);
        inner.tx_history.extend(pending);
        
        Ok(())
    }

    /// Get number of pending proofs (for block message)
    pub fn get_pending_proof_count(&self) -> u64 {
        let inner = self.inner.read().unwrap();
        inner.pending_txs.iter()
            .filter(|tx| matches!(tx, MoltTx::SubmitProof { .. }))
            .count() as u64
    }

    /// Get validator count
    pub fn get_validator_count(&self) -> usize {
        self.inner.read().unwrap().validators.len()
    }
}

/// Result of proof verification
pub struct ProofResult {
    pub reward: u64,
    pub new_balance: u64,
}

impl Default for MoltchainState {
    fn default() -> Self {
        Self::new()
    }
}
