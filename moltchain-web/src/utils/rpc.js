/**
 * Moltchain RPC Client with WebSocket Subscription Support
 */

const RPC_URL = import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:26658';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:26658';

let rpcId = 0;

export async function rpc(method, params = []) {
  try {
    const response = await fetch(RPC_URL, {
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
    
    return json.result;
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Cannot connect to Moltchain node. Is it running?');
    }
    throw error;
  }
}

/**
 * WebSocket subscription manager
 */
class StateSubscription {
  constructor() {
    this.ws = null;
    this.listeners = new Set();
    this.reconnectTimeout = null;
    this.subscriptionId = null;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    try {
      this.ws = new WebSocket(WS_URL);
      
      this.ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        // Subscribe to state updates
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: ++rpcId,
          method: 'moltchain_subscribeState',
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
        console.log('🔌 WebSocket disconnected, reconnecting in 3s...');
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
  getStatus: () => rpc('moltchain_status'),
  getChallenge: () => rpc('moltchain_getChallenge'),
  newChallenge: () => rpc('moltchain_newChallenge'),
  getValidators: () => rpc('moltchain_getValidators'),
  getValidator: (pubkey) => rpc('moltchain_getValidator', [pubkey]),
  registerValidator: (publicKey) => rpc('moltchain_registerValidator', [{ public_key: publicKey }]),
  submitProof: (data) => rpc('moltchain_submitProof', [data]),
  transfer: (from, to, amount, signature) => rpc('moltchain_transfer', [{ from, to, amount, signature }]),
  getTransactions: (page = 1, perPage = 20, txType = null) => rpc('moltchain_getTransactions', [page, perPage, txType]),
  getState: () => rpc('moltchain_getState'),
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

export function formatMolt(amount) {
  if (!amount) return '0 MOLT';
  return `${formatNumber(amount)} MOLT`;
}

export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
