import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateKeypair } from '../utils/crypto';
import { api, stateSubscription } from '../utils/rpc';

// Wallet Store - persists accounts to localStorage
export const useWalletStore = create(
  persist(
    (set, get) => ({
      accounts: [],
      activeAccountIndex: 0,
      
      // Get active account
      getActiveAccount: () => {
        const { accounts, activeAccountIndex } = get();
        return accounts[activeAccountIndex] || null;
      },
      
      // Create new account
      createAccount: async (name) => {
        const keypair = await generateKeypair();
        const account = {
          name: name || `Account ${get().accounts.length + 1}`,
          publicKey: keypair.publicKey,
          privateKey: keypair.privateKey,
          createdAt: Date.now(),
        };
        
        set((state) => ({
          accounts: [...state.accounts, account],
          activeAccountIndex: state.accounts.length,
        }));
        
        return account;
      },
      
      // Import account from private key
      importAccount: async (name, privateKey) => {
        // Validate and derive public key
        const { bytesToHex } = await import('../utils/crypto');
        const ed = await import('@noble/ed25519');
        
        const privateKeyBytes = new Uint8Array(
          privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );
        const publicKey = await ed.getPublicKeyAsync(privateKeyBytes);
        
        const account = {
          name: name || `Imported ${get().accounts.length + 1}`,
          publicKey: bytesToHex(publicKey),
          privateKey,
          createdAt: Date.now(),
          imported: true,
        };
        
        set((state) => ({
          accounts: [...state.accounts, account],
          activeAccountIndex: state.accounts.length,
        }));
        
        return account;
      },
      
      // Set active account
      setActiveAccount: (index) => {
        set({ activeAccountIndex: index });
      },
      
      // Remove account
      removeAccount: (index) => {
        set((state) => {
          const accounts = state.accounts.filter((_, i) => i !== index);
          const activeAccountIndex = Math.min(state.activeAccountIndex, accounts.length - 1);
          return { accounts, activeAccountIndex: Math.max(0, activeAccountIndex) };
        });
      },
      
      // Rename account
      renameAccount: (index, name) => {
        set((state) => ({
          accounts: state.accounts.map((acc, i) => 
            i === index ? { ...acc, name } : acc
          ),
        }));
      },
    }),
    {
      name: 'smithnode-wallet',
      partialize: (state) => ({
        accounts: state.accounts,
        activeAccountIndex: state.activeAccountIndex,
      }),
    }
  )
);

// Network Store - handles connection and data with WebSocket subscriptions
export const useNetworkStore = create((set, get) => ({
  connected: false,
  subscribed: false,
  status: null,
  validators: [],
  transactions: [],
  challenge: null,
  networkParams: null,
  loading: false,
  error: null,
  lastUpdated: null,
  unsubscribe: null,
  
  // Connect and fetch initial data, then subscribe
  connect: async () => {
    set({ loading: true, error: null });
    try {
      const status = await api.getStatus();
      const validators = await api.getValidators();
      const challenge = await api.getChallenge();
      const networkParams = await api.getNetworkParams().catch(() => null);
      
      set({
        connected: true,
        status,
        validators,
        challenge,
        networkParams,
        loading: false,
        lastUpdated: Date.now(),
      });
      
      // Start WebSocket subscription
      get().subscribe();
    } catch (error) {
      set({
        connected: false,
        error: error.message,
        loading: false,
      });
    }
  },
  
  // Subscribe to real-time updates via WebSocket
  subscribe: () => {
    const { unsubscribe: existingUnsub } = get();
    if (existingUnsub) return; // Already subscribed
    
    const unsub = stateSubscription.subscribe((event) => {
      console.log('📡 Received event:', event.type, event);
      
      if (event.type === 'snapshot' && event.data) {
        const { status, validators, challenge, timestamp } = event.data;
        console.log('📊 Snapshot - challenge:', challenge);
        set({
          connected: true,
          subscribed: true,
          status,
          validators,
          challenge, // This can be null if no active challenge
          lastUpdated: timestamp * 1000,
          error: null,
        });
      } else if (event.type === 'block' && event.data) {
        // Partial update for new block
        set((state) => ({
          status: state.status ? { ...state.status, height: event.data.height, state_root: event.data.state_root } : state.status,
          lastUpdated: Date.now(),
        }));
      } else if (event.type === 'challenge') {
        set({ challenge: event.data, lastUpdated: Date.now() });
      } else if (event.type === 'transaction' && event.data) {
        set((state) => ({
          transactions: [event.data, ...state.transactions].slice(0, 100),
          lastUpdated: Date.now(),
        }));
      }
    });
    
    set({ unsubscribe: unsub, subscribed: true });
  },
  
  // Unsubscribe from WebSocket
  unsubscribeWs: () => {
    const { unsubscribe: unsub } = get();
    if (unsub) {
      unsub();
      set({ unsubscribe: null, subscribed: false });
    }
  },
  
  // Refresh ALL data at once (fallback for when WS not working)
  refreshAll: async () => {
    try {
      const [status, validators, challenge, networkParams] = await Promise.all([
        api.getStatus(),
        api.getValidators(),
        api.getChallenge(),
        api.getNetworkParams().catch(() => null),
      ]);
      
      set({
        connected: true,
        status,
        validators,
        challenge,
        networkParams,
        error: null,
        lastUpdated: Date.now(),
      });
    } catch (error) {
      set({ error: error.message });
    }
  },
  
  // Refresh status
  refreshStatus: async () => {
    try {
      const status = await api.getStatus();
      set({ status, error: null, lastUpdated: Date.now() });
    } catch (error) {
      set({ error: error.message });
    }
  },
  
  // Refresh validators
  refreshValidators: async () => {
    try {
      const validators = await api.getValidators();
      set({ validators, error: null });
    } catch (error) {
      set({ error: error.message });
    }
  },
  
  // Refresh challenge
  refreshChallenge: async () => {
    try {
      const challenge = await api.getChallenge();
      set({ challenge, error: null });
    } catch (error) {
      set({ error: error.message });
    }
  },
  
  // Register as validator
  registerValidator: async (publicKey) => {
    set({ loading: true });
    try {
      const result = await api.registerValidator(publicKey);
      await get().refreshValidators();
      set({ loading: false });
      return result;
    } catch (error) {
      set({ loading: false, error: error.message });
      throw error;
    }
  },
  
  // Add transaction to history (local only for now)
  addTransaction: (tx) => {
    set((state) => ({
      transactions: [tx, ...state.transactions].slice(0, 100),
    }));
  },
  
  // Clear error
  clearError: () => set({ error: null }),
}));
