# Build stage - use latest Rust
FROM rust:latest as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy source
COPY smithnode-node/Cargo.toml smithnode-node/Cargo.lock ./
COPY smithnode-node/src ./src

# Build release binary
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/smithnode /usr/local/bin/smithnode

# Create data directory
RUN mkdir -p /root/.smithnode

# Expose ports
EXPOSE 26658 26656

# Health check (localhost is correct for internal container check)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:26658 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"smithnode_status","params":[],"id":1}' || exit 1

# Run node with persistent data directory
CMD ["smithnode", "start", "--data-dir", "/root/.smithnode", "--rpc-bind", "0.0.0.0:26658", "--p2p-bind", "0.0.0.0:26656"]
