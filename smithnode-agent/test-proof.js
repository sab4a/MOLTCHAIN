import fetch from 'node-fetch';
import crypto from 'crypto';
import * as ed from '@noble/ed25519';

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('RPC Error:', data.error);
    return null;
  }
  return data.result;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function test() {
  // Generate temp keypair
  const privateKey = crypto.randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const pubkeyHex = bytesToHex(publicKey);
  
  console.log('Pubkey:', pubkeyHex);
  
  // Register
  const regResult = await rpcCall('https://smithnode-rpc.fly.dev', 'smithnode_registerValidator', [{ pubkey: pubkeyHex }]);
  console.log('Register:', regResult);
  
  // Get challenge
  const challenge = await rpcCall('https://smithnode-rpc.fly.dev', 'smithnode_getChallenge', []);
  console.log('Challenge:', challenge);
  
  if (!challenge) {
    console.log('No challenge, creating new...');
    const newChallenge = await rpcCall('https://smithnode-rpc.fly.dev', 'smithnode_newChallenge', []);
    console.log('New challenge:', newChallenge);
  }
  
  // Create proof
  const verdictDigest = crypto.createHash('sha256').update('valid').digest();
  const challengeBytes = Buffer.from(challenge.challenge_hash, 'hex');
  const message = Buffer.concat([challengeBytes, verdictDigest]);
  const signature = await ed.signAsync(message, privateKey);
  
  // Submit
  const proof = {
    validator_pubkey: pubkeyHex,
    challenge_hash: challenge.challenge_hash,
    signature: bytesToHex(signature),
    verdict_digest: bytesToHex(verdictDigest),
  };
  console.log('Submitting proof...');
  const result = await rpcCall('https://smithnode-rpc.fly.dev', 'smithnode_submitProof', [proof]);
  console.log('Result:', result);
}

test().catch(console.error);
