//! Transaction types for Moltchain

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

/// Gas constants for future smart contract support
pub const GAS_REGISTER: u64 = 1_000;      // Fixed cost to register
pub const GAS_TRANSFER: u64 = 500;         // Fixed cost to transfer
pub const GAS_PROOF: u64 = 0;              // Proofs are free (validators earn, not pay)
pub const GAS_CONTRACT_DEPLOY: u64 = 50_000;  // Deploy a contract
pub const GAS_CONTRACT_CALL_BASE: u64 = 5_000; // Base cost per contract call
pub const GAS_PER_BYTE: u64 = 1;           // Per byte of calldata

/// Default gas price (can be adjusted by governance later)
pub const DEFAULT_GAS_PRICE: u64 = 1;      // 1 MOLT per gas unit

/// Transaction types supported by Moltchain
/// Note: Internal transactions use raw bytes, serialization happens at RPC layer
#[derive(Clone, Debug)]
pub enum MoltTx {
    /// Submit a validation proof (from AI agent)
    /// Gas: FREE (validators earn rewards, not pay fees)
    SubmitProof {
        validator_pubkey: [u8; 32],
        challenge_hash: [u8; 32],
        signature: [u8; 64],
        /// Merkle root of flagged transaction IDs (verdict)
        verdict_digest: [u8; 32],
    },
    
    /// Transfer tokens between accounts
    /// Gas: Fixed (GAS_TRANSFER), but currently waived
    Transfer {
        from: [u8; 32],
        to: [u8; 32],
        amount: u64,
        signature: [u8; 64],
    },
    
    /// Register as a new validator
    /// Gas: Fixed (GAS_REGISTER), but currently waived
    RegisterValidator {
        public_key: [u8; 32],
    },
    
    /// Deploy a smart contract (FUTURE)
    /// Gas: GAS_CONTRACT_DEPLOY + (code.len() * GAS_PER_BYTE)
    DeployContract {
        deployer: [u8; 32],
        code: Vec<u8>,          // Contract bytecode (WASM)
        init_data: Vec<u8>,     // Constructor arguments
        gas_limit: u64,
        signature: [u8; 64],
    },
    
    /// Call a smart contract (FUTURE)
    /// Gas: GAS_CONTRACT_CALL_BASE + execution cost
    CallContract {
        caller: [u8; 32],
        contract: [u8; 32],     // Contract address
        method: String,         // Method name
        args: Vec<u8>,          // Encoded arguments
        value: u64,             // MOLT to send with call
        gas_limit: u64,
        signature: [u8; 64],
    },
}

impl MoltTx {
    /// Get the gas cost for this transaction (currently waived for basic tx types)
    pub fn gas_cost(&self) -> u64 {
        match self {
            MoltTx::SubmitProof { .. } => GAS_PROOF,
            MoltTx::Transfer { .. } => 0, // GAS_TRANSFER - currently waived
            MoltTx::RegisterValidator { .. } => 0, // GAS_REGISTER - currently waived
            MoltTx::DeployContract { code, .. } => {
                GAS_CONTRACT_DEPLOY + (code.len() as u64 * GAS_PER_BYTE)
            }
            MoltTx::CallContract { args, .. } => {
                GAS_CONTRACT_CALL_BASE + (args.len() as u64 * GAS_PER_BYTE)
            }
        }
    }

    /// Get the gas limit for this transaction
    pub fn gas_limit(&self) -> u64 {
        match self {
            MoltTx::DeployContract { gas_limit, .. } => *gas_limit,
            MoltTx::CallContract { gas_limit, .. } => *gas_limit,
            _ => self.gas_cost(), // Fixed cost = limit for basic txs
        }
    }

    /// Compute the hash of this transaction
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        
        match self {
            MoltTx::SubmitProof {
                validator_pubkey,
                challenge_hash,
                signature,
                verdict_digest,
            } => {
                hasher.update(b"submit_proof");
                hasher.update(validator_pubkey);
                hasher.update(challenge_hash);
                hasher.update(signature);
                hasher.update(verdict_digest);
            }
            MoltTx::Transfer {
                from,
                to,
                amount,
                signature,
            } => {
                hasher.update(b"transfer");
                hasher.update(from);
                hasher.update(to);
                hasher.update(&amount.to_le_bytes());
                hasher.update(signature);
            }
            MoltTx::RegisterValidator { public_key } => {
                hasher.update(b"register_validator");
                hasher.update(public_key);
            }
            MoltTx::DeployContract {
                deployer,
                code,
                init_data,
                gas_limit,
                signature,
            } => {
                hasher.update(b"deploy_contract");
                hasher.update(deployer);
                hasher.update(code);
                hasher.update(init_data);
                hasher.update(&gas_limit.to_le_bytes());
                hasher.update(signature);
            }
            MoltTx::CallContract {
                caller,
                contract,
                method,
                args,
                value,
                gas_limit,
                signature,
            } => {
                hasher.update(b"call_contract");
                hasher.update(caller);
                hasher.update(contract);
                hasher.update(method.as_bytes());
                hasher.update(args);
                hasher.update(&value.to_le_bytes());
                hasher.update(&gas_limit.to_le_bytes());
                hasher.update(signature);
            }
        }
        
        hasher.finalize().into()
    }
}

/// Result of applying a transaction
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum TxResult {
    Success {
        reward: u64,
        new_balance: u64,
    },
    Registered {
        public_key: String,
    },
    /// Contract deployed successfully
    ContractDeployed {
        address: String,
        gas_used: u64,
    },
    /// Contract call completed
    ContractResult {
        return_data: Vec<u8>,
        gas_used: u64,
    },
    Error(String),
}

impl TxResult {
    pub fn is_success(&self) -> bool {
        matches!(self, 
            TxResult::Success { .. } | 
            TxResult::Registered { .. } |
            TxResult::ContractDeployed { .. } |
            TxResult::ContractResult { .. }
        )
    }
}
