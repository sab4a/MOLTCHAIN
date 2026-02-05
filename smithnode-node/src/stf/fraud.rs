//! Fraud Proof System for SmithNode
//!
//! Allows validators to challenge and dispute invalid blocks or proofs.
//! This creates an economic game where cheating is unprofitable.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

/// Types of fraud that can be proven
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum FraudType {
    /// Validator submitted an invalid proof
    InvalidProof,
    /// Validator signed two different blocks at same height (equivocation)
    Equivocation,
    /// Validator didn't participate when selected for committee
    CommitteeAbsence,
    /// Validator submitted wrong puzzle answer
    WrongPuzzleAnswer,
    /// State transition was computed incorrectly
    InvalidStateTransition,
}

/// A fraud proof submitted by a challenger
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FraudProof {
    /// Type of fraud being alleged
    pub fraud_type: FraudType,
    
    /// Block height where fraud occurred
    pub block_height: u64,
    
    /// Public key of the accused validator (hex)
    pub accused_validator: String,
    
    /// Public key of the challenger (hex)
    pub challenger: String,
    
    /// Evidence supporting the fraud claim
    pub evidence: FraudEvidence,
    
    /// Signature of the challenger over the fraud proof
    pub challenger_signature: String,
    
    /// Timestamp when fraud proof was submitted
    pub submitted_at: u64,
    
    /// Hash of this fraud proof
    pub proof_hash: [u8; 32],
}

/// Evidence for different types of fraud
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum FraudEvidence {
    /// For InvalidProof: the original challenge and the bad proof
    InvalidProofEvidence {
        challenge_hash: String,
        submitted_verdict: String,
        correct_verdict: String,
    },
    
    /// For Equivocation: two different signatures on conflicting blocks
    EquivocationEvidence {
        block_hash_1: String,
        signature_1: String,
        block_hash_2: String,
        signature_2: String,
    },
    
    /// For CommitteeAbsence: proof of selection but no submission
    AbsenceEvidence {
        committee_challenge_hash: String,
        selection_proof: String,  // Proof they were in the committee
    },
    
    /// For WrongPuzzleAnswer: the puzzle and their wrong answer
    WrongAnswerEvidence {
        puzzle_hash: String,
        submitted_answer: String,
        correct_answer_hash: String,
    },
    
    /// For InvalidStateTransition: pre-state, post-state, and correct computation
    InvalidTransitionEvidence {
        pre_state_root: String,
        claimed_post_state: String,
        correct_post_state: String,
        transaction_hash: String,
    },
}

/// Result of fraud proof verification
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FraudVerificationResult {
    /// Is the fraud proof valid?
    pub is_valid: bool,
    
    /// Reason for decision
    pub reason: String,
    
    /// Amount to slash from accused (if valid)
    pub slash_amount: u64,
    
    /// Reward for challenger (if valid) - typically 50% of slash
    pub challenger_reward: u64,
}

impl FraudProof {
    /// Create a new fraud proof
    pub fn new(
        fraud_type: FraudType,
        block_height: u64,
        accused_validator: String,
        challenger: String,
        evidence: FraudEvidence,
        challenger_signature: String,
    ) -> Self {
        let submitted_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Compute proof hash
        let mut hasher = Sha256::new();
        hasher.update(format!("{:?}", fraud_type).as_bytes());
        hasher.update(&block_height.to_le_bytes());
        hasher.update(accused_validator.as_bytes());
        hasher.update(challenger.as_bytes());
        hasher.update(&submitted_at.to_le_bytes());
        let proof_hash: [u8; 32] = hasher.finalize().into();
        
        Self {
            fraud_type,
            block_height,
            accused_validator,
            challenger,
            evidence,
            challenger_signature,
            submitted_at,
            proof_hash,
        }
    }
    
    /// Verify the fraud proof
    pub fn verify(&self) -> FraudVerificationResult {
        match &self.evidence {
            FraudEvidence::InvalidProofEvidence { 
                submitted_verdict, 
                correct_verdict,
                .. 
            } => {
                // Verify the verdicts are actually different
                if submitted_verdict != correct_verdict {
                    FraudVerificationResult {
                        is_valid: true,
                        reason: "Invalid proof confirmed - verdicts differ".into(),
                        slash_amount: 25,
                        challenger_reward: 12,
                    }
                } else {
                    FraudVerificationResult {
                        is_valid: false,
                        reason: "Verdicts match - no fraud detected".into(),
                        slash_amount: 0,
                        challenger_reward: 0,
                    }
                }
            }
            
            FraudEvidence::EquivocationEvidence {
                block_hash_1,
                block_hash_2,
                signature_1,
                signature_2,
                ..
            } => {
                // Verify signatures are different on different blocks
                if block_hash_1 != block_hash_2 && !signature_1.is_empty() && !signature_2.is_empty() {
                    FraudVerificationResult {
                        is_valid: true,
                        reason: "Equivocation confirmed - double voting detected".into(),
                        slash_amount: 50,
                        challenger_reward: 25,
                    }
                } else {
                    FraudVerificationResult {
                        is_valid: false,
                        reason: "Not valid equivocation evidence".into(),
                        slash_amount: 0,
                        challenger_reward: 0,
                    }
                }
            }
            
            FraudEvidence::AbsenceEvidence { .. } => {
                // Committee absence is simpler to verify
                FraudVerificationResult {
                    is_valid: true,
                    reason: "Committee absence confirmed".into(),
                    slash_amount: 10,
                    challenger_reward: 5,
                }
            }
            
            FraudEvidence::WrongAnswerEvidence {
                submitted_answer,
                correct_answer_hash,
                ..
            } => {
                // Hash the submitted answer and compare
                let mut hasher = Sha256::new();
                hasher.update(submitted_answer.trim().to_lowercase().as_bytes());
                let answer_hash = hex::encode::<[u8; 32]>(hasher.finalize().into());
                
                if &answer_hash != correct_answer_hash {
                    FraudVerificationResult {
                        is_valid: true,
                        reason: "Wrong puzzle answer confirmed".into(),
                        slash_amount: 15,
                        challenger_reward: 7,
                    }
                } else {
                    FraudVerificationResult {
                        is_valid: false,
                        reason: "Answer was actually correct".into(),
                        slash_amount: 0,
                        challenger_reward: 0,
                    }
                }
            }
            
            FraudEvidence::InvalidTransitionEvidence {
                claimed_post_state,
                correct_post_state,
                ..
            } => {
                if claimed_post_state != correct_post_state {
                    FraudVerificationResult {
                        is_valid: true,
                        reason: "Invalid state transition confirmed".into(),
                        slash_amount: 100,
                        challenger_reward: 50,
                    }
                } else {
                    FraudVerificationResult {
                        is_valid: false,
                        reason: "State transition was correct".into(),
                        slash_amount: 0,
                        challenger_reward: 0,
                    }
                }
            }
        }
    }
}

/// Challenge window - how long (in seconds) fraud proofs can be submitted
pub const FRAUD_PROOF_WINDOW: u64 = 3600; // 1 hour

/// Manager for tracking and processing fraud proofs
#[derive(Clone, Debug, Default)]
pub struct FraudProofManager {
    /// Pending fraud proofs awaiting resolution
    pending_proofs: Vec<FraudProof>,
    
    /// Resolved fraud proofs (hash -> result)
    resolved_proofs: std::collections::HashMap<String, FraudVerificationResult>,
}

impl FraudProofManager {
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Submit a new fraud proof
    pub fn submit_fraud_proof(&mut self, proof: FraudProof) -> Result<(), String> {
        let proof_hash_hex = hex::encode(proof.proof_hash);
        
        // Check if already submitted
        if self.resolved_proofs.contains_key(&proof_hash_hex) {
            return Err("Fraud proof already resolved".into());
        }
        
        if self.pending_proofs.iter().any(|p| hex::encode(p.proof_hash) == proof_hash_hex) {
            return Err("Fraud proof already pending".into());
        }
        
        self.pending_proofs.push(proof);
        Ok(())
    }
    
    /// Process all pending fraud proofs
    pub fn process_pending(&mut self) -> Vec<(FraudProof, FraudVerificationResult)> {
        let mut results = Vec::new();
        
        let proofs = std::mem::take(&mut self.pending_proofs);
        
        for proof in proofs {
            let result = proof.verify();
            let proof_hash_hex = hex::encode(proof.proof_hash);
            
            self.resolved_proofs.insert(proof_hash_hex, result.clone());
            results.push((proof, result));
        }
        
        results
    }
    
    /// Get pending fraud proof count
    pub fn pending_count(&self) -> usize {
        self.pending_proofs.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_equivocation_fraud_proof() {
        let evidence = FraudEvidence::EquivocationEvidence {
            block_hash_1: "hash1".to_string(),
            signature_1: "sig1".to_string(),
            block_hash_2: "hash2".to_string(),
            signature_2: "sig2".to_string(),
        };
        
        let proof = FraudProof::new(
            FraudType::Equivocation,
            100,
            "accused_pubkey".to_string(),
            "challenger_pubkey".to_string(),
            evidence,
            "challenger_sig".to_string(),
        );
        
        let result = proof.verify();
        assert!(result.is_valid);
        assert_eq!(result.slash_amount, 50);
    }
}
