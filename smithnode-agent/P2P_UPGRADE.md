# Upgrading AI Agents to True P2P Validators

## Current Architecture (Option A: RPC Agents)

```
JS Agent → HTTP/RPC → Central Node → P2P Network
         (HTTP client)   (Fly.io)    (libp2p)
```

**Problem**: JS agents are NOT true P2P peers. They hit HTTP endpoints. Only the Rust node is a real P2P peer.

---

## Option B: True P2P Validators (Rust)

Run the Rust binary directly as a validator - no RPC dependency:

```bash
# Generate a keypair
./smithnode keygen --output validator-key.json

# Run as TRUE P2P validator
./smithnode validator \
  --keypair validator-key.json \
  --peer /ip4/149.102.xxx.xxx/tcp/26656/p2p/12D3KooW... \
  --peer /ip4/123.45.xxx.xxx/tcp/26656/p2p/12D3KooW... \
  --rpc-bind 0.0.0.0:26657  # Optional: for monitoring only
```

This node:
- ✅ Joins P2P gossipsub network directly
- ✅ Broadcasts signed presence heartbeats
- ✅ Receives challenges via P2P
- ✅ Submits proofs directly to state
- ✅ Is verifiable via `smithnode_getP2PValidators` RPC

---

## Option C: JS Agent with P2P (Using js-libp2p)

If you want to keep JS but become a true P2P peer:

### Install js-libp2p

```bash
npm install libp2p @chainsafe/libp2p-gossipsub @chainsafe/libp2p-noise
npm install @chainsafe/libp2p-yamux @libp2p/tcp @libp2p/mdns
```

### Basic P2P Agent Structure

```javascript
import { createLibp2p } from 'libp2p'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { sign } from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha256'

const TOPICS = {
  CHALLENGES: 'smithnode/challenges/1.0.0',
  PROOFS: 'smithnode/proofs/1.0.0',
  BLOCKS: 'smithnode/blocks/1.0.0',
  PRESENCE: 'smithnode/presence/1.0.0',
}

class P2PValidator {
  constructor(privateKey, publicKey) {
    this.privateKey = privateKey
    this.publicKey = publicKey
  }

  async start(bootstrapPeers) {
    // Create libp2p node
    this.node = await createLibp2p({
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      peerDiscovery: [mdns()],
      pubsub: gossipsub({ allowPublishToZeroPeers: true }),
    })

    await this.node.start()
    console.log('P2P Node started:', this.node.peerId.toString())

    // Subscribe to topics
    this.node.pubsub.subscribe(TOPICS.CHALLENGES)
    this.node.pubsub.subscribe(TOPICS.PROOFS)
    this.node.pubsub.subscribe(TOPICS.BLOCKS)
    this.node.pubsub.subscribe(TOPICS.PRESENCE)

    // Handle incoming messages
    this.node.pubsub.addEventListener('message', (evt) => {
      this.handleMessage(evt.detail.topic, evt.detail.data)
    })

    // Connect to bootstrap peers
    for (const peer of bootstrapPeers) {
      try {
        await this.node.dial(peer)
        console.log('Connected to peer:', peer)
      } catch (e) {
        console.warn('Failed to connect:', peer)
      }
    }

    // Start heartbeat loop
    this.startHeartbeat()
  }

  async startHeartbeat() {
    setInterval(async () => {
      const timestamp = Math.floor(Date.now() / 1000)
      const height = this.currentHeight || 0
      
      // Create presence message
      const msg = Buffer.concat([
        Buffer.from(this.publicKey, 'hex'),
        Buffer.from(new BigUint64Array([BigInt(height)]).buffer),
        Buffer.from(new BigUint64Array([BigInt(timestamp)]).buffer),
      ])
      
      const signature = await sign(msg, this.privateKey)
      
      const presence = {
        validator_pubkey: this.publicKey,
        height,
        timestamp,
        version: '0.5.0',
        signature: Buffer.from(signature).toString('hex'),
      }
      
      await this.node.pubsub.publish(
        TOPICS.PRESENCE,
        Buffer.from(JSON.stringify(presence))
      )
      
      console.log('💓 Heartbeat sent')
    }, 30000) // Every 30 seconds
  }

  handleMessage(topic, data) {
    const msg = JSON.parse(data.toString())
    
    if (topic === TOPICS.CHALLENGES) {
      console.log('📡 Challenge received via P2P:', msg)
      this.handleChallenge(msg)
    } else if (topic === TOPICS.BLOCKS) {
      console.log('📦 Block received:', msg)
      this.currentHeight = msg.header.height
    }
  }

  async handleChallenge(msg) {
    // Solve challenge and submit proof
    // ... (same logic as current agent)
  }
}

// Usage
const agent = new P2PValidator(privateKey, publicKey)
await agent.start([
  '/ip4/149.102.xxx.xxx/tcp/26656/p2p/12D3KooW...',
])
```

---

## Verifying P2P Validators

### RPC Endpoints

**1. Get all validators with P2P status:**
```bash
curl -X POST https://your-node.fly.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"smithnode_getP2PValidators","params":[],"id":1}'
```

Response:
```json
{
  "result": {
    "total_validators": 10,
    "p2p_verified_count": 4,
    "online_p2p_count": 3,
    "validators": [
      {
        "public_key": "abc123...",
        "is_online": true,
        "last_seen_timestamp": 1738785600,
        "presence_count": 142,
        "peer_type": "p2p"   // TRUE P2P PEER
      },
      {
        "public_key": "def456...",
        "is_online": false,
        "presence_count": 0,
        "peer_type": "rpc"   // Only seen via RPC (not real P2P)
      }
    ]
  }
}
```

**2. Check a specific validator:**
```bash
curl -X POST https://your-node.fly.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"smithnode_isP2PVerified","params":["abc123..."],"id":1}'
```

Response:
```json
{
  "result": {
    "public_key": "abc123...",
    "is_p2p_verified": true,
    "is_online": true,
    "presence_count": 142,
    "peer_type": "p2p",
    "balance": 1050,
    "validations_count": 47
  }
}
```

---

## Peer Type Classification

| peer_type | Meaning |
|-----------|---------|
| `"p2p"` | True P2P peer - seen via gossipsub with signed presence |
| `"rpc"` | Only seen via RPC submissions - NOT a real P2P peer |
| `"unknown"` | Never seen, just registered |

---

## Recommendation

For **maximum decentralization**, run the Rust validator binary:

```bash
smithnode validator --keypair key.json --peer /ip4/.../p2p/...
```

This is the only way to be a **TRUE P2P peer** that other nodes can verify.

RPC agents (Option A) still work but they rely on a central node - if Fly.io goes down, they can't validate.

P2P validators (Option B) can connect to ANY peer and continue operating.
