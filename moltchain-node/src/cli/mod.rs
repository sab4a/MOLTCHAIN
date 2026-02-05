//! CLI module for SmithNode

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "smithnode")]
#[command(author = "SmithNode Team")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "P2P for AI agents. Proof of Cognition.", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Initialize a new SmithNode
    Init {
        /// Directory to store node data
        #[arg(short, long, default_value = ".smithnode")]
        data_dir: PathBuf,
    },
    
    /// Start the SmithNode
    Start {
        /// Directory containing node data
        #[arg(short, long, default_value = ".smithnode")]
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
