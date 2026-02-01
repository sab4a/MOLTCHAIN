//! Persistent storage for Moltchain state
//!
//! Stores blockchain state to disk so it survives restarts.

use std::path::PathBuf;
use std::fs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::stf::{ValidatorInfo, TxRecord};

/// Persistent state that gets saved to disk
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct PersistedState {
    pub validators: HashMap<String, ValidatorInfo>,
    pub height: u64,
    pub state_root: [u8; 32],
    pub tx_records: Vec<TxRecord>,
    pub total_supply: u64,
}

/// Storage manager for blockchain data
pub struct Storage {
    data_dir: PathBuf,
}

impl Storage {
    /// Create a new storage manager
    pub fn new(data_dir: PathBuf) -> Self {
        // Create data directory if it doesn't exist
        if !data_dir.exists() {
            fs::create_dir_all(&data_dir).expect("Failed to create data directory");
        }
        Self { data_dir }
    }

    /// Get the default data directory
    pub fn default_data_dir() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".moltchain")
    }

    /// Get the state file path
    fn state_path(&self) -> PathBuf {
        self.data_dir.join("state.json")
    }

    /// Load state from disk
    pub fn load_state(&self) -> Option<PersistedState> {
        let path = self.state_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(contents) => {
                    match serde_json::from_str(&contents) {
                        Ok(state) => {
                            tracing::info!("📂 Loaded state from {:?}", path);
                            Some(state)
                        }
                        Err(e) => {
                            tracing::warn!("Failed to parse state file: {}", e);
                            None
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to read state file: {}", e);
                    None
                }
            }
        } else {
            tracing::info!("📂 No existing state found, starting fresh");
            None
        }
    }

    /// Save state to disk
    pub fn save_state(&self, state: &PersistedState) -> anyhow::Result<()> {
        let path = self.state_path();
        let contents = serde_json::to_string_pretty(state)?;
        fs::write(&path, contents)?;
        tracing::debug!("💾 State saved to {:?}", path);
        Ok(())
    }
}
