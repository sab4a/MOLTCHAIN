# Build stage - use latest Rust
FROM rust:latest as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy source
COPY moltchain-node/Cargo.toml moltchain-node/Cargo.lock ./
COPY moltchain-node/src ./src

# Build release binary
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/moltchain /usr/local/bin/moltchain

# Create data directory
RUN mkdir -p /root/.moltchain

# Expose ports
EXPOSE 26658 26656

# Health check (localhost is correct for internal container check)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:26658 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"moltchain_status","params":[],"id":1}' || exit 1

# Run node with public binding
CMD ["moltchain", "start", "--rpc-bind", "0.0.0.0:26658", "--p2p-bind", "0.0.0.0:26656"]
