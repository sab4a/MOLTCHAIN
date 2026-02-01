//! Cognitive Challenge System for AI Validators
//!
//! Defines challenges that AI agents must solve to validate blocks.

use serde::{Deserialize, Serialize};

/// Types of cognitive challenges AI agents can solve
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ChallengeType {
    /// Verify transaction logic and detect double-spends
    TransactionVerification,
    
    /// Detect anomalous patterns in transaction flow
    AnomalyDetection,
    
    /// Verify state transition correctness
    StateTransitionAudit,
    
    /// Check for malformed or malicious transactions
    MaliciousTxDetection,
}

/// A cognitive challenge for AI validators
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CognitiveChallenge {
    /// Type of challenge
    pub challenge_type: ChallengeType,
    
    /// Unique hash identifying this challenge
    pub challenge_hash: [u8; 32],
    
    /// Block height this challenge is for
    pub height: u64,
    
    /// Difficulty level (affects reward multiplier)
    pub difficulty: u8,
    
    /// Hashes of pending transactions to validate
    pub pending_tx_hashes: Vec<[u8; 32]>,
    
    /// Unix timestamp when challenge was created
    pub created_at: u64,
    
    /// Unix timestamp when challenge expires
    pub expires_at: u64,
}

impl CognitiveChallenge {
    /// Check if the challenge has expired
    pub fn is_expired(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        now > self.expires_at
    }
    
    /// Get remaining time in seconds
    pub fn remaining_time(&self) -> u64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        if now > self.expires_at {
            0
        } else {
            self.expires_at - now
        }
    }
}

/// Response from an AI agent after solving a challenge (uses hex strings for serialization)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChallengeResponse {
    /// The challenge hash being responded to (hex)
    pub challenge_hash: String,
    
    /// Validator's public key (hex)
    pub validator_pubkey: String,
    
    /// Signature over (challenge_hash || verdict_digest) (hex)
    pub signature: String,
    
    /// Merkle root of flagged/invalid transaction IDs (hex)
    pub verdict_digest: String,
    
    /// Optional: detailed verdict for each transaction
    pub tx_verdicts: Option<Vec<TxVerdict>>,
}

/// Verdict for a single transaction
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TxVerdict {
    /// Transaction hash (hex)
    pub tx_hash: String,
    
    /// Is the transaction valid?
    pub is_valid: bool,
    
    /// Confidence score (0-100)
    pub confidence: u8,
    
    /// Reason for flagging (if invalid)
    pub reason: Option<String>,
}
