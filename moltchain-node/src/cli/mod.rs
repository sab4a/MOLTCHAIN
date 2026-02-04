//! CLI module for Moltchain node

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "moltchain")]
#[command(author = "Moltchain Team")]
#[command(version = env!("CARGO_PKG_VERSION"))]
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
        
        /// JSON-RPC bind address (use 0.0.0.0 for public access)
        #[arg(long, default_value = "127.0.0.1:26658")]
        rpc_bind: String,
        
        /// P2P bind address (use 0.0.0.0 for public access)
        #[arg(long, default_value = "0.0.0.0:26656")]
        p2p_bind: String,
        
        /// Bootstrap peer multiaddr (can be specified multiple times)
        #[arg(long = "peer", short = 'p')]
        peers: Vec<String>,
    },
    
    /// Generate a new validator keypair
    Keygen {
        /// Output file for keypair (prints to stdout if not specified)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
}
