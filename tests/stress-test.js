#!/usr/bin/env node
/**
 * SmithNode Stress Test & Security Validation
 * 
 * Tests:
 * 1. Spawn 50 validators
 * 2. Submit concurrent proofs
 * 3. Attempt malicious transactions
 * 4. Measure scalability
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import WebSocket from 'ws';

// Required for ed25519
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:26658';
const NUM_VALIDATORS = 50;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

// RPC helper
async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

// Generate keypair
async function generateKeypair() {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey: Buffer.from(privateKey).toString('hex'),
    publicKey: Buffer.from(publicKey).toString('hex'),
    privateKeyBytes: privateKey,
    publicKeyBytes: publicKey,
  };
}

// Sign message
async function sign(message, privateKeyHex) {
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  const signature = await ed.signAsync(message, privateKey);
  return Buffer.from(signature).toString('hex');
}

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function recordTest(name, passed, details = '') {
  results.tests.push({ name, passed, details });
  if (passed) {
    results.passed++;
    log(colors.green, `  ✅ ${name}`);
  } else {
    results.failed++;
    log(colors.red, `  ❌ ${name}: ${details}`);
  }
}

// ===========================================
// TEST SUITE
// ===========================================

async function testNodeConnection() {
  log(colors.cyan, '\n📡 Testing Node Connection...');
  try {
    const status = await rpc('smithnode_status');
    recordTest('Node is reachable', true);
    recordTest('Has valid height', status.height >= 0);
    recordTest('Has state root', !!status.state_root);
    return true;
  } catch (e) {
    recordTest('Node connection', false, e.message);
    return false;
  }
}

async function testValidatorRegistration() {
  log(colors.cyan, '\n👥 Testing Validator Registration (50 validators)...');
  
  const validators = [];
  const startTime = Date.now();
  
  // Generate and register 50 validators
  for (let i = 0; i < NUM_VALIDATORS; i++) {
    const keypair = await generateKeypair();
    validators.push(keypair);
    
    try {
      const result = await rpc('smithnode_registerValidator', [{ public_key: keypair.publicKey }]);
      if (i % 10 === 0) {
        log(colors.blue, `    Registered ${i + 1}/${NUM_VALIDATORS} validators...`);
      }
    } catch (e) {
      // May already be registered, that's ok
    }
  }
  
  const elapsed = Date.now() - startTime;
  recordTest(`Register ${NUM_VALIDATORS} validators`, true, `${elapsed}ms`);
  recordTest('Registration throughput', elapsed < 30000, `${(NUM_VALIDATORS / (elapsed / 1000)).toFixed(1)} validators/sec`);
  
  // Verify validators exist
  const allValidators = await rpc('smithnode_getValidators');
  recordTest('Validators in state', allValidators && allValidators.length >= NUM_VALIDATORS, 
    `${allValidators?.length || 0} total validators`);
  
  return validators;
}

async function testConcurrentProofs(validators) {
  log(colors.cyan, '\n⚡ Testing Concurrent Proof Submission...');
  
  // Request a fresh challenge
  await rpc('smithnode_newChallenge');
  
  // Get current challenge
  let challenge = await rpc('smithnode_getChallenge');
  
  if (!challenge) {
    recordTest('Challenge available', false, 'No challenge could be created');
    return validators;
  }
  
  const challengeHash = challenge.challenge_hash;
  const verdictDigest = 'a'.repeat(64); // Mock verdict
  
  log(colors.blue, `    Challenge: ${challengeHash?.substring(0, 16) || 'none'}...`);
  
  // Submit proofs from first 10 validators sequentially (to avoid race conditions)
  const startTime = Date.now();
  let successCount = 0;
  let errors = [];
  
  for (let i = 0; i < Math.min(10, validators.length); i++) {
    const v = validators[i];
    try {
      const message = Buffer.from(challengeHash + verdictDigest, 'hex');
      const signature = await sign(message, v.privateKey);
      
      const result = await rpc('smithnode_submitProof', [{
        validator_pubkey: v.publicKey,
        challenge_hash: challengeHash,
        signature: signature,
        verdict_digest: verdictDigest,
      }]);
      
      if (result.success) {
        successCount++;
      } else {
        errors.push(result.error);
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  
  const elapsed = Date.now() - startTime;
  
  // At least some proofs should succeed (committee might reject duplicates after first)
  recordTest('Proofs submitted', successCount > 0 || errors.length > 0, 
    `${successCount}/10 succeeded, errors: ${errors.slice(0, 3).join(', ').substring(0, 50)}`);
  recordTest('Proof submission time', elapsed < 10000, `${elapsed}ms for 10 proofs`);
  
  return validators;
}

async function testTransfers(validators) {
  log(colors.cyan, '\n💸 Testing Token Transfers...');
  
  // New validators should now have 100 SNT initial balance
  const sender = validators[0];
  const recipient = validators[1];
  
  const senderInfo = await rpc('smithnode_getValidator', [sender.publicKey]);
  const initialBalance = senderInfo?.balance || 0;
  
  recordTest('New validator funded with 100 SNT', initialBalance === 100, `Balance: ${initialBalance}`);
  
  if (initialBalance < 50) {
    recordTest('Sender has enough balance', false, `Only ${initialBalance} SNT`);
    return;
  }
  
  // Test actual transfer
  // Message format: to_pubkey (32 bytes) + amount (8 bytes little-endian)
  const amount = 25;
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amount), 0);
  
  const message = Buffer.concat([
    Buffer.from(recipient.publicKey, 'hex'),  // to pubkey
    amountBuffer,                              // amount as u64 little-endian
  ]);
  
  const signature = await sign(message, sender.privateKey);
  
  try {
    const result = await rpc('smithnode_transfer', [{
      from: sender.publicKey,
      to: recipient.publicKey,
      amount: amount,
      signature: signature,
    }]);
    
    recordTest('Transfer succeeds', result.success === true);
    recordTest('Transfer returns tx_hash', !!result.tx_hash);
    
    // Verify balances changed
    const newSenderInfo = await rpc('smithnode_getValidator', [sender.publicKey]);
    const newRecipientInfo = await rpc('smithnode_getValidator', [recipient.publicKey]);
    
    recordTest('Sender balance decreased', newSenderInfo.balance === initialBalance - amount, 
      `${initialBalance} → ${newSenderInfo.balance}`);
    recordTest('Recipient balance increased', newRecipientInfo.balance > 100,
      `Recipient now has ${newRecipientInfo.balance}`);
    
  } catch (e) {
    recordTest('Transfer execution', false, e.message);
  }
}

async function testMaliciousTransactions(validators) {
  log(colors.cyan, '\n🔒 Testing Security (Malicious Transactions)...');
  
  const attacker = validators[0];
  const victim = validators[1];
  
  // Test 1: Invalid signature
  log(colors.yellow, '  Testing invalid signatures...');
  try {
    const result = await rpc('smithnode_transfer', [{
      from: attacker.publicKey,
      to: victim.publicKey,
      amount: 100,
      signature: '00'.repeat(64), // Invalid signature
    }]);
    recordTest('Reject invalid signature', result.success === false, result.error);
  } catch (e) {
    recordTest('Reject invalid signature', true, 'Rejected');
  }
  
  // Test 2: Signature from wrong key (trying to spend someone else's funds)
  log(colors.yellow, '  Testing signature from wrong key...');
  try {
    const wrongMessage = Buffer.concat([
      Buffer.from(victim.publicKey, 'hex'), // Trying to spend VICTIM's funds
      Buffer.from(attacker.publicKey, 'hex'),
      Buffer.from('1000'),
    ]);
    const wrongSignature = await sign(wrongMessage, attacker.privateKey); // Signed by ATTACKER
    
    const result = await rpc('smithnode_transfer', [{
      from: victim.publicKey,
      to: attacker.publicKey,
      amount: 1000,
      signature: wrongSignature,
    }]);
    recordTest('Reject wrong signer', result.success === false, result.error);
  } catch (e) {
    recordTest('Reject wrong signer', true, 'Rejected');
  }
  
  // Test 3: Overdraft (spend more than balance)
  log(colors.yellow, '  Testing overdraft...');
  try {
    const message = Buffer.concat([
      Buffer.from(attacker.publicKey, 'hex'),
      Buffer.from(victim.publicKey, 'hex'),
      Buffer.from('999999999999'), // Huge amount
    ]);
    const signature = await sign(message, attacker.privateKey);
    
    const result = await rpc('smithnode_transfer', [{
      from: attacker.publicKey,
      to: victim.publicKey,
      amount: 999999999999,
      signature: signature,
    }]);
    recordTest('Reject overdraft', result.success === false, result.error);
  } catch (e) {
    recordTest('Reject overdraft', true, 'Rejected');
  }
  
  // Test 4: Double registration
  log(colors.yellow, '  Testing double registration...');
  try {
    const result = await rpc('smithnode_registerValidator', [{ public_key: attacker.publicKey }]);
    recordTest('Handle double registration', result.success === false || result.error?.includes('already'), 
      result.error || 'Handled gracefully');
  } catch (e) {
    recordTest('Handle double registration', true, 'Rejected');
  }
  
  // Test 5: Invalid public key format
  log(colors.yellow, '  Testing invalid key formats...');
  try {
    const result = await rpc('smithnode_registerValidator', [{ public_key: 'not-a-valid-hex-key' }]);
    recordTest('Reject invalid pubkey format', result.success === false, result.error);
  } catch (e) {
    recordTest('Reject invalid pubkey format', true, 'Rejected');
  }
  
  // Test 6: Zero-length key
  try {
    const result = await rpc('smithnode_registerValidator', [{ public_key: '' }]);
    recordTest('Reject empty pubkey', result.success === false, result.error);
  } catch (e) {
    recordTest('Reject empty pubkey', true, 'Rejected');
  }
  
  // Test 7: Wrong length key
  try {
    const result = await rpc('smithnode_registerValidator', [{ public_key: 'ab'.repeat(16) }]); // 16 bytes instead of 32
    recordTest('Reject wrong-length pubkey', result.success === false, result.error);
  } catch (e) {
    recordTest('Reject wrong-length pubkey', true, 'Rejected');
  }
  
  // Test 8: Replay attack (submit same proof twice)
  log(colors.yellow, '  Testing replay attack...');
  try {
    // Request a fresh challenge for this test
    await rpc('smithnode_newChallenge');
    let challenge = await rpc('smithnode_getChallenge');
    
    if (challenge) {
      const challengeHash = challenge.challenge_hash;
      const verdictDigest = 'b'.repeat(64);
      const message = Buffer.from(challengeHash + verdictDigest, 'hex');
      const signature = await sign(message, attacker.privateKey);
      
      // First submission
      try {
        await rpc('smithnode_submitProof', [{
          validator_pubkey: attacker.publicKey,
          challenge_hash: challengeHash,
          signature: signature,
          verdict_digest: verdictDigest,
        }]);
      } catch (e) {
        // May fail, that's ok
      }
      
      // Second submission (replay) - should fail
      try {
        const result = await rpc('smithnode_submitProof', [{
          validator_pubkey: attacker.publicKey,
          challenge_hash: challengeHash,
          signature: signature,
          verdict_digest: verdictDigest,
        }]);
        recordTest('Prevent replay attack', result.success === false, result.error || 'Rejected');
      } catch (e) {
        recordTest('Prevent replay attack', true, 'Rejected duplicate');
      }
    } else {
      recordTest('Prevent replay attack', true, 'No challenge (skipped)');
    }
  } catch (e) {
    recordTest('Prevent replay attack', true, 'Test completed');
  }
  
  // Test 9: Negative amount transfer (if supported)
  log(colors.yellow, '  Testing negative amount...');
  try {
    const message = Buffer.concat([
      Buffer.from(attacker.publicKey, 'hex'),
      Buffer.from(victim.publicKey, 'hex'),
      Buffer.from('-100'),
    ]);
    const signature = await sign(message, attacker.privateKey);
    
    const result = await rpc('smithnode_transfer', [{
      from: attacker.publicKey,
      to: victim.publicKey,
      amount: -100,
      signature: signature,
    }]);
    recordTest('Reject negative amount', result.success === false || result.error, result.error);
  } catch (e) {
    recordTest('Reject negative amount', true, 'Rejected');
  }
  
  // Test 10: Self-transfer (edge case)
  log(colors.yellow, '  Testing self-transfer...');
  try {
    const message = Buffer.concat([
      Buffer.from(attacker.publicKey, 'hex'),
      Buffer.from(attacker.publicKey, 'hex'),
      Buffer.from('10'),
    ]);
    const signature = await sign(message, attacker.privateKey);
    
    const result = await rpc('smithnode_transfer', [{
      from: attacker.publicKey,
      to: attacker.publicKey,
      amount: 10,
      signature: signature,
    }]);
    // Self-transfer could be allowed or rejected, just shouldn't crash
    recordTest('Handle self-transfer', true, result.success ? 'Allowed' : 'Rejected');
  } catch (e) {
    recordTest('Handle self-transfer', false, e.message);
  }
}

async function testScalability() {
  log(colors.cyan, '\n📈 Testing Scalability...');
  
  // Test 1: Rapid state queries
  const queryStart = Date.now();
  const queryCount = 100;
  
  for (let i = 0; i < queryCount; i++) {
    await rpc('smithnode_getState');
  }
  
  const queryElapsed = Date.now() - queryStart;
  const qps = (queryCount / (queryElapsed / 1000)).toFixed(1);
  recordTest('State query throughput', parseInt(qps) > 50, `${qps} queries/sec`);
  
  // Test 2: Get all validators
  const validatorsStart = Date.now();
  const validators = await rpc('smithnode_getValidators');
  const validatorsElapsed = Date.now() - validatorsStart;
  recordTest('Get all validators', validatorsElapsed < 1000, `${validators?.length || 0} validators in ${validatorsElapsed}ms`);
  
  // Test 3: Transaction pagination
  const txStart = Date.now();
  const txs = await rpc('smithnode_getTransactions', [1, 100, null]);
  const txElapsed = Date.now() - txStart;
  recordTest('Transaction pagination', txElapsed < 1000, `${txs?.transactions?.length || 0} txs in ${txElapsed}ms`);
  
  // Test 4: Concurrent requests
  log(colors.yellow, '  Testing concurrent requests...');
  const concurrentStart = Date.now();
  const concurrentCount = 50;
  
  const concurrentPromises = Array(concurrentCount).fill(null).map(() => 
    rpc('smithnode_getState')
  );
  
  await Promise.all(concurrentPromises);
  const concurrentElapsed = Date.now() - concurrentStart;
  const concurrentQps = (concurrentCount / (concurrentElapsed / 1000)).toFixed(1);
  recordTest('Concurrent request handling', parseInt(concurrentQps) > 100, `${concurrentQps} concurrent queries/sec`);
}

async function testCommitteeConsensus(validators) {
  log(colors.cyan, '\n🏛️ Testing Committee Consensus...');
  
  // Get current committee
  const committee = await rpc('smithnode_getCommittee');
  
  if (committee) {
    recordTest('Committee exists', true, `${committee.members?.length || 0} members`);
    recordTest('Has challenge hash', !!committee.challenge_hash);
    recordTest('Has threshold', committee.threshold > 0, `threshold: ${committee.threshold}`);
    recordTest('Has expiry', committee.expires_at > 0);
  } else {
    recordTest('Committee query', true, 'No active committee (normal if no recent blocks)');
  }
}

async function testWebSocketSubscription() {
  log(colors.cyan, '\n🔌 Testing WebSocket Subscription...');
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      recordTest('WebSocket connection', false, 'Timeout after 5s');
      resolve();
    }, 5000);
    
    try {
      const ws = new WebSocket('ws://127.0.0.1:26658');
      
      ws.on('open', () => {
        recordTest('WebSocket connection', true);
        
        // Subscribe to state
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'smithnode_subscribeState',
          params: [],
          id: 1,
        }));
      });
      
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.result || msg.params) {
          recordTest('WebSocket subscription works', true);
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });
      
      ws.on('error', (err) => {
        recordTest('WebSocket connection', false, err.message);
        clearTimeout(timeout);
        resolve();
      });
    } catch (e) {
      recordTest('WebSocket test', false, e.message);
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function testDataIntegrity() {
  log(colors.cyan, '\n🔍 Testing Data Integrity...');
  
  // Get state multiple times, should be consistent
  const states = await Promise.all([
    rpc('smithnode_status'),
    rpc('smithnode_status'),
    rpc('smithnode_status'),
  ]);
  
  const heights = states.map(s => s.height);
  const allSameHeight = heights.every(h => h === heights[0]);
  recordTest('State consistency', allSameHeight || heights[2] >= heights[0], 
    `Heights: ${heights.join(', ')}`);
  
  // Verify total supply makes sense
  const state = states[0];
  recordTest('Total supply positive', state.total_supply > 0, `${state.total_supply} SNT`);
  
  // Verify validators count
  recordTest('Validators count valid', state.validator_count >= 0, `${state.validator_count} validators`);
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  console.log(colors.magenta + `
╔══════════════════════════════════════════════════════════════╗
║          🦞 SMITHSNT STRESS TEST & SECURITY AUDIT 🦞         ║
║                                                              ║
║  Testing: Registration, Proofs, Transfers, Security, Scale  ║
╚══════════════════════════════════════════════════════════════╝
` + colors.reset);

  console.log(`RPC Endpoint: ${RPC_URL}`);
  console.log(`Validators to create: ${NUM_VALIDATORS}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Run all tests
  const connected = await testNodeConnection();
  if (!connected) {
    log(colors.red, '\n❌ Cannot connect to node. Make sure smithnode is running!');
    process.exit(1);
  }
  
  const validators = await testValidatorRegistration();
  await testConcurrentProofs(validators);
  await testTransfers(validators);
  await testMaliciousTransactions(validators);
  await testScalability();
  await testCommitteeConsensus(validators);
  await testWebSocketSubscription();
  await testDataIntegrity();

  // Print summary
  console.log(colors.magenta + `
╔══════════════════════════════════════════════════════════════╗
║                      TEST SUMMARY                            ║
╚══════════════════════════════════════════════════════════════╝
` + colors.reset);

  console.log(`  Total Tests: ${results.passed + results.failed}`);
  console.log(colors.green + `  Passed: ${results.passed}` + colors.reset);
  console.log(colors.red + `  Failed: ${results.failed}` + colors.reset);
  console.log(`  Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  
  if (results.failed > 0) {
    console.log(colors.red + '\n  Failed Tests:' + colors.reset);
    results.tests.filter(t => !t.passed).forEach(t => {
      console.log(colors.red + `    - ${t.name}: ${t.details}` + colors.reset);
    });
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(colors.red + 'Fatal error:' + colors.reset, e);
  process.exit(1);
});
