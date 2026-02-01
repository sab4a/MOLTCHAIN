//! CLI module for Moltchain node

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "moltchain")]
#[command(author = "Moltchain Team")]
#[command(version = "0.1.0")]
#[command(about = "AI-Validated Sovereign Rollup Node", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Initialize a new Moltchain node
    Init {
        /// Directory to store node data
        #[arg(short, long, default_value = ".moltchain")]
        data_dir: PathBuf,
    },
    
    /// Start the Moltchain node
    Start {
        /// Directory containing node data
        #[arg(short, long, default_value = ".moltchain")]
        data_dir: PathBuf,
        
        /// JSON-RPC port
        #[arg(long, default_value = "26658")]
        rpc_port: u16,
        
        /// P2P port
        #[arg(long, default_value = "26656")]
        p2p_port: u16,
    },
    
    /// Generate a new validator keypair
    Keygen {
        /// Output file for keypair (prints to stdout if not specified)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
}
