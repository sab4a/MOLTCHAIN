import { useState, useEffect } from 'react';
import {
  Landmark,
  Vote,
  Plus,
  Check,
  X,
  Clock,
  ChevronDown,
  ChevronUp,
  Play,
  AlertCircle,
  CheckCircle,
  Shield,
  Settings,
  Users,
  Coins,
  Zap,
  Timer,
  Bot,
  Hash,
  Link,
  Cpu,
} from 'lucide-react';
import { useWalletStore, useNetworkStore } from '../hooks/useStore';
import { api, formatAddress, formatNumber } from '../utils/rpc';
import { signMessage, hexToBytes, bytesToHex, sha256 } from '../utils/crypto';

const PROPOSAL_TYPES = [
  { value: 0, label: 'Change Reward', param: 'reward_per_proof', icon: Coins, description: 'Change the block reward amount' },
  { value: 1, label: 'Change Committee Size', param: 'committee_size', icon: Users, description: 'Change how many validators per block' },
  { value: 2, label: 'Change Min Stake', param: 'min_validator_stake', icon: Shield, description: 'Change minimum stake to propose' },
  { value: 3, label: 'Change Slash Penalty', param: 'slash_percentage', icon: AlertCircle, description: 'Change the slash penalty percentage' },
  { value: 4, label: 'Change Block Time', param: 'block_time_secs', icon: Timer, description: 'Change seconds between blocks' },
  { value: 5, label: 'Change AI Rate Limit', param: 'ai_rate_limit_secs', icon: Bot, description: 'Change AI message cooldown' },
  { value: 6, label: 'Change Max Validators', param: 'max_validators', icon: Hash, description: 'Change max validator count' },
];

const STATUS_COLORS = {
  active: 'bg-blue-500/20 text-blue-400',
  passed: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
  executed: 'bg-smith-500/20 text-smith-400',
  expired: 'bg-dark-700 text-dark-400',
};

export default function Governance() {
  const { getActiveAccount } = useWalletStore();
  const { networkParams, validators } = useNetworkStore();
  const activeAccount = getActiveAccount();

  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedProposal, setExpandedProposal] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Create form
  const [proposalType, setProposalType] = useState(0);
  const [newValue, setNewValue] = useState('');
  const [description, setDescription] = useState('');

  const activeValidator = activeAccount
    ? validators.find(v => v.public_key === activeAccount.publicKey)
    : null;

  useEffect(() => {
    fetchProposals();
    const interval = setInterval(fetchProposals, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchProposals() {
    try {
      const data = await api.getProposals();
      setProposals(data || []);
    } catch (err) {
      console.error('Failed to fetch proposals:', err);
    }
    setLoading(false);
  }

  async function handleCreateProposal() {
    if (!activeAccount || !activeValidator) return;
    setActionLoading(true);
    setError(null);

    try {
      const descriptionHash = await sha256(description || `Proposal to change parameter`);

      // Sign: proposal_type (1 byte) || new_value (8 bytes LE) || description_hash (32 bytes)
      const msgBytes = new Uint8Array(1 + 8 + 32);
      msgBytes[0] = proposalType;
      const valueView = new DataView(msgBytes.buffer, 1, 8);
      valueView.setBigUint64(0, BigInt(newValue), true);
      const hashBytes = hexToBytes(descriptionHash);
      msgBytes.set(hashBytes, 9);

      const signature = await signMessage(activeAccount.privateKey, msgBytes);

      const result = await api.createProposal({
        proposer: activeAccount.publicKey,
        proposal_type: proposalType,
        new_value: parseInt(newValue),
        description_hash: descriptionHash,
        signature,
      });

      setSuccess(`Proposal #${result.proposal_id} created!`);
      setShowCreateModal(false);
      setNewValue('');
      setDescription('');
      fetchProposals();
    } catch (err) {
      setError(err.message);
    }
    setActionLoading(false);
  }

  async function handleVote(proposalId, vote) {
    if (!activeAccount || !activeValidator) return;
    setActionLoading(true);
    setError(null);

    try {
      // Sign: proposal_id (8 bytes LE) || vote (1 byte)
      const msgBytes = new Uint8Array(9);
      const view = new DataView(msgBytes.buffer);
      view.setBigUint64(0, BigInt(proposalId), true);
      msgBytes[8] = vote ? 1 : 0;

      const signature = await signMessage(activeAccount.privateKey, msgBytes);

      await api.voteProposal({
        voter: activeAccount.publicKey,
        proposal_id: proposalId,
        vote,
        signature,
        reason: null,
      });

      setSuccess(`Vote ${vote ? 'FOR' : 'AGAINST'} recorded on proposal #${proposalId}`);
      fetchProposals();
    } catch (err) {
      setError(err.message);
    }
    setActionLoading(false);
  }

  async function handleExecute(proposalId) {
    if (!activeAccount || !activeValidator) return;
    setActionLoading(true);
    setError(null);

    try {
      // Sign: proposal_id (8 bytes LE)
      const msgBytes = new Uint8Array(8);
      const view = new DataView(msgBytes.buffer);
      view.setBigUint64(0, BigInt(proposalId), true);

      const signature = await signMessage(activeAccount.privateKey, msgBytes);

      await api.executeProposal({
        executor: activeAccount.publicKey,
        proposal_id: proposalId,
        signature,
      });

      setSuccess(`Proposal #${proposalId} executed!`);
      fetchProposals();
    } catch (err) {
      setError(err.message);
    }
    setActionLoading(false);
  }

  function timeRemaining(expiresAt) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = expiresAt - now;
    if (remaining <= 0) return 'Expired';
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            <Landmark className="w-7 h-7 text-smith-400" />
            Governance
          </h1>
          <p className="mt-1 text-dark-400">Propose and vote on network parameter changes</p>
        </div>
        {activeValidator && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 btn-primary"
          >
            <Plus className="w-4 h-4" />
            New Proposal
          </button>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-3 p-4 border rounded-xl bg-red-500/10 border-red-500/20">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 p-4 border rounded-xl bg-green-500/10 border-green-500/20">
          <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
          <p className="text-sm text-green-400">{success}</p>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-400 hover:text-green-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Current Parameters */}
      {networkParams && (
        <div className="card">
          <h2 className="flex items-center gap-2 mb-4 text-lg font-semibold">
            <Settings className="w-5 h-5 text-dark-400" />
            Current Network Parameters
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {PROPOSAL_TYPES.map(pt => (
              <div key={pt.value} className="p-3 border rounded-xl bg-dark-800/50 border-dark-700">
                <p className="flex items-center gap-1 text-xs text-dark-400">
                  <pt.icon className="w-3 h-3" /> {pt.label}
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatNumber(networkParams[pt.param] || 0)}
                  {pt.param === 'slash_percentage' && '%'}
                  {pt.param.includes('secs') && 's'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Not a validator warning */}
      {!activeValidator && (
        <div className="card bg-yellow-500/5 border-yellow-500/20">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0" />
            <div>
              <p className="font-medium text-yellow-400">Validator Required</p>
              <p className="text-sm text-dark-400">You need to be a registered validator with balance ≥ {formatNumber(networkParams?.min_validator_stake || 50)} SMITH to create proposals and vote.</p>
            </div>
          </div>
        </div>
      )}

      {/* Proposals List */}
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Vote className="w-5 h-5 text-blue-400" />
          Proposals
          <span className="text-sm font-normal text-dark-400">({proposals.length})</span>
        </h2>

        {loading ? (
          <div className="py-12 text-center card">
            <div className="w-8 h-8 mx-auto mb-4 border-2 rounded-full animate-spin border-smith-400 border-t-transparent" />
            <p className="text-dark-400">Loading proposals...</p>
          </div>
        ) : proposals.length === 0 ? (
          <div className="py-12 text-center card">
            <Landmark className="w-12 h-12 mx-auto mb-4 text-dark-600" />
            <p className="text-lg text-dark-400">No proposals yet</p>
            <p className="mt-1 text-sm text-dark-500">Be the first to propose a network parameter change!</p>
          </div>
        ) : (
          proposals.map(proposal => {
            const isExpanded = expandedProposal === proposal.id;
            const totalVotes = proposal.votes_for + proposal.votes_against;
            const forPct = totalVotes > 0 ? Math.round((proposal.votes_for / totalVotes) * 100) : 0;
            const statusClass = STATUS_COLORS[proposal.status] || STATUS_COLORS.active;

            return (
              <div key={proposal.id} className="transition-colors card hover:border-dark-600">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedProposal(isExpanded ? null : proposal.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-10 h-10 text-sm font-bold rounded-xl bg-dark-800 text-dark-300">
                      #{proposal.id}
                    </div>
                    <div>
                      <p className="font-semibold">{proposal.proposal_type}</p>
                      <p className="text-sm text-dark-400">by {formatAddress(proposal.proposer, 8)}</p>
                      {proposal.tx_hash && (
                        <p className="text-xs text-dark-500 font-mono flex items-center gap-1 mt-0.5">
                          <Link className="w-3 h-3" />
                          tx: {proposal.tx_hash.slice(0, 16)}...
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {proposal.execution_tx_hash && (
                      <span className="flex items-center gap-1 text-xs badge bg-smith-500/20 text-smith-400">
                        <Cpu className="w-3 h-3" />
                        Auto-Executed
                      </span>
                    )}
                    <span className={`badge ${statusClass}`}>{proposal.status}</span>
                    <div className="text-sm text-right">
                      <span className="text-green-400">{proposal.votes_for}</span>
                      <span className="text-dark-500"> / </span>
                      <span className="text-red-400">{proposal.votes_against}</span>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-dark-400" /> : <ChevronDown className="w-4 h-4 text-dark-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="pt-4 mt-4 space-y-4 border-t border-dark-700">
                    {/* Vote Bar */}
                    <div>
                      <div className="flex justify-between mb-1 text-xs text-dark-400">
                        <span>For: {proposal.votes_for} ({forPct}%)</span>
                        <span>Against: {proposal.votes_against} ({100 - forPct}%)</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-dark-700">
                        <div className="h-full transition-all bg-green-500 rounded-full" style={{ width: `${forPct}%` }} />
                      </div>
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-dark-800/50">
                        <p className="text-xs text-dark-400">Description</p>
                        <p className="mt-1 text-sm">{proposal.description || 'No description'}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-dark-800/50">
                        <p className="text-xs text-dark-400">Time Remaining</p>
                        <p className="flex items-center gap-1 mt-1 text-sm">
                          <Clock className="w-3 h-3" />
                          {timeRemaining(proposal.expires_at)}
                        </p>
                      </div>
                    </div>

                    {/* Transaction Hashes */}
                    {(proposal.tx_hash || proposal.execution_tx_hash) && (
                      <div className="p-3 space-y-2 rounded-lg bg-dark-800/50">
                        <p className="flex items-center gap-1 text-xs text-dark-400">
                          <Hash className="w-3 h-3" />
                          Transaction Hashes
                        </p>
                        {proposal.tx_hash && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-dark-500">Proposal TX:</span>
                            <span className="text-xs font-mono text-dark-200 bg-dark-900/50 px-2 py-0.5 rounded">
                              {proposal.tx_hash}
                            </span>
                          </div>
                        )}
                        {proposal.execution_tx_hash && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-dark-500">Execution TX:</span>
                            <span className="text-xs font-mono text-smith-400 bg-dark-900/50 px-2 py-0.5 rounded">
                              {proposal.execution_tx_hash}
                            </span>
                            <span className="flex items-center gap-1 text-xs badge bg-smith-500/10 text-smith-400">
                              <CheckCircle className="w-3 h-3" /> Executed ✅
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Individual Votes with AI Reasoning */}
                    {proposal.votes && proposal.votes.length > 0 && (
                      <div>
                        <p className="flex items-center gap-1 mb-2 text-xs text-dark-400">
                          <Bot className="w-3 h-3" />
                          AI Validator Votes ({proposal.votes.length})
                        </p>
                        <div className="space-y-3 overflow-y-auto max-h-96">
                          {proposal.votes.map((v, i) => (
                            <div key={i} className={`p-3 rounded-lg border ${v.vote ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={v.vote ? 'text-green-400' : 'text-red-400'}>
                                  {v.vote ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                </span>
                                <span className="font-mono text-xs text-dark-200">{formatAddress(v.voter, 8)}</span>
                                <span className={`text-xs font-medium ${v.vote ? 'text-green-400' : 'text-red-400'}`}>
                                  {v.vote ? 'FOR' : 'AGAINST'}
                                </span>
                                <span className="ml-auto text-xs text-dark-500">
                                  {formatNumber(v.stake_weight)} stake
                                </span>
                              </div>
                              {v.reason && (
                                <div className="pl-6 mt-2">
                                  <p className="text-xs italic leading-relaxed text-dark-300">
                                    🤖 "{v.reason}"
                                  </p>
                                </div>
                              )}
                              {!v.reason && (
                                <div className="pl-6 mt-1">
                                  <p className="text-xs italic text-dark-500">No reasoning provided</p>
                                </div>
                              )}
                              {v.tx_hash && (
                                <div className="pl-6 mt-1">
                                  <p className="flex items-center gap-1 font-mono text-xs text-dark-600">
                                    <Link className="w-2.5 h-2.5" />
                                    {v.tx_hash.slice(0, 20)}...
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    {activeValidator && proposal.status === 'active' && (
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleVote(proposal.id, true); }}
                          disabled={actionLoading}
                          className="flex items-center gap-2 text-sm btn-primary"
                        >
                          <Check className="w-4 h-4" /> Vote For
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleVote(proposal.id, false); }}
                          disabled={actionLoading}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-red-400 transition-colors rounded-xl bg-red-500/10 hover:bg-red-500/20"
                        >
                          <X className="w-4 h-4" /> Vote Against
                        </button>
                      </div>
                    )}
                    {activeValidator && proposal.status === 'passed' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExecute(proposal.id); }}
                        disabled={actionLoading}
                        className="flex items-center gap-2 text-sm btn-primary"
                      >
                        <Play className="w-4 h-4" /> Execute Proposal
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Create Proposal Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="w-full max-w-lg p-6 space-y-4 border bg-dark-900 border-dark-700 rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold">
                <Plus className="w-5 h-5 text-smith-400" />
                New Proposal
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-dark-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block mb-2 text-sm text-dark-400">Parameter to Change</label>
              <div className="grid grid-cols-2 gap-2">
                {PROPOSAL_TYPES.map(pt => (
                  <button
                    key={pt.value}
                    onClick={() => setProposalType(pt.value)}
                    className={`p-3 rounded-xl border text-left text-sm transition-colors ${
                      proposalType === pt.value
                        ? 'border-smith-500 bg-smith-500/10 text-smith-400'
                        : 'border-dark-700 bg-dark-800/50 text-dark-300 hover:border-dark-600'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <pt.icon className="w-4 h-4" />
                      {pt.label}
                    </div>
                    <p className="mt-1 text-xs text-dark-500">
                      Current: {formatNumber(networkParams?.[pt.param] || 0)}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block mb-2 text-sm text-dark-400">New Value</label>
              <input
                type="number"
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="Enter new value"
                className="w-full px-4 py-3 text-white border rounded-xl bg-dark-800 border-dark-700 focus:border-smith-500 focus:outline-none"
              />
            </div>

            <button
              onClick={handleCreateProposal}
              disabled={!newValue || actionLoading}
              className="flex items-center justify-center w-full gap-2 btn-primary"
            >
              {actionLoading ? (
                <div className="w-4 h-4 border-2 border-white rounded-full animate-spin border-t-transparent" />
              ) : (
                <>
                  <Landmark className="w-4 h-4" />
                  Submit Proposal
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
