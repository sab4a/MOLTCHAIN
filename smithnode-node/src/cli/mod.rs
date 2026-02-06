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
    
    /// Start the SmithNode (RPC + P2P, no validation)
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
    
    /// Start as a P2P VALIDATOR (true peer, no RPC dependency)
    /// This mode joins the P2P network directly and validates blocks
    Validator {
        /// Directory containing node data
        #[arg(short, long, default_value = ".smithnode")]
        data_dir: PathBuf,
        
        /// Path to validator keypair JSON file
        #[arg(long, short = 'k')]
        keypair: PathBuf,
        
        /// P2P bind address
        #[arg(long, default_value = "0.0.0.0:26656")]
        p2p_bind: String,
        
        /// Bootstrap peer multiaddr (required to join network)
        #[arg(long = "peer", short = 'p', required = true)]
        peers: Vec<String>,
        
        /// Also run RPC server (optional, for monitoring)
        #[arg(long)]
        rpc_bind: Option<String>,
        
        /// AI provider for cognitive challenges: ollama, openai, anthropic, groq, together
        /// If not provided, uses built-in deterministic solver (no AI)
        #[arg(long)]
        ai_provider: Option<String>,
        
        /// AI API key (required for openai, anthropic, groq, together)
        #[arg(long)]
        ai_api_key: Option<String>,
        
        /// AI model name (e.g. llama2, gpt-4, claude-3-sonnet, llama-3.1-70b-versatile)
        #[arg(long)]
        ai_model: Option<String>,
        
        /// AI endpoint URL (for ollama: http://localhost:11434, or custom endpoints)
        #[arg(long)]
        ai_endpoint: Option<String>,
    },
    
    /// Generate a new validator keypair
    Keygen {
        /// Output file for keypair (prints to stdout if not specified)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
}
