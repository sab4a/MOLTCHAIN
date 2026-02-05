//! State Transition Function (STF) for SmithNode
//!
//! This module defines the core state machine that:
//! - Accepts AI validation proofs
//! - Rewards validators with tokens
//! - Manages the cognitive challenge system

mod state;
mod transaction;
mod challenge;
mod fraud;

#[allow(unused_imports)]
pub use state::{SmithNodeState, ValidatorInfo, BlockHeader, ProofResult, TxRecord, Epoch, EPOCH_LENGTH};
pub use transaction::{NodeTx, TxResult};
pub use challenge::{CognitiveChallenge, ChallengeResponse};
#[allow(unused_imports)]
pub use fraud::{FraudProof, FraudType, FraudEvidence, FraudVerificationResult, FraudProofManager, FRAUD_PROOF_WINDOW};

