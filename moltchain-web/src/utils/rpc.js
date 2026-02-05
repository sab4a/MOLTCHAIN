/**
 * SmithNode RPC Client with WebSocket Subscription Support
 * 
 * Supports multiple RPC endpoints for true P2P resilience.
 * If one node goes down, automatically tries others.
 */

// RPC endpoints - Fly.io devnet is the primary network
const RPC_ENDPOINTS = [
  import.meta.env.VITE_RPC_URL,
  'https://smithnode-rpc.fly.dev',  // SmithNode Devnet
].filter(Boolean);

const WS_ENDPOINTS = [
  import.meta.env.VITE_WS_URL,
  'wss://smithnode-rpc.fly.dev',    // SmithNode Devnet WebSocket
].filter(Boolean);

// Track which endpoint is currently working
let currentRpcIndex = 0;
let currentWsIndex = 0;

let rpcId = 0;

/**
 * Try RPC call with automatic failover to other endpoints
 */
export async function rpc(method, params = []) {
  const startIndex = currentRpcIndex;
  
  // Try each endpoint until one works
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const index = (startIndex + i) % RPC_ENDPOINTS.length;
    const endpoint = RPC_ENDPOINTS[index];
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++rpcId,
          method,
          params,
        }),
      });

      const json = await response.json();
      
      if (json.error) {
        throw new Error(json.error.message || JSON.stringify(json.error));
      }
      
      // This endpoint works, remember it
      currentRpcIndex = index;
      return json.result;
    } catch (error) {
      console.warn(`RPC endpoint ${endpoint} failed:`, error.message);
      // Try next endpoint
      continue;
    }
  }
  
  // All endpoints failed
  throw new Error('Cannot connect to any SmithNode. Check if nodes are running or add more RPC endpoints.');
}

/**
 * WebSocket subscription manager with failover support
 */
class StateSubscription {
  constructor() {
    this.ws = null;
    this.listeners = new Set();
    this.reconnectTimeout = null;
    this.subscriptionId = null;
    this.currentEndpointIndex = 0;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    const wsUrl = WS_ENDPOINTS[this.currentEndpointIndex];
    if (!wsUrl) {
      console.error('No WebSocket endpoints available');
      return;
    }
    
    try {
      console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('🔌 WebSocket connected to', wsUrl);
        // Subscribe to state updates
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: ++rpcId,
          method: 'smithnode_subscribeState',
          params: [],
        }));
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle subscription confirmation
          if (data.result && !data.params) {
            this.subscriptionId = data.result;
            console.log('📡 Subscribed to state updates:', this.subscriptionId);
            return;
          }
          
          // Handle subscription events
          if (data.params?.result) {
            const stateEvent = data.params.result;
            this.listeners.forEach(listener => listener(stateEvent));
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };
      
      this.ws.onclose = () => {
        console.log('🔌 WebSocket disconnected, trying next endpoint...');
        // Try next endpoint on reconnect
        this.currentEndpointIndex = (this.currentEndpointIndex + 1) % WS_ENDPOINTS.length;
        this.scheduleReconnect();
      };
      
      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      this.scheduleReconnect();
    }
  }
  
  scheduleReconnect() {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 3000);
  }
  
  subscribe(listener) {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.disconnect();
      }
    };
  }
  
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const stateSubscription = new StateSubscription();

// API Methods
export const api = {
  getStatus: () => rpc('smithnode_status'),
  getChallenge: () => rpc('smithnode_getChallenge'),
  newChallenge: () => rpc('smithnode_newChallenge'),
  getValidators: () => rpc('smithnode_getValidators'),
  getValidator: (pubkey) => rpc('smithnode_getValidator', [pubkey]),
  registerValidator: (publicKey) => rpc('smithnode_registerValidator', [{ public_key: publicKey }]),
  submitProof: (data) => rpc('smithnode_submitProof', [data]),
  // Transfer now requires nonce to prevent replay attacks
  transfer: (from, to, amount, nonce, signature) => rpc('smithnode_transfer', [{ from, to, amount, nonce, signature }]),
  getTransactions: (page = 1, perPage = 20, txType = null) => rpc('smithnode_getTransactions', [page, perPage, txType]),
  getBlock: (hash) => rpc('smithnode_getBlock', [hash]),
  getState: () => rpc('smithnode_getState'),
};

// Format helpers
export function formatAddress(address, chars = 8) {
  if (!address) return '';
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  return new Intl.NumberFormat().format(num);
}

export function formatSNT(amount) {
  if (!amount) return '0 SNT';
  return `${formatNumber(amount)} SNT`;
}

export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
