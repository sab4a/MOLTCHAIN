//! Cognitive Challenge System for AI Validators
//!
//! Defines challenges that AI agents must solve to validate blocks.
//! These challenges are designed to be solvable by AI but difficult for humans/scripts.

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

/// Types of cognitive challenges AI agents can solve
/// Each challenge type is designed to require AI-level reasoning
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ChallengeType {
    /// Verify transaction logic and detect double-spends
    TransactionVerification,
    
    /// Detect anomalous patterns in transaction flow
    AnomalyDetection,
    
    /// Verify state transition correctness
    StateTransitionAudit,
    
    /// Check for malformed or malicious transactions
    MaliciousTxDetection,
    
    /// NEW: Semantic reasoning challenge - requires AI understanding
    SemanticReasoning,
    
    /// NEW: Code analysis challenge - find bugs in code snippets
    CodeAnalysis,
    
    /// NEW: Pattern completion - complete a logical sequence
    PatternCompletion,
    
    /// NEW: Text transformation - apply described transformation
    TextTransformation,
}

/// A cognitive challenge for AI validators
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CognitiveChallenge {
    /// Type of challenge
    pub challenge_type: ChallengeType,
    
    /// Unique hash identifying this challenge
    pub challenge_hash: [u8; 32],
    
    /// Block height this challenge is for
    pub height: u64,
    
    /// Difficulty level (affects reward multiplier)
    pub difficulty: u8,
    
    /// Hashes of pending transactions to validate
    pub pending_tx_hashes: Vec<[u8; 32]>,
    
    /// Unix timestamp when challenge was created
    pub created_at: u64,
    
    /// Unix timestamp when challenge expires
    pub expires_at: u64,
    
    /// NEW: The cognitive puzzle to solve (only AI can solve quickly)
    pub cognitive_puzzle: Option<CognitivePuzzle>,
}

/// A puzzle that requires AI-level cognition to solve
/// Humans are too slow, scripts are too dumb
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CognitivePuzzle {
    /// The puzzle type
    pub puzzle_type: PuzzleType,
    
    /// The puzzle prompt/question
    pub prompt: String,
    
    /// For code analysis: the code snippet
    pub code_snippet: Option<String>,
    
    /// For pattern completion: the sequence so far
    pub sequence: Option<Vec<String>>,
    
    /// For text transformation: input text
    pub input_text: Option<String>,
    
    /// The expected answer hash (SHA256) - validators hash their answer to match
    pub expected_answer_hash: [u8; 32],
    
    /// Time limit in milliseconds (short = AI only)
    pub time_limit_ms: u64,
}

/// Types of cognitive puzzles
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum PuzzleType {
    /// "What comes next?" - pattern recognition
    PatternNext,
    
    /// "What's wrong with this code?" - bug detection
    CodeBugDetection,
    
    /// "Transform ABC using rule X" - text manipulation
    TextTransform,
    
    /// "Summarize in one word" - semantic compression
    SemanticSummary,
    
    /// "What number results from: 'two plus three times four'" - NL math
    NaturalLanguageMath,
    
    /// "Decode: rot13/base64/etc" - encoding recognition
    EncodingDecode,
}

impl CognitivePuzzle {
    /// Generate a random cognitive puzzle
    pub fn generate(seed: &[u8; 32], difficulty: u8) -> Self {
        // Use seed to deterministically generate puzzle
        let puzzle_type_idx = seed[0] % 6;
        let puzzle_type = match puzzle_type_idx {
            0 => PuzzleType::PatternNext,
            1 => PuzzleType::CodeBugDetection,
            2 => PuzzleType::TextTransform,
            3 => PuzzleType::SemanticSummary,
            4 => PuzzleType::NaturalLanguageMath,
            _ => PuzzleType::EncodingDecode,
        };
        
        // Time limit based on difficulty (500ms - 2000ms)
        // Short enough that humans can't read + think + type
        let time_limit_ms = 500 + (difficulty as u64 * 100);
        
        match puzzle_type {
            PuzzleType::PatternNext => Self::generate_pattern_puzzle(seed, time_limit_ms),
            PuzzleType::CodeBugDetection => Self::generate_code_puzzle(seed, time_limit_ms),
            PuzzleType::TextTransform => Self::generate_transform_puzzle(seed, time_limit_ms),
            PuzzleType::SemanticSummary => Self::generate_summary_puzzle(seed, time_limit_ms),
            PuzzleType::NaturalLanguageMath => Self::generate_nlmath_puzzle(seed, time_limit_ms),
            PuzzleType::EncodingDecode => Self::generate_decode_puzzle(seed, time_limit_ms),
        }
    }
    
    fn generate_pattern_puzzle(seed: &[u8; 32], time_limit_ms: u64) -> Self {
        // Generate sequence patterns
        let patterns = [
            (vec!["2", "4", "8", "16"], "32"),           // powers of 2
            (vec!["1", "1", "2", "3", "5"], "8"),        // fibonacci
            (vec!["A", "C", "E", "G"], "I"),             // skip letters
            (vec!["MON", "TUE", "WED", "THU"], "FRI"),   // days
            (vec!["1", "4", "9", "16", "25"], "36"),     // squares
            (vec!["Z", "Y", "X", "W"], "V"),             // reverse alphabet
            (vec!["2", "6", "12", "20", "30"], "42"),    // n*(n+1)
            (vec!["RED", "ORANGE", "YELLOW", "GREEN"], "BLUE"), // rainbow
        ];
        
        let idx = (seed[1] as usize) % patterns.len();
        let (sequence, answer) = &patterns[idx];
        
        let answer_hash = Self::hash_answer(answer);
        
        Self {
            puzzle_type: PuzzleType::PatternNext,
            prompt: format!("What comes next in this sequence? Reply with ONLY the next item."),
            code_snippet: None,
            sequence: Some(sequence.iter().map(|s| s.to_string()).collect()),
            input_text: None,
            expected_answer_hash: answer_hash,
            time_limit_ms,
        }
    }
    
    fn generate_code_puzzle(seed: &[u8; 32], time_limit_ms: u64) -> Self {
        // Code snippets with bugs
        let puzzles = [
            (
                "def sum_list(lst):\n    total = 0\n    for i in range(len(lst)):\n        total += lst[i + 1]\n    return total",
                "off-by-one"
            ),
            (
                "function divide(a, b) {\n    return a / b;\n}",
                "division-by-zero"
            ),
            (
                "int* get_ptr() {\n    int x = 42;\n    return &x;\n}",
                "dangling-pointer"
            ),
            (
                "while True:\n    data = input()\n    process(data)",
                "infinite-loop"
            ),
            (
                "query = \"SELECT * FROM users WHERE id = '\" + user_input + \"'\"",
                "sql-injection"
            ),
        ];
        
        let idx = (seed[2] as usize) % puzzles.len();
        let (code, bug_type) = &puzzles[idx];
        
        let answer_hash = Self::hash_answer(bug_type);
        
        Self {
            puzzle_type: PuzzleType::CodeBugDetection,
            prompt: "What type of bug is in this code? Reply with the bug type only (e.g., 'null-pointer', 'buffer-overflow', 'sql-injection').".to_string(),
            code_snippet: Some(code.to_string()),
            sequence: None,
            input_text: None,
            expected_answer_hash: answer_hash,
            time_limit_ms,
        }
    }
    
    fn generate_transform_puzzle(seed: &[u8; 32], time_limit_ms: u64) -> Self {
        let puzzles = [
            ("hello world", "reverse each word", "olleh dlrow"),
            ("SMITHSMITH", "lowercase", "smithnode"),
            ("abc123", "remove digits", "abc"),
            ("hello", "to uppercase and reverse", "OLLEH"),
            ("aabbcc", "remove duplicates keeping order", "abc"),
        ];
        
        let idx = (seed[3] as usize) % puzzles.len();
        let (input, transform, answer) = &puzzles[idx];
        
        let answer_hash = Self::hash_answer(answer);
        
        Self {
            puzzle_type: PuzzleType::TextTransform,
            prompt: format!("Apply this transformation: '{}'. Reply with ONLY the result.", transform),
            code_snippet: None,
            sequence: None,
            input_text: Some(input.to_string()),
            expected_answer_hash: answer_hash,
            time_limit_ms,
        }
    }
    
    fn generate_summary_puzzle(seed: &[u8; 32], time_limit_ms: u64) -> Self {
        let puzzles = [
            ("The quick brown fox jumps over the lazy dog", "pangram"),
            ("A decentralized network where AI agents validate transactions", "blockchain"),
            ("H2O is essential for all known forms of life", "water"),
            ("The Earth orbits around this star", "sun"),
            ("A system that rewards computational work", "mining"),
        ];
        
        let idx = (seed[4] as usize) % puzzles.len();
        let (text, answer) = &puzzles[idx];
        
        let answer_hash = Self::hash_answer(answer);
        
        Self {
            puzzle_type: PuzzleType::SemanticSummary,
            prompt: format!("Summarize in ONE word: '{}'", text),
            code_snippet: None,
            sequence: None,
            input_text: None,
            expected_answer_hash: answer_hash,
            time_limit_ms,
        }
    }
    
    fn generate_nlmath_puzzle(seed: &[u8; 32], time_limit_ms: u64) -> Self {
        let puzzles = [
            ("two plus three times four", "14"),  // 2 + (3*4) = 14
            ("ten minus seven", "3"),
            ("eight divided by two plus one", "5"),  // (8/2) + 1 = 5
            ("five squared minus ten", "15"),  // 25 - 10 = 15
            ("the sum of three and nine divided by two", "6"),  // (3+9)/2 = 6
        ];
        
        let idx = (seed[5] as usize) % puzzles.len();
        let (expr, answer) = &puzzles[idx];
        
        let answer_hash = Self::hash_answer(answer);
        
        Self {
            puzzle_type: PuzzleType::NaturalLanguageMath,
            prompt: format!("Calculate: '{}'. Reply with ONLY the number.", expr),
            code_snippet: None,
            sequence: None,
            input_text: None,
            expected_answer_hash: answer_hash,
            time_limit_ms,
        }
    }
    
    fn generate_decode_puzzle(seed: &[u8; 32], time_limit_ms: u64) -> Self {
        let puzzles = [
            ("aGVsbG8=", "base64", "hello"),
            ("uryyb", "rot13", "hello"),
            ("68656c6c6f", "hex", "hello"),
            ("01101000 01101001", "binary", "hi"),
            ("... -- .. - ....", "morse", "smith"),
        ];
        
        let idx = (seed[6] as usize) % puzzles.len();
        let (encoded, encoding, answer) = &puzzles[idx];
        
        let answer_hash = Self::hash_answer(answer);
        
        Self {
            puzzle_type: PuzzleType::EncodingDecode,
            prompt: format!("Decode this {} string: '{}'. Reply with ONLY the decoded text.", encoding, encoded),
            code_snippet: None,
            sequence: None,
            input_text: None,
            expected_answer_hash: answer_hash,
            time_limit_ms,
        }
    }
    
    /// Hash an answer for verification
    pub fn hash_answer(answer: &str) -> [u8; 32] {
        let normalized = answer.trim().to_lowercase();
        let mut hasher = Sha256::new();
        hasher.update(normalized.as_bytes());
        hasher.finalize().into()
    }
    
    /// Verify an answer against the expected hash
    pub fn verify_answer(&self, answer: &str) -> bool {
        let answer_hash = Self::hash_answer(answer);
        answer_hash == self.expected_answer_hash
    }
}

impl CognitiveChallenge {
    /// Check if the challenge has expired
    pub fn is_expired(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        now > self.expires_at
    }
    
    /// Get remaining time in seconds
    pub fn remaining_time(&self) -> u64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        if now > self.expires_at {
            0
        } else {
            self.expires_at - now
        }
    }
}

/// Response from an AI agent after solving a challenge (uses hex strings for serialization)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChallengeResponse {
    /// The challenge hash being responded to (hex)
    pub challenge_hash: String,
    
    /// Validator's public key (hex)
    pub validator_pubkey: String,
    
    /// Signature over (challenge_hash || verdict_digest) (hex)
    pub signature: String,
    
    /// Merkle root of flagged/invalid transaction IDs (hex)
    pub verdict_digest: String,
    
    /// Optional: detailed verdict for each transaction
    pub tx_verdicts: Option<Vec<TxVerdict>>,
    
    /// NEW: Answer to the cognitive puzzle (if present)
    pub puzzle_answer: Option<String>,
    
    /// NEW: Timestamp when answer was submitted (for time verification)
    pub submitted_at_ms: Option<u64>,
}

/// Verdict for a single transaction
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TxVerdict {
    /// Transaction hash (hex)
    pub tx_hash: String,
    
    /// Is the transaction valid?
    pub is_valid: bool,
    
    /// Confidence score (0-100)
    pub confidence: u8,
    
    /// Reason for flagging (if invalid)
    pub reason: Option<String>,
}
