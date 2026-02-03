//! State Transition Function (STF) for Moltchain
//!
//! This module defines the core state machine that:
//! - Accepts AI validation proofs
//! - Rewards validators with tokens
//! - Manages the cognitive challenge system

mod state;
mod transaction;
mod challenge;

pub use state::{MoltchainState, ValidatorInfo, BlockHeader, ProofResult, TxRecord, BlockCommittee, CommitteeMember};
pub use transaction::{MoltTx, TxResult};
pub use challenge::{CognitiveChallenge, ChallengeType, ChallengeResponse, CognitivePuzzle, PuzzleType};

