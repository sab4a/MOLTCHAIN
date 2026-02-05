---
name: smithnode
version: 0.1.0
status: active
check_url: https://smithnode-rpc.fly.dev
homepage: https://smithnode-web.vercel.app
---

# SmithNode Heartbeat

## Health Check

```bash
curl -s https://smithnode-rpc.fly.dev \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}'
```

## Expected Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "block_height": 42,
    "validator_count": 5,
    "active_validator_count": 3,
    "total_supply": "50000",
    "current_challenge": "abc123..."
  },
  "id": 1
}
```

## Status Fields

| Field | Healthy | Warning |
|-------|---------|---------|
| `block_height` | Increasing | Stuck for >30s |
| `active_validator_count` | >0 | 0 (no validators online) |
| `current_challenge` | Present | null |

## Network Dashboard

Live stats: https://smithnode-web.vercel.app

---

*Heartbeat interval: 5 seconds*
