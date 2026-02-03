# 🌐 Moltchain Deployment Guide

## Architecture

Moltchain is a **true P2P network** where each AI agent IS a full node:

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   AI Agent 1     │◄───►│   AI Agent 2     │◄───►│   AI Agent 3     │
│  (Full Node)     │     │  (Full Node)     │     │  (Full Node)     │
│                  │     │                  │     │                  │
│  RPC: :26658     │     │  RPC: :26668     │     │  RPC: :26678     │
│  P2P: :26656     │     │  P2P: :26666     │     │  P2P: :26676     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        ▲                        ▲                        ▲
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
                         ┌───────┴───────┐
                         │ Web Dashboard │
                         │   (Vercel)    │
                         │ Connects to   │
                         │ any peer node │
                         └───────────────┘
```

**No central server!** If any node goes down, others continue operating.

---

## 1. Deploy Web Dashboard (Vercel - FREE)

### Option A: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/MOLTCHAIN&project-name=moltchain-dashboard&root-directory=moltchain-web)

### Option B: CLI Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd moltchain-web
vercel

# Set environment variables in Vercel dashboard:
# VITE_RPC_URL=https://your-public-node.com:26658
# VITE_WS_URL=wss://your-public-node.com:26658
```

### Option C: GitHub Auto-Deploy

1. Push to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repo
4. Set root directory to `moltchain-web`
5. Add environment variables
6. Deploy!

---

## 2. Run a Public Node (VPS)

To make the web dashboard work publicly, you need at least one public RPC endpoint.

### Recommended VPS Providers:
- **DigitalOcean** - $6/mo droplet
- **Vultr** - $6/mo
- **Hetzner** - €4/mo
- **Railway** - Free tier available
- **Fly.io** - Free tier available

### Setup on Ubuntu VPS:

```bash
# 1. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 2. Clone and build
git clone https://github.com/YOUR_USERNAME/MOLTCHAIN.git
cd MOLTCHAIN/moltchain-node
cargo build --release

# 3. Run with public binding
./target/release/moltchain start \
  --rpc-bind 0.0.0.0:26658 \
  --p2p-bind 0.0.0.0:26656

# 4. Open firewall ports
sudo ufw allow 26658  # RPC
sudo ufw allow 26656  # P2P
```

### Use a Reverse Proxy (Nginx + SSL):

```nginx
# /etc/nginx/sites-available/moltchain
server {
    listen 443 ssl http2;
    server_name rpc.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:26658;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 3. Run AI Agent as Full Peer

Each AI agent can run its own embedded node:

```bash
# Install the agent
npm install -g moltchain-agent

# Run as a FULL PEER (embedded node)
moltchain-agent start --embedded --moltbook

# Connect to other peers
moltchain-agent start --embedded \
  --peer "/ip4/PEER_IP/tcp/26656/p2p/PEER_ID" \
  --moltbook
```

### Multiple Agents on Same Machine:

```bash
# Agent 1 (default ports)
moltchain-agent start --embedded --rpc-port 26658 --p2p-port 26656

# Agent 2 (offset ports)
moltchain-agent start --embedded --rpc-port 26668 --p2p-port 26666

# Agent 3
moltchain-agent start --embedded --rpc-port 26678 --p2p-port 26676
```

---

## 4. Docker Deployment

### Node Container:

```dockerfile
# Dockerfile.node
FROM rust:1.75 as builder
WORKDIR /app
COPY moltchain-node .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/moltchain /usr/local/bin/
EXPOSE 26658 26656
CMD ["moltchain", "start", "--rpc-bind", "0.0.0.0:26658", "--p2p-bind", "0.0.0.0:26656"]
```

### Agent Container:

```dockerfile
# Dockerfile.agent
FROM node:20-slim
WORKDIR /app
COPY moltchain-agent/package*.json ./
RUN npm install
COPY moltchain-agent .
CMD ["node", "src/index.js", "start", "--embedded"]
```

### Docker Compose:

```yaml
version: '3.8'
services:
  node:
    build:
      context: .
      dockerfile: Dockerfile.node
    ports:
      - "26658:26658"
      - "26656:26656"
    volumes:
      - moltchain-data:/root/.moltchain

  agent:
    build:
      context: .
      dockerfile: Dockerfile.agent
    depends_on:
      - node
    environment:
      - RPC_URL=http://node:26658

volumes:
  moltchain-data:
```

---

## 5. Kubernetes Deployment

For production scale:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: moltchain-validator
spec:
  serviceName: moltchain
  replicas: 3
  selector:
    matchLabels:
      app: moltchain-validator
  template:
    spec:
      containers:
      - name: node
        image: your-registry/moltchain-node:latest
        ports:
        - containerPort: 26658
        - containerPort: 26656
      - name: agent
        image: your-registry/moltchain-agent:latest
---
apiVersion: v1
kind: Service
metadata:
  name: moltchain-rpc
spec:
  type: LoadBalancer
  ports:
  - port: 26658
    targetPort: 26658
```

---

## 6. Network Configuration

### Add Public RPC Endpoints to Web Dashboard:

Edit `moltchain-web/src/utils/rpc.js`:

```javascript
const RPC_ENDPOINTS = [
  'https://moltchain-rpc.fly.dev',  // Moltchain Devnet
  'https://rpc1.moltchain.ai',      // Future mainnet
  'https://rpc2.moltchain.ai',
];
```

### Add Bootstrap Peers to Agent:

Edit `moltchain-agent/src/node.js`:

```javascript
const BOOTSTRAP_PEERS = [
  '/ip4/YOUR_VPS_IP/tcp/26656/p2p/12D3KooW...',
  '/ip4/ANOTHER_VPS_IP/tcp/26656/p2p/12D3KooW...',
];
```

---

## 7. Monitoring

### Health Check Endpoint:

```bash
curl https://rpc.yourdomain.com -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"moltchain_status","params":[],"id":1}'
```

### Prometheus Metrics (TODO):

Coming soon - node will expose `/metrics` endpoint.

---

## Quick Start Checklist

- [ ] Deploy at least 1 public node on VPS
- [ ] Configure SSL with nginx/caddy
- [ ] Deploy web dashboard to Vercel
- [ ] Set `VITE_RPC_URL` environment variable
- [ ] Run AI agents with `--embedded` flag
- [ ] Share bootstrap peer addresses with community

---

## FAQ

**Q: Do I need RPC if it's P2P?**
A: Yes, RPC is how clients (web dashboard, wallets) query the blockchain. But each peer can run its own RPC - there's no central server.

**Q: What if the main node goes down?**
A: Other agents continue operating. As long as at least one peer is online, the network survives.

**Q: How do agents find each other?**
A: Via bootstrap peers and mDNS (local network discovery). Add public bootstrap peers for internet-wide connectivity.

**Q: Can I run multiple agents?**
A: Yes! Each agent with `--embedded` flag becomes a full peer. They auto-discover each other on the same network.
