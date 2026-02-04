import { useState, useEffect } from 'react';
import { 
  Wallet as WalletIcon, 
  Plus, 
  Copy, 
  Check,
  Send,
  Download,
  Upload,
  Trash2,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Bot,
  Coins,
  ArrowUpRight,
  AlertCircle,
  CheckCircle,
  Edit2,
  X
} from 'lucide-react';
import { useWalletStore, useNetworkStore } from '../hooks/useStore';
import { formatAddress, formatNumber, api } from '../utils/rpc';
import { signTransfer, hexToBytes } from '../utils/crypto';

export default function Wallet() {
  const { 
    accounts, 
    activeAccountIndex, 
    createAccount, 
    importAccount,
    setActiveAccount, 
    removeAccount,
    renameAccount,
    getActiveAccount 
  } = useWalletStore();
  
  const { validators, registerValidator, refreshValidators, addTransaction } = useNetworkStore();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copied, setCopied] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [editingName, setEditingName] = useState(null);
  const [newName, setNewName] = useState('');
  
  // Form states
  const [createName, setCreateName] = useState('');
  const [importName, setImportName] = useState('');
  const [importKey, setImportKey] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');

  const activeAccount = getActiveAccount();
  const activeValidator = activeAccount 
    ? validators.find(v => v.public_key === activeAccount.publicKey)
    : null;

  const copyToClipboard = async (text, label) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreateAccount = async () => {
    setLoading(true);
    try {
      await createAccount(createName || undefined);
      setShowCreateModal(false);
      setCreateName('');
      setSuccess('Account created successfully!');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleImportAccount = async () => {
    setLoading(true);
    setError(null);
    try {
      if (importKey.length !== 64) {
        throw new Error('Private key must be 64 hex characters');
      }
      await importAccount(importName || undefined, importKey);
      setShowImportModal(false);
      setImportName('');
      setImportKey('');
      setSuccess('Account imported successfully!');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleRegisterValidator = async () => {
    if (!activeAccount) return;
    setLoading(true);
    setError(null);
    try {
      const result = await registerValidator(activeAccount.publicKey);
      if (result.success) {
        setSuccess('Registered as validator! You can now start earning MOLT.');
        await refreshValidators();
      } else {
        setError(result.error || 'Registration failed');
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleSend = async () => {
    if (!activeAccount || !sendTo || !sendAmount) return;
    setLoading(true);
    setError(null);
    try {
      // Validate amount
      const amount = parseInt(sendAmount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid amount');
      }

      // Check balance
      if (activeValidator && activeValidator.balance < amount) {
        throw new Error('Insufficient balance');
      }

      // Validate recipient address (must be 64 hex chars = 32 bytes)
      if (!/^[a-fA-F0-9]{64}$/.test(sendTo)) {
        throw new Error('Invalid recipient address (must be 64 hex characters)');
      }

      // Get current nonce from validator info (prevents replay attacks)
      const currentNonce = activeValidator?.nonce ?? 0;

      // Sign the transfer message: to || amount || nonce
      const signature = await signTransfer(
        activeAccount.privateKey,
        sendTo,
        amount,
        currentNonce
      );

      // Send the transfer via RPC (includes nonce)
      const result = await api.transfer(
        activeAccount.publicKey,
        sendTo,
        amount,
        currentNonce,
        signature
      );

      if (result.success) {
        // Add to local transaction history
        addTransaction({
          hash: result.tx_hash,
          type: 'transfer',
          from: activeAccount.publicKey,
          to: sendTo,
          amount,
          status: 'confirmed',
          timestamp: Date.now() / 1000,
        });
        
        setSuccess(`Successfully sent ${amount} MOLT!`);
        setShowSendModal(false);
        setSendTo('');
        setSendAmount('');
        
        // Refresh validators to update balances
        await refreshValidators();
      } else {
        throw new Error(result.error || 'Transfer failed');
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleRename = (index) => {
    if (newName.trim()) {
      renameAccount(index, newName.trim());
    }
    setEditingName(null);
    setNewName('');
  };

  // Clear messages after 5 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <WalletIcon className="w-7 h-7 text-molt-400" />
            Wallet
          </h1>
          <p className="text-dark-400 mt-1">
            Manage your accounts and MOLT tokens
          </p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowImportModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Account
          </button>
        </div>
      </div>

      {/* Alerts */}
      {success && (
        <div className="card bg-green-500/10 border-green-500/20 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <p className="text-green-400">{success}</p>
        </div>
      )}
      {error && (
        <div className="card bg-red-500/10 border-red-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {accounts.length === 0 ? (
        /* Empty State */
        <div className="card text-center py-16">
          <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-molt-500/20 to-molt-600/10 flex items-center justify-center mb-6">
            <WalletIcon className="w-10 h-10 text-molt-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No Accounts Yet</h2>
          <p className="text-dark-400 max-w-md mx-auto mb-6">
            Create your first account to start earning MOLT tokens as an AI validator.
          </p>
          <div className="flex justify-center gap-3">
            <button 
              onClick={() => setShowImportModal(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Import Existing
            </button>
            <button 
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create New
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Accounts List */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-lg font-semibold">Your Accounts</h2>
            <div className="space-y-2">
              {accounts.map((account, index) => {
                const validator = validators.find(v => v.public_key === account.publicKey);
                const isActive = index === activeAccountIndex;
                
                return (
                  <div 
                    key={account.publicKey}
                    onClick={() => setActiveAccount(index)}
                    className={`card cursor-pointer transition-all ${
                      isActive 
                        ? 'border-molt-500 bg-molt-500/5' 
                        : 'hover:border-dark-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          isActive 
                            ? 'bg-molt-500/20' 
                            : 'bg-dark-700'
                        }`}>
                          <Bot className={`w-5 h-5 ${isActive ? 'text-molt-400' : 'text-dark-400'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {editingName === index ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleRename(index)}
                                className="input py-1 px-2 text-sm"
                                autoFocus
                              />
                              <button 
                                onClick={() => handleRename(index)}
                                className="text-green-400 hover:text-green-300"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setEditingName(null)}
                                className="text-dark-400 hover:text-white"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <p className="font-medium truncate">{account.name}</p>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingName(index);
                                  setNewName(account.name);
                                }}
                                className="text-dark-500 hover:text-white"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          <p className="text-xs text-dark-400 font-mono truncate">
                            {formatAddress(account.publicKey, 8)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${isActive ? 'text-molt-400' : ''}`}>
                          {formatNumber(validator?.balance || 0)}
                        </p>
                        <p className="text-xs text-dark-400">MOLT</p>
                      </div>
                    </div>
                    {validator && (
                      <div className="mt-3 pt-3 border-t border-dark-700 flex items-center justify-between text-xs">
                        <span className="badge badge-success">Validator</span>
                        <span className="text-dark-400">
                          {validator.validations_count} validations
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Account Details */}
          <div className="lg:col-span-2 space-y-4">
            {activeAccount && (
              <>
                {/* Balance Card */}
                <div className="card bg-gradient-to-br from-dark-900 via-dark-900 to-molt-950/20 border-molt-500/20">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <p className="text-dark-400 mb-1">Total Balance</p>
                      <p className="text-4xl font-bold bg-gradient-to-r from-white to-dark-300 bg-clip-text text-transparent">
                        {formatNumber(activeValidator?.balance || 0)} MOLT
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => refreshValidators()}
                        className="btn-ghost p-2"
                        title="Refresh"
                      >
                        <RefreshCw className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-3">
                    <button 
                      onClick={() => setShowSendModal(true)}
                      className="btn-primary flex items-center gap-2"
                      disabled={!activeValidator || activeValidator.balance === 0}
                    >
                      <Send className="w-4 h-4" />
                      Send
                    </button>
                    {!activeValidator ? (
                      <button 
                        onClick={handleRegisterValidator}
                        className="btn-secondary flex items-center gap-2"
                        disabled={loading}
                      >
                        <Bot className="w-4 h-4" />
                        {loading ? 'Registering...' : 'Register as Validator'}
                      </button>
                    ) : (
                      <span className="badge badge-success py-2 px-4">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Active Validator
                      </span>
                    )}
                  </div>
                </div>

                {/* Account Details */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4">Account Details</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">Public Key</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-3 bg-dark-800 rounded-xl text-sm font-mono break-all">
                          {activeAccount.publicKey}
                        </code>
                        <button 
                          onClick={() => copyToClipboard(activeAccount.publicKey, 'public')}
                          className="btn-ghost p-3"
                        >
                          {copied === 'public' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">Private Key</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-3 bg-dark-800 rounded-xl text-sm font-mono break-all">
                          {showPrivateKey 
                            ? activeAccount.privateKey 
                            : '•'.repeat(64)
                          }
                        </code>
                        <button 
                          onClick={() => setShowPrivateKey(!showPrivateKey)}
                          className="btn-ghost p-3"
                        >
                          {showPrivateKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button 
                          onClick={() => copyToClipboard(activeAccount.privateKey, 'private')}
                          className="btn-ghost p-3"
                        >
                          {copied === 'private' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-red-400 mt-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Never share your private key with anyone!
                      </p>
                    </div>
                  </div>
                </div>

                {/* Validator Stats */}
                {activeValidator && (
                  <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Validator Stats</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-4 bg-dark-800/50 rounded-xl text-center">
                        <p className="text-2xl font-bold">{activeValidator.validations_count}</p>
                        <p className="text-sm text-dark-400">Validations</p>
                      </div>
                      <div className="p-4 bg-dark-800/50 rounded-xl text-center">
                        <p className="text-2xl font-bold">{activeValidator.reputation_score}</p>
                        <p className="text-sm text-dark-400">Reputation</p>
                      </div>
                      <div className="p-4 bg-dark-800/50 rounded-xl text-center">
                        <p className="text-2xl font-bold text-molt-400">
                          {formatNumber(activeValidator.validations_count * 100)}
                        </p>
                        <p className="text-sm text-dark-400">Total Earned</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Danger Zone */}
                <div className="card border-red-500/20">
                  <h3 className="text-lg font-semibold text-red-400 mb-4">Danger Zone</h3>
                  <button 
                    onClick={() => {
                      if (confirm('Are you sure you want to remove this account? Make sure you have backed up your private key!')) {
                        removeAccount(activeAccountIndex);
                      }
                    }}
                    className="btn bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove Account
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Account Modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)}>
          <h2 className="text-xl font-bold mb-4">Create New Account</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-dark-400 mb-1 block">Account Name (optional)</label>
              <input
                type="text"
                placeholder="My Validator"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="input"
              />
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateAccount}
                className="btn-primary flex-1"
                disabled={loading}
              >
                {loading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import Account Modal */}
      {showImportModal && (
        <Modal onClose={() => setShowImportModal(false)}>
          <h2 className="text-xl font-bold mb-4">Import Account</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-dark-400 mb-1 block">Account Name (optional)</label>
              <input
                type="text"
                placeholder="Imported Account"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="text-sm text-dark-400 mb-1 block">Private Key</label>
              <input
                type="password"
                placeholder="Enter your 64-character private key"
                value={importKey}
                onChange={(e) => setImportKey(e.target.value)}
                className="input font-mono"
              />
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowImportModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button 
                onClick={handleImportAccount}
                className="btn-primary flex-1"
                disabled={loading || importKey.length !== 64}
              >
                {loading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Send Modal */}
      {showSendModal && (
        <Modal onClose={() => setShowSendModal(false)}>
          <h2 className="text-xl font-bold mb-4">Send MOLT</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-dark-400 mb-1 block">Recipient Address</label>
              <input
                type="text"
                placeholder="Enter recipient public key"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                className="input font-mono"
              />
            </div>
            <div>
              <label className="text-sm text-dark-400 mb-1 block">Amount</label>
              <div className="relative">
                <input
                  type="number"
                  placeholder="0"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  className="input pr-16"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-400">
                  MOLT
                </span>
              </div>
              <p className="text-xs text-dark-400 mt-1">
                Available: {formatNumber(activeValidator?.balance || 0)} MOLT
              </p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowSendModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button 
                onClick={handleSend}
                className="btn-primary flex-1"
                disabled={loading || !sendTo || !sendAmount}
              >
                {loading ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Modal Component
function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-dark-900 border border-dark-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        {children}
      </div>
    </div>
  );
}
