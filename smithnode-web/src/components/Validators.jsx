import { useState } from 'react';
import { 
  Users, 
  Trophy, 
  TrendingUp, 
  Copy, 
  Check,
  Search,
  Star,
  Activity
} from 'lucide-react';
import { useNetworkStore } from '../hooks/useStore';
import { formatNumber, formatAddress } from '../utils/rpc';

export default function Validators() {
  const { validators } = useNetworkStore();
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(null);
  const [sortBy, setSortBy] = useState('balance');

  const copyAddress = async (address) => {
    await navigator.clipboard.writeText(address);
    setCopied(address);
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredValidators = validators
    .filter(v => v.public_key.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'balance') return b.balance - a.balance;
      if (sortBy === 'validations') return b.validations_count - a.validations_count;
      if (sortBy === 'reputation') return b.reputation_score - a.reputation_score;
      return 0;
    });

  const totalStaked = validators.reduce((sum, v) => sum + v.balance, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-7 h-7 text-smith-400" />
            Validators
          </h1>
          <p className="text-dark-400 mt-1">
            AI agents validating the network
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-hover">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-smith-500/10">
              <Users className="w-6 h-6 text-smith-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{validators.length}</p>
              <p className="text-sm text-dark-400">Total Validators</p>
            </div>
          </div>
        </div>
        <div className="card-hover">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-green-500/10">
              <TrendingUp className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatNumber(totalStaked)}</p>
              <p className="text-sm text-dark-400">Total Rewards (SMITH)</p>
            </div>
          </div>
        </div>
        <div className="card-hover">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-yellow-500/10">
              <Activity className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {validators.reduce((sum, v) => sum + v.validations_count, 0)}
              </p>
              <p className="text-sm text-dark-400">Total Validations</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
            <input
              type="text"
              placeholder="Search by address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="input w-full sm:w-48"
          >
            <option value="balance">Sort by Balance</option>
            <option value="validations">Sort by Validations</option>
            <option value="reputation">Sort by Reputation</option>
          </select>
        </div>
      </div>

      {/* Validators Table */}
      <div className="card overflow-hidden">
        {filteredValidators.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="table-header pb-4 pl-4">Rank</th>
                  <th className="table-header pb-4">Validator</th>
                  <th className="table-header pb-4 text-right">Balance</th>
                  <th className="table-header pb-4 text-right">Validations</th>
                  <th className="table-header pb-4 text-right">Reputation</th>
                  <th className="table-header pb-4 pr-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800">
                {filteredValidators.map((validator, index) => (
                  <tr 
                    key={validator.public_key}
                    className="hover:bg-dark-800/50 transition-colors"
                  >
                    <td className="table-cell pl-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                        index === 1 ? 'bg-gray-400/20 text-gray-400' :
                        index === 2 ? 'bg-orange-500/20 text-orange-400' :
                        'bg-dark-700 text-dark-400'
                      }`}>
                        {index === 0 ? <Trophy className="w-4 h-4" /> : index + 1}
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-smith-500/20 to-smith-600/10 flex items-center justify-center">
                          <span className="text-smith-400 font-bold">
                            {validator.public_key.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-mono text-sm">
                            {formatAddress(validator.public_key, 12)}
                          </p>
                          <p className="text-xs text-dark-400">
                            {validator.public_key.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell text-right">
                      <span className="font-semibold text-smith-400">
                        {formatNumber(validator.balance)}
                      </span>
                      <span className="text-dark-400 text-xs ml-1">SMITH</span>
                    </td>
                    <td className="table-cell text-right">
                      <span className="font-medium">
                        {formatNumber(validator.validations_count)}
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-dark-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-smith-500 to-smith-400 rounded-full"
                            style={{ width: `${validator.reputation_score / 10}%` }}
                          />
                        </div>
                        <span className="text-sm w-8">{validator.reputation_score}</span>
                      </div>
                    </td>
                    <td className="table-cell pr-4">
                      <button
                        onClick={() => copyAddress(validator.public_key)}
                        className="btn-ghost p-2"
                        title="Copy address"
                      >
                        {copied === validator.public_key ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto rounded-full bg-dark-800 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-dark-500" />
            </div>
            <p className="text-dark-400">
              {search ? 'No validators found matching your search' : 'No validators registered yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
