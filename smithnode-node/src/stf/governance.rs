//! SmithNode Governance System
//!
//! AI validators propose and vote on network parameter changes.
//! Voting power is proportional to stake. Changes execute after time delay.

use serde::{Deserialize, Serialize};

/// Network parameters that can be changed via governance
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetworkParams {
    /// Reward per valid proof submission (in micro-SMITH)
    pub reward_per_proof: u64,
    
    /// Committee size for block validation
    pub committee_size: usize,
    
    /// Minimum stake to be a validator
    pub min_validator_stake: u64,
    
    /// Slashing penalty percentage (0-100)
    pub slash_percentage: u8,
    
    /// Block time in seconds
    pub block_time_secs: u64,
    
    /// AI message rate limit (seconds between messages)
    pub ai_rate_limit_secs: u64,
    
    /// Maximum validators allowed
    pub max_validators: usize,
    
    /// Challenge timeout in seconds
    pub challenge_timeout_secs: u64,
}

impl Default for NetworkParams {
    fn default() -> Self {
        Self {
            reward_per_proof: 100,
            committee_size: 5,
            min_validator_stake: 50,  // devnet: low stake (mainnet: 1000)
            slash_percentage: 10,
            block_time_secs: 10,
            ai_rate_limit_secs: 600,
            max_validators: 1000,
            challenge_timeout_secs: 60,
        }
    }
}

/// What can be proposed for change
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum ProposalType {
    /// Change reward_per_proof
    ChangeReward { new_value: u64 },
    /// Change committee_size
    ChangeCommitteeSize { new_value: usize },
    /// Change min_validator_stake
    ChangeMinStake { new_value: u64 },
    /// Change slash_percentage
    ChangeSlashPenalty { new_value: u8 },
    /// Change block_time_secs
    ChangeBlockTime { new_value: u64 },
    /// Change ai_rate_limit_secs  
    ChangeAIRateLimit { new_value: u64 },
    /// Change max_validators
    ChangeMaxValidators { new_value: usize },
    /// Emergency action (requires 90% approval)
    Emergency { action: String },
}

impl ProposalType {
    pub fn description(&self) -> String {
        match self {
            ProposalType::ChangeReward { new_value } => 
                format!("Change block reward to {} SMITH", new_value),
            ProposalType::ChangeCommitteeSize { new_value } => 
                format!("Change committee size to {}", new_value),
            ProposalType::ChangeMinStake { new_value } => 
                format!("Change minimum stake to {} SMITH", new_value),
            ProposalType::ChangeSlashPenalty { new_value } => 
                format!("Change slash penalty to {}%", new_value),
            ProposalType::ChangeBlockTime { new_value } => 
                format!("Change block time to {} seconds", new_value),
            ProposalType::ChangeAIRateLimit { new_value } => 
                format!("Change AI rate limit to {} seconds", new_value),
            ProposalType::ChangeMaxValidators { new_value } => 
                format!("Change max validators to {}", new_value),
            ProposalType::Emergency { action } => 
                format!("EMERGENCY: {}", action),
        }
    }
    
    /// Required approval percentage (0-100)
    pub fn required_approval(&self) -> u8 {
        match self {
            ProposalType::Emergency { .. } => 90, // Emergency requires 90%
            _ => 66, // Normal proposals require 66% (2/3 majority)
        }
    }
}

/// Vote on a proposal
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Vote {
    pub voter: String,          // Validator pubkey hex
    pub vote: bool,             // true = approve, false = reject
    pub stake_weight: u64,      // Voter's stake at time of vote
    pub timestamp: u64,
    pub signature: String,      // Hex-encoded signature
    /// AI-generated reasoning for the vote decision (why the validator voted yes/no)
    #[serde(default)]
    pub reason: Option<String>,
}

/// Proposal status
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum ProposalStatus {
    /// Voting is open
    Active,
    /// Passed, waiting for execution
    Passed,
    /// Failed to get enough votes
    Failed,
    /// Successfully executed
    Executed,
    /// Cancelled by proposer
    Cancelled,
    /// Expired without enough votes
    Expired,
}

/// A governance proposal
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Proposal {
    /// Unique proposal ID
    pub id: u64,
    
    /// Proposer validator pubkey
    pub proposer: String,
    
    /// What is being proposed
    pub proposal_type: ProposalType,
    
    /// Optional description/reasoning from AI
    pub description: String,
    
    /// Proposal status
    pub status: ProposalStatus,
    
    /// When proposal was created
    pub created_at: u64,
    
    /// When voting ends
    pub voting_ends_at: u64,
    
    /// When change executes (if passed)
    pub execution_time: u64,
    
    /// All votes cast
    pub votes: Vec<Vote>,
    
    /// Total stake that voted YES
    pub yes_stake: u64,
    
    /// Total stake that voted NO
    pub no_stake: u64,
    
    /// Block height when created
    pub created_height: u64,
}

/// Governance voting periods (devnet: shorter for fast iteration)
pub const VOTING_PERIOD_SECS: u64 = 5;         // 5 seconds to vote (mainnet: 86400 = 24h)
pub const EXECUTION_DELAY_SECS: u64 = 3;       // 3 seconds after passing before execution (mainnet: 43200 = 12h)
pub const MIN_QUORUM_PERCENT: u8 = 33;         // At least 33% of total stake must vote
pub const MAX_ACTIVE_PROPOSALS: usize = 10;    // Maximum concurrent active proposals

impl Proposal {
    pub fn new(
        id: u64,
        proposer: String,
        proposal_type: ProposalType,
        description: String,
        current_time: u64,
        current_height: u64,
    ) -> Self {
        Self {
            id,
            proposer,
            proposal_type,
            description,
            status: ProposalStatus::Active,
            created_at: current_time,
            voting_ends_at: current_time + VOTING_PERIOD_SECS,
            execution_time: current_time + VOTING_PERIOD_SECS + EXECUTION_DELAY_SECS,
            votes: Vec::new(),
            yes_stake: 0,
            no_stake: 0,
            created_height: current_height,
        }
    }
    
    /// Add a vote to this proposal
    pub fn add_vote(&mut self, vote: Vote) -> Result<(), String> {
        // Check if already voted
        if self.votes.iter().any(|v| v.voter == vote.voter) {
            return Err("Already voted on this proposal".to_string());
        }
        
        // Check if voting is still open
        if self.status != ProposalStatus::Active {
            return Err(format!("Proposal is {:?}, not active", self.status));
        }
        
        // Check if voting period has expired (L3 fix: enforce deadline even before tick() runs)
        if vote.timestamp >= self.voting_ends_at {
            return Err("Voting period has ended for this proposal".to_string());
        }
        
        // Count the vote
        if vote.vote {
            self.yes_stake += vote.stake_weight;
        } else {
            self.no_stake += vote.stake_weight;
        }
        
        self.votes.push(vote);
        Ok(())
    }
    
    /// Check if proposal has passed
    pub fn check_result(&self, total_stake: u64) -> ProposalStatus {
        let total_voted = self.yes_stake + self.no_stake;
        
        // Check quorum
        let quorum_stake = (total_stake * MIN_QUORUM_PERCENT as u64) / 100;
        if total_voted < quorum_stake {
            return ProposalStatus::Active; // Not enough participation yet
        }
        
        // Check approval percentage
        let required = self.proposal_type.required_approval() as u64;
        let approval_percent = if total_voted > 0 {
            (self.yes_stake * 100) / total_voted
        } else {
            0
        };
        
        if approval_percent >= required {
            ProposalStatus::Passed
        } else if self.no_stake >= self.yes_stake {
            ProposalStatus::Failed
        } else {
            ProposalStatus::Active
        }
    }
    
    /// Get vote statistics
    pub fn stats(&self) -> ProposalStats {
        let total_voted = self.yes_stake + self.no_stake;
        ProposalStats {
            yes_votes: self.votes.iter().filter(|v| v.vote).count(),
            no_votes: self.votes.iter().filter(|v| !v.vote).count(),
            yes_stake: self.yes_stake,
            no_stake: self.no_stake,
            approval_percent: if total_voted > 0 {
                ((self.yes_stake * 100) / total_voted) as u8
            } else {
                0
            },
            required_percent: self.proposal_type.required_approval(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProposalStats {
    pub yes_votes: usize,
    pub no_votes: usize,
    pub yes_stake: u64,
    pub no_stake: u64,
    pub approval_percent: u8,
    pub required_percent: u8,
}

/// Governance state
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GovernanceState {
    /// Current network parameters
    pub params: NetworkParams,
    
    /// All proposals (active and historical)
    pub proposals: Vec<Proposal>,
    
    /// Next proposal ID
    pub next_proposal_id: u64,
    
    /// History of parameter changes
    pub param_history: Vec<ParamChange>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ParamChange {
    pub proposal_id: u64,
    pub param_name: String,
    pub old_value: String,
    pub new_value: String,
    pub executed_at: u64,
    pub executed_height: u64,
}

impl Default for GovernanceState {
    fn default() -> Self {
        Self {
            params: NetworkParams::default(),
            proposals: Vec::new(),
            next_proposal_id: 1,
            param_history: Vec::new(),
        }
    }
}

impl GovernanceState {
    /// Create a new proposal
    pub fn create_proposal(
        &mut self,
        proposer: String,
        proposal_type: ProposalType,
        description: String,
        current_time: u64,
        current_height: u64,
    ) -> Result<u64, String> {
        // Enforce max active proposals limit
        let active_count = self.proposals.iter()
            .filter(|p| p.status == ProposalStatus::Active || p.status == ProposalStatus::Passed)
            .count();
        if active_count >= MAX_ACTIVE_PROPOSALS {
            return Err(format!("Maximum active proposals ({}) reached. Wait for existing proposals to resolve.", MAX_ACTIVE_PROPOSALS));
        }
        
        let id = self.next_proposal_id;
        self.next_proposal_id += 1;
        
        let proposal = Proposal::new(
            id,
            proposer,
            proposal_type,
            description,
            current_time,
            current_height,
        );
        
        self.proposals.push(proposal);
        Ok(id)
    }
    
    /// Get a proposal by ID
    pub fn get_proposal(&self, id: u64) -> Option<&Proposal> {
        self.proposals.iter().find(|p| p.id == id)
    }
    
    /// Get mutable proposal by ID
    pub fn get_proposal_mut(&mut self, id: u64) -> Option<&mut Proposal> {
        self.proposals.iter_mut().find(|p| p.id == id)
    }
    
    /// Get all active proposals
    pub fn active_proposals(&self) -> Vec<&Proposal> {
        self.proposals.iter()
            .filter(|p| p.status == ProposalStatus::Active)
            .collect()
    }
    
    /// Execute a passed proposal
    pub fn execute_proposal(&mut self, id: u64, current_time: u64, current_height: u64) -> Result<(), String> {
        // First, find the proposal and extract what we need (without holding borrow)
        let (proposal_type, status, execution_time) = {
            let proposal = self.proposals.iter().find(|p| p.id == id)
                .ok_or("Proposal not found")?;
            (proposal.proposal_type.clone(), proposal.status.clone(), proposal.execution_time)
        };
        
        if status != ProposalStatus::Passed {
            return Err("Proposal has not passed".to_string());
        }
        
        if current_time < execution_time {
            return Err(format!(
                "Execution time not reached. Wait {} more seconds",
                execution_time - current_time
            ));
        }
        
        // Apply the change to params (with sanity bounds to prevent governance attacks)
        let change = match proposal_type {
            ProposalType::ChangeReward { new_value } => {
                if new_value > 1_000_000 {
                    return Err("Reward cannot exceed 1,000,000".to_string());
                }
                let old = self.params.reward_per_proof;
                self.params.reward_per_proof = new_value;
                ParamChange {
                    proposal_id: id,
                    param_name: "reward_per_proof".to_string(),
                    old_value: old.to_string(),
                    new_value: new_value.to_string(),
                    executed_at: current_time,
                    executed_height: current_height,
                }
            }
            ProposalType::ChangeCommitteeSize { new_value } => {
                if new_value == 0 || new_value > 100 {
                    return Err("Committee size must be between 1 and 100".to_string());
                }
                let old = self.params.committee_size;
                self.params.committee_size = new_value;
                ParamChange {
                    proposal_id: id,
                    param_name: "committee_size".to_string(),
                    old_value: old.to_string(),
                    new_value: new_value.to_string(),
                    executed_at: current_time,
                    executed_height: current_height,
                }
            }
            ProposalType::ChangeMinStake { new_value } => {
                if new_value == 0 || new_value > 10_000_000 {
                    return Err("Min stake must be between 1 and 10,000,000".to_string());
                }
                let old = self.params.min_validator_stake;
                self.params.min_validator_stake = new_value;
                ParamChange {
                    proposal_id: id,
                    param_name: "min_validator_stake".to_string(),
                    old_value: old.to_string(),
                    new_value: new_value.to_string(),
                    executed_at: current_time,
                    executed_height: current_height,
                }
            }
            ProposalType::ChangeSlashPenalty { new_value } => {
                if new_value > 100 {
                    return Err("Slash percentage cannot exceed 100".to_string());
                }
                let old = self.params.slash_percentage;
                self.params.slash_percentage = new_value;
                ParamChange {
                    proposal_id: id,
                    param_name: "slash_percentage".to_string(),
                    old_value: old.to_string(),
                    new_value: new_value.to_string(),
                    executed_at: current_time,
                    executed_height: current_height,
                }
            }
            ProposalType::ChangeBlockTime { new_value } => {
                if new_value == 0 || new_value > 3600 {
                    return Err("Block time must be between 1 and 3600 seconds".to_string());
                }
                let old = self.params.block_time_secs;
                self.params.block_time_secs = new_value;
                ParamChange {
                    proposal_id: id,
                    param_name: "block_time_secs".to_string(),
                    old_value: old.to_string(),
                    new_value: new_value.to_string(),
                    executed_at: current_time,
                    executed_height: current_height,
                }
            }
            ProposalType::ChangeAIRateLimit { new_value } => {
                if new_value == 0 || new_value > 86400 {
                    return Err("AI rate limit must be between 1 and 86400 seconds".to_string());
                }
                let old = self.params.ai_rate_limit_secs;
                self.params.ai_rate_limit_secs = new_value;
                ParamChange {
                    proposal_id: id,
                    param_name: "ai_rate_limit_secs".to_string(),
                    old_value: old.to_string(),
                    new_value: new_value.to_string(),
                    executed_at: current_time,
                    executed_height: current_height,
                }
            }
            ProposalType::ChangeMaxValidators { new_value } => {
                if new_value == 0 || new_value > 100_000 {
                    return Err("Max validators must be between 1 and 100,000".to_string());
                }
                let old = self.params.max_validators;
                self.params.max_validators = new_value;
                ParamChange {
                    proposal_id: id,
                    param_name: "max_validators".to_string(),
                    old_value: old.to_string(),
                    new_value: new_value.to_string(),
                    executed_at: current_time,
                    executed_height: current_height,
                }
            }
            ProposalType::Emergency { ref action } => {
                ParamChange {
                    proposal_id: id,
                    param_name: "emergency".to_string(),
                    old_value: "N/A".to_string(),
                    new_value: action.clone(),
                    executed_at: current_time,
                    executed_height: current_height,
                }
            }
        };
        
        self.param_history.push(change);
        
        // Update proposal status
        if let Some(proposal) = self.proposals.iter_mut().find(|p| p.id == id) {
            proposal.status = ProposalStatus::Executed;
        }
        
        Ok(())
    }
    
    /// Update proposals based on time (expire old ones, mark passed ones)
    /// Also auto-executes passed proposals after execution delay
    pub fn tick(&mut self, current_time: u64, total_stake: u64, current_height: u64) {
        // Phase 1: Expire/pass active proposals whose voting period ended
        for proposal in &mut self.proposals {
            if proposal.status != ProposalStatus::Active {
                continue;
            }
            
            // Check if voting period ended
            if current_time >= proposal.voting_ends_at {
                let result = proposal.check_result(total_stake);
                if result == ProposalStatus::Active {
                    // Not enough votes = expired
                    proposal.status = ProposalStatus::Expired;
                } else {
                    proposal.status = result;
                }
            }
        }
        
        // Phase 2: Auto-execute passed proposals whose execution delay has elapsed
        let passed_ids: Vec<u64> = self.proposals.iter()
            .filter(|p| p.status == ProposalStatus::Passed && current_time >= p.execution_time)
            .map(|p| p.id)
            .collect();
        
        for id in passed_ids {
            // execute_proposal will update status to Executed and apply param changes
            match self.execute_proposal(id, current_time, current_height) {
                Ok(_) => {
                    let param = self.param_history.last()
                        .map(|p| format!("{}: {} → {}", p.param_name, p.old_value, p.new_value))
                        .unwrap_or_default();
                    tracing::info!("🔄 Auto-executed proposal #{}: {}", id, param);
                }
                Err(e) => {
                    tracing::warn!("⚠️ Failed to auto-execute proposal #{}: {} — marking as Failed", id, e);
                    // Mark as Failed to prevent infinite retry loop
                    if let Some(proposal) = self.proposals.iter_mut().find(|p| p.id == id) {
                        proposal.status = ProposalStatus::Failed;
                    }
                }
            }
        }
    }
    
    /// Get current network state summary for AI context
    pub fn state_summary(&self, validators_count: usize, height: u64, total_supply: u64) -> String {
        format!(
            "NETWORK STATE:\n\
             - Validators: {}\n\
             - Block Height: {}\n\
             - Total Supply: {} SMITH\n\
             - Block Reward: {} SMITH\n\
             - Committee Size: {}\n\
             - Min Stake: {} SMITH\n\
             - Slash Penalty: {}%\n\
             - Block Time: {}s\n\
             - AI Rate Limit: {}s\n\
             - Active Proposals: {}",
            validators_count,
            height,
            total_supply,
            self.params.reward_per_proof,
            self.params.committee_size,
            self.params.min_validator_stake,
            self.params.slash_percentage,
            self.params.block_time_secs,
            self.params.ai_rate_limit_secs,
            self.proposals.iter().filter(|p| p.status == ProposalStatus::Active).count()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_proposal_voting() {
        let mut gov = GovernanceState::default();
        let now = 1000000;
        
        // Create proposal
        let id = gov.create_proposal(
            "validator1".to_string(),
            ProposalType::ChangeReward { new_value: 200 },
            "Double the reward".to_string(),
            now,
            100,
        ).unwrap();
        
        // Vote
        let proposal = gov.get_proposal_mut(id).unwrap();
        proposal.add_vote(Vote {
            voter: "v1".to_string(),
            vote: true,
            stake_weight: 1000,
            timestamp: now,
            signature: "00".repeat(64), // 64 bytes as hex = 128 chars
            reason: None,
        }).unwrap();
        
        proposal.add_vote(Vote {
            voter: "v2".to_string(),
            vote: true,
            stake_weight: 500,
            timestamp: now,
            signature: "00".repeat(64),
            reason: None,
        }).unwrap();
        
        proposal.add_vote(Vote {
            voter: "v3".to_string(),
            vote: false,
            stake_weight: 200,
            timestamp: now,
            signature: "00".repeat(64),
            reason: None,
        }).unwrap();
        
        // Check result (total stake = 2000 for quorum)
        let result = proposal.check_result(2000);
        assert_eq!(result, ProposalStatus::Passed); // 88% approval
    }
}
