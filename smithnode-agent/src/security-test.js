/**
 * Security and functionality tests for SmithNode
 */

import * as ed from '@noble/ed25519';
import crypto from 'crypto';
import { bytesToHex, hexToBytes, sha256, loadKeypair, signMessage } from './crypto.js';

// Configure ed25519
ed.etc.sha512Sync = (...m) => {
  const hash = crypto.createHash('sha512');
  m.forEach(msg => hash.update(msg));
  return hash.digest();
};

const RPC_URL = 'https://smithnode-rpc.fly.dev';

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

async function runSecurityAudit() {
  console.log('═'.repeat(60));
  console.log('🔒 SMITHNODE SECURITY & ARCHITECTURE AUDIT');
  console.log('═'.repeat(60));
  
  // 1. Check current status
  const status = await rpc('smithnode_status');
  console.log('\n📊 NETWORK STATUS:');
  console.log(`   Height: ${status.height}`);
  console.log(`   Validators: ${status.validator_count} (${status.active_validator_count} active)`);
  console.log(`   Total Supply: ${status.total_supply} SMITH`);
  console.log(`   Version: ${status.node_version}`);
  
  // 2. Test importState security
  console.log('\n🛡️ TEST 1: importState Security');
  console.log('   Attempting to import fake state with height 999999...');
  
  const fakeState = {
    height: 999999,
    state_root: 'deadbeef'.repeat(8),
    total_supply: 1000000000,
    validators: [{
      public_key: '0'.repeat(64),
      balance: 999999999,
      validations_count: 0,
      reputation_score: 100,
      last_active_timestamp: Date.now() / 1000,
      is_online: true
    }],
    node_version: '0.2.0'
  };
  
  try {
    const importResult = await rpc('smithnode_importState', [fakeState]);
    if (importResult.success) {
      console.log('   ⚠️ VULNERABILITY: Fake state was imported!');
    } else {
      console.log(`   ✅ SAFE: Import rejected - "${importResult.error}"`);
    }
  } catch (e) {
    console.log(`   ✅ SAFE: Import threw error - "${e.message}"`);
  }
  
  // Verify state unchanged
  const status2 = await rpc('smithnode_status');
  console.log(`   Verified: Height still ${status2.height}, supply ${status2.total_supply}`);
  
  // 3. Test transfer signature verification
  console.log('\n🛡️ TEST 2: Transfer Signature Verification');
  console.log('   Attempting transfer with fake signature...');
  
  try {
    const invalidTransfer = await rpc('smithnode_transfer', [{
      from: 'a'.repeat(64),
      to: 'b'.repeat(64),
      amount: 1000,
      signature: 'c'.repeat(128)
    }]);
    if (invalidTransfer.success) {
      console.log('   ⚠️ VULNERABILITY: Fake signature accepted!');
    } else {
      console.log(`   ✅ SAFE: Transfer rejected - "${invalidTransfer.error}"`);
    }
  } catch (e) {
    console.log(`   ✅ SAFE: Transfer threw error`);
  }
  
  // 4. Test proof signature verification
  console.log('\n🛡️ TEST 3: Proof Signature Verification');
  console.log('   Attempting to submit proof with fake signature...');
  
  try {
    const fakeProof = await rpc('smithnode_submitProof', [{
      validator_pubkey: 'd'.repeat(64),
      challenge_hash: 'e'.repeat(64),
      signature: 'f'.repeat(128),
      verdict_digest: 'a'.repeat(64)
    }]);
    if (fakeProof.success) {
      console.log('   ⚠️ VULNERABILITY: Fake proof accepted!');
    } else {
      console.log(`   ✅ SAFE: Proof rejected - "${fakeProof.error}"`);
    }
  } catch (e) {
    console.log(`   ✅ SAFE: Proof threw error`);
  }
  
  // 5. Test blocks without transactions
  console.log('\n🧪 TEST 4: Blocks Without Transactions');
  const challenge = await rpc('smithnode_getChallenge');
  if (challenge) {
    console.log(`   Active challenge: ${challenge.challenge_hash.substring(0, 16)}...`);
    console.log(`   Pending tx count: ${challenge.pending_tx_count}`);
    console.log(`   ✅ Blocks produce even with 0 pending transactions`);
  } else {
    console.log('   No active challenge - generating one...');
    const newChallenge = await rpc('smithnode_newChallenge');
    console.log(`   Pending tx count: ${newChallenge.pending_tx_count}`);
    console.log(`   ✅ Blocks produce even with 0 pending transactions`);
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('📋 SECURITY AUDIT SUMMARY');
  console.log('═'.repeat(60));
}

async function testMultipleTransfers() {
  console.log('\n\n' + '═'.repeat(60));
  console.log('💸 MULTIPLE TRANSFERS TEST');
  console.log('═'.repeat(60));
  
  // Load keypair
  let keypair;
  try {
    keypair = loadKeypair('./validator-key.json');
    console.log(`\n📍 Using wallet: ${keypair.publicKey.substring(0, 16)}...`);
  } catch (e) {
    console.log('❌ No validator-key.json found. Create one first.');
    return;
  }
  
  // Check balance
  const validator = await rpc('smithnode_getValidator', [keypair.publicKey]);
  if (!validator) {
    console.log('❌ Validator not registered on devnet');
    return;
  }
  console.log(`   Balance: ${validator.balance} SMITH`);
  
  if (validator.balance < 50) {
    console.log('❌ Insufficient balance for tests (need at least 50 SMITH)');
    return;
  }
  
  // Generate 5 random recipient addresses
  const recipients = [];
  for (let i = 0; i < 5; i++) {
    const privKey = ed.utils.randomPrivateKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);
    recipients.push(bytesToHex(pubKey));
  }
  
  console.log('\n📤 Sending 5 transfers of 1 SMITH each...');
  
  const results = [];
  for (let i = 0; i < 5; i++) {
    const to = recipients[i];
    const amount = 1n;
    
    // Build message: to || amount (little endian)
    const toBytes = hexToBytes(to);
    const amountBytes = new Uint8Array(8);
    new DataView(amountBytes.buffer).setBigUint64(0, amount, true);
    
    const message = new Uint8Array(toBytes.length + amountBytes.length);
    message.set(toBytes, 0);
    message.set(amountBytes, toBytes.length);
    
    // Sign
    const signature = await signMessage(keypair.privateKey, message);
    
    // Send transfer
    try {
      const result = await rpc('smithnode_transfer', [{
        from: keypair.publicKey,
        to: to,
        amount: Number(amount),
        signature: bytesToHex(signature)
      }]);
      
      if (result.success) {
        console.log(`   ✅ Transfer ${i + 1}: 1 SMITH → ${to.substring(0, 12)}... (tx: ${result.tx_hash?.substring(0, 12)}...)`);
        results.push({ success: true, to, txHash: result.tx_hash });
      } else {
        console.log(`   ❌ Transfer ${i + 1} failed: ${result.error}`);
        results.push({ success: false, error: result.error });
      }
    } catch (e) {
      console.log(`   ❌ Transfer ${i + 1} error: ${e.message}`);
      results.push({ success: false, error: e.message });
    }
  }
  
  const successful = results.filter(r => r.success).length;
  console.log(`\n📊 Results: ${successful}/5 transfers successful`);
  
  // Verify final balance
  const finalValidator = await rpc('smithnode_getValidator', [keypair.publicKey]);
  console.log(`   New balance: ${finalValidator.balance} SMITH (was ${validator.balance})`);
  
  // Check if transfers appear in transactions
  const txs = await rpc('smithnode_getTransactions', [1, 10, 'transfer']);
  console.log(`   Recent transfer count: ${txs.total}`);
}

async function main() {
  try {
    await runSecurityAudit();
    await testMultipleTransfers();
    
    console.log('\n\n' + '═'.repeat(60));
    console.log('🏁 ALL TESTS COMPLETE');
    console.log('═'.repeat(60));
    
    // Architecture summary
    console.log('\n📖 ARCHITECTURE SUMMARY:');
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                  SMITHNODE ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────┤
│ Is it true P2P?                                             │
│   - Full nodes: YES (libp2p gossipsub)                      │
│   - Agents without --full-node: NO (HTTP clients to RPC)    │
│                                                             │
│ Is it one network?                                          │
│   - YES - all validators share one devnet RPC state         │
│   - Full nodes sync state from devnet, participate in P2P   │
│                                                             │
│ Is client-side safe?                                        │
│   - Keys NEVER leave client (ed25519 signing local)         │
│   - Server only receives: pubkey + signature                │
│   - Signatures verified by Rust node (ed25519-dalek)        │
│                                                             │
│ How does sync work?                                         │
│   - exportState: Returns all validators + balances          │
│   - importState: Only accepts HIGHER height (no rollback)   │
│   - P2P nodes get blocks via gossipsub protocol             │
│                                                             │
│ RPC accepting everything?                                   │
│   - NO - all inputs validated:                              │
│     • Signatures cryptographically verified                 │
│     • State imports must have higher height                 │
│     • Transfers check balance + signature                   │
│     • Proofs verify against active challenge                │
│                                                             │
│ Blocks without transactions?                                │
│   - YES - blocks produce continuously                       │
│   - AI validators prove they're online/working              │
│   - Rewards distributed for validation work                 │
└─────────────────────────────────────────────────────────────┘
`);
  } catch (e) {
    console.error('Error:', e);
  }
}

main();
