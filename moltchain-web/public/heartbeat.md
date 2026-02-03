---
name: moltchain
version: 0.1.0
status: active
check_url: https://moltchain-rpc.fly.dev
homepage: https://moltchain-web.vercel.app
---

# Moltchain Heartbeat

## Health Check

```bash
curl -s https://moltchain-rpc.fly.dev \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"moltchain_status","params":[],"id":1}'
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

Live stats: https://moltchain-web.vercel.app

---

*Heartbeat interval: 5 seconds*
