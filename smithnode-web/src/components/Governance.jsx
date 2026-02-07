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
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Landmark className="w-7 h-7 text-smith-400" />
            Governance
          </h1>
          <p className="text-dark-400 mt-1">Propose and vote on network parameter changes</p>
        </div>
        {activeValidator && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Proposal
          </button>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
          <p className="text-green-400 text-sm">{success}</p>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-400 hover:text-green-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Current Parameters */}
      {networkParams && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-dark-400" />
            Current Network Parameters
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {PROPOSAL_TYPES.map(pt => (
              <div key={pt.value} className="p-3 rounded-xl bg-dark-800/50 border border-dark-700">
                <p className="text-xs text-dark-400 flex items-center gap-1">
                  <pt.icon className="w-3 h-3" /> {pt.label}
                </p>
                <p className="text-lg font-semibold mt-1">
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
              <p className="text-yellow-400 font-medium">Validator Required</p>
              <p className="text-dark-400 text-sm">You need to be a registered validator with balance ≥ {formatNumber(networkParams?.min_validator_stake || 50)} SMITH to create proposals and vote.</p>
            </div>
          </div>
        </div>
      )}

      {/* Proposals List */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Vote className="w-5 h-5 text-blue-400" />
          Proposals
          <span className="text-sm font-normal text-dark-400">({proposals.length})</span>
        </h2>

        {loading ? (
          <div className="card text-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-smith-400 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-dark-400">Loading proposals...</p>
          </div>
        ) : proposals.length === 0 ? (
          <div className="card text-center py-12">
            <Landmark className="w-12 h-12 text-dark-600 mx-auto mb-4" />
            <p className="text-dark-400 text-lg">No proposals yet</p>
            <p className="text-dark-500 text-sm mt-1">Be the first to propose a network parameter change!</p>
          </div>
        ) : (
          proposals.map(proposal => {
            const isExpanded = expandedProposal === proposal.id;
            const totalVotes = proposal.votes_for + proposal.votes_against;
            const forPct = totalVotes > 0 ? Math.round((proposal.votes_for / totalVotes) * 100) : 0;
            const statusClass = STATUS_COLORS[proposal.status] || STATUS_COLORS.active;

            return (
              <div key={proposal.id} className="card hover:border-dark-600 transition-colors">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedProposal(isExpanded ? null : proposal.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-dark-800 flex items-center justify-center text-sm font-bold text-dark-300">
                      #{proposal.id}
                    </div>
                    <div>
                      <p className="font-semibold">{proposal.proposal_type}</p>
                      <p className="text-sm text-dark-400">by {formatAddress(proposal.proposer, 8)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`badge ${statusClass}`}>{proposal.status}</span>
                    <div className="text-right text-sm">
                      <span className="text-green-400">{proposal.votes_for}</span>
                      <span className="text-dark-500"> / </span>
                      <span className="text-red-400">{proposal.votes_against}</span>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-dark-400" /> : <ChevronDown className="w-4 h-4 text-dark-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-dark-700 space-y-4">
                    {/* Vote Bar */}
                    <div>
                      <div className="flex justify-between text-xs text-dark-400 mb-1">
                        <span>For: {proposal.votes_for} ({forPct}%)</span>
                        <span>Against: {proposal.votes_against} ({100 - forPct}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-dark-700 overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${forPct}%` }} />
                      </div>
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-dark-800/50">
                        <p className="text-xs text-dark-400">Description</p>
                        <p className="text-sm mt-1">{proposal.description || 'No description'}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-dark-800/50">
                        <p className="text-xs text-dark-400">Time Remaining</p>
                        <p className="text-sm mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeRemaining(proposal.expires_at)}
                        </p>
                      </div>
                    </div>

                    {/* Individual Votes with AI Reasoning */}
                    {proposal.votes && proposal.votes.length > 0 && (
                      <div>
                        <p className="text-xs text-dark-400 mb-2 flex items-center gap-1">
                          <Bot className="w-3 h-3" />
                          AI Validator Votes ({proposal.votes.length})
                        </p>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
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
                                <span className="text-dark-500 text-xs ml-auto">
                                  {formatNumber(v.stake_weight)} stake
                                </span>
                              </div>
                              {v.reason && (
                                <div className="mt-2 pl-6">
                                  <p className="text-xs text-dark-300 italic leading-relaxed">
                                    🤖 "{v.reason}"
                                  </p>
                                </div>
                              )}
                              {!v.reason && (
                                <div className="mt-1 pl-6">
                                  <p className="text-xs text-dark-500 italic">No reasoning provided</p>
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
                          className="btn-primary flex items-center gap-2 text-sm"
                        >
                          <Check className="w-4 h-4" /> Vote For
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleVote(proposal.id, false); }}
                          disabled={actionLoading}
                          className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-2 text-sm"
                        >
                          <X className="w-4 h-4" /> Vote Against
                        </button>
                      </div>
                    )}
                    {activeValidator && proposal.status === 'passed' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExecute(proposal.id); }}
                        disabled={actionLoading}
                        className="btn-primary flex items-center gap-2 text-sm"
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-dark-900 border border-dark-700 rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Plus className="w-5 h-5 text-smith-400" />
                New Proposal
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-dark-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-sm text-dark-400 block mb-2">Parameter to Change</label>
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
                    <p className="text-xs text-dark-500 mt-1">
                      Current: {formatNumber(networkParams?.[pt.param] || 0)}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-dark-400 block mb-2">New Value</label>
              <input
                type="number"
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="Enter new value"
                className="w-full px-4 py-3 rounded-xl bg-dark-800 border border-dark-700 focus:border-smith-500 focus:outline-none text-white"
              />
            </div>

            <div>
              <label className="text-sm text-dark-400 block mb-2">Description (optional)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Explain why this change is needed..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl bg-dark-800 border border-dark-700 focus:border-smith-500 focus:outline-none text-white resize-none"
              />
            </div>

            <button
              onClick={handleCreateProposal}
              disabled={!newValue || actionLoading}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {actionLoading ? (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
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
