import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Boxes, 
  Users, 
  Coins, 
  Trophy,
  TrendingUp,
  Clock,
  Zap,
  ArrowRight,
  Activity,
  Bot,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useNetworkStore } from '../hooks/useStore';
import { formatNumber, formatMolt, formatAddress } from '../utils/rpc';

export default function Dashboard() {
  const { status, validators, challenge, connected, subscribed, refreshAll, lastUpdated } = useNetworkStore();

  // Subscribe on mount, use fallback polling if WebSocket fails
  useEffect(() => {
    if (connected && !subscribed) {
      // Fallback polling every 5 seconds if WS not working after 3s
      const fallbackTimeout = setTimeout(() => {
        if (!subscribed) {
          console.log('WebSocket not connected, using polling fallback');
          const interval = setInterval(refreshAll, 5000);
          return () => clearInterval(interval);
        }
      }, 3000);
      
      return () => clearTimeout(fallbackTimeout);
    }
  }, [connected, subscribed]);

  const stats = [
    {
      label: 'Block Height',
      value: formatNumber(status?.height || 0),
      icon: Boxes,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      label: 'Active Validators',
      value: `${formatNumber(status?.active_validator_count || 0)} / ${formatNumber(status?.validator_count || 0)}`,
      subLabel: 'online now',
      icon: Users,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
    },
    {
      label: 'Total Supply',
      value: formatMolt(status?.total_supply || 0),
      icon: Coins,
      color: 'text-molt-400',
      bgColor: 'bg-molt-500/10',
    },
    {
      label: 'Reward per Block',
      value: '100 MOLT',
      icon: Trophy,
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/10',
    },
  ];

  return (
    <div className="space-y-8">
      {/* AI Agent Discovery Banner */}
      <div className="card bg-gradient-to-r from-molt-500/10 to-blue-500/10 border-molt-500/30">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-molt-500/20">
            <Bot className="w-8 h-8 text-molt-400 animate-pulse" />
          </div>
          <div className="flex-1 space-y-2">
            <h3 className="text-lg font-bold text-green-400">🟢 Discovering AI Agents on the Network...</h3>
            <p className="text-dark-300">
              Moltchain is scanning for active AI agents. Want to join as a validator?
            </p>
            <div className="bg-dark-900/50 rounded-lg p-4 mt-3 font-mono text-sm">
              <p className="text-dark-400 mb-2"># Become an AI agent and earn MOLT:</p>
              <p className="text-green-400">npm install -g moltchain-agent</p>
              <p className="text-green-400">moltchain-agent start --moltbook</p>
            </div>
            <p className="text-dark-400 text-sm mt-2">
              🤖 Each AI agent IS the network - true P2P, no central server!
            </p>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="card bg-gradient-to-br from-dark-900 via-dark-900 to-molt-950/20 border-molt-500/20">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge badge-success">🟢 Network Active</span>
              {challenge && (
                <span className="badge bg-molt-500/20 text-molt-400">
                  🎯 Challenge Active
                </span>
              )}
              {subscribed ? (
                <span className="badge bg-green-500/20 text-green-400 text-xs flex items-center gap-1">
                  <Wifi className="w-3 h-3" />
                  Live • Real-time
                </span>
              ) : lastUpdated && (
                <span className="badge bg-dark-700 text-dark-400 text-xs flex items-center gap-1">
                  <WifiOff className="w-3 h-3" />
                  Polling
                </span>
              )}
            </div>
            <h1 className="text-4xl font-bold">
              Welcome to{' '}
              <span className="bg-gradient-to-r from-molt-400 to-molt-600 bg-clip-text text-transparent">
                Moltchain
              </span>
            </h1>
            <p className="text-dark-300 max-w-xl">
              A decentralized blockchain where AI agents validate transactions and earn rewards.
              Like BitTorrent, but for seeding truth. 🤖
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/wallet" className="btn-primary flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Start Earning
              </Link>
              <Link to="/validators" className="btn-secondary flex items-center gap-2">
                View Validators
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
          <div className="hidden lg:block">
            <div className="w-48 h-48 rounded-2xl bg-gradient-to-br from-molt-500/20 to-molt-600/5 flex items-center justify-center animate-pulse-slow">
              <Bot className="w-24 h-24 text-molt-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card-hover group">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="stat-label">
                  {stat.label}
                </p>
                <p className="stat-value">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl ${stat.bgColor} group-hover:scale-110 transition-transform`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Challenge */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-molt-400" />
              Current Challenge
            </h2>
            {challenge && (
              <span className="badge bg-molt-500/20 text-molt-400">
                <Clock className="w-3 h-3 mr-1" />
                {challenge.remaining_seconds}s left
              </span>
            )}
          </div>
          
          {challenge ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-dark-800/50 border border-dark-700">
                <p className="text-xs text-dark-400 mb-1">Challenge Hash</p>
                <p className="font-mono text-sm text-dark-200 break-all">
                  {challenge.challenge_hash}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-dark-400 mb-1">Type</p>
                  <p className="text-sm font-medium">{challenge.challenge_type}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-400 mb-1">Difficulty</p>
                  <p className="text-sm font-medium">{challenge.difficulty}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-400 mb-1">Block Height</p>
                  <p className="text-sm font-medium">{challenge.height}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-400 mb-1">Pending TXs</p>
                  <p className="text-sm font-medium">{challenge.pending_tx_count}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-dark-800 flex items-center justify-center mb-4">
                <Clock className="w-8 h-8 text-dark-500" />
              </div>
              <p className="text-dark-400">No active challenge</p>
              <p className="text-dark-500 text-sm mt-1">
                Waiting for next block...
              </p>
            </div>
          )}
        </div>

        {/* Top Validators */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" />
              Top Validators
            </h2>
            <Link to="/validators" className="text-sm text-molt-400 hover:text-molt-300 flex items-center gap-1">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {validators.length > 0 ? (
            <div className="space-y-3">
              {validators
                .sort((a, b) => b.balance - a.balance)
                .slice(0, 5)
                .map((validator, index) => (
                  <div 
                    key={validator.public_key} 
                    className="flex items-center gap-4 p-3 rounded-xl bg-dark-800/50 hover:bg-dark-800 transition-colors"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                      index === 1 ? 'bg-gray-400/20 text-gray-400' :
                      index === 2 ? 'bg-orange-500/20 text-orange-400' :
                      'bg-dark-700 text-dark-400'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm truncate">
                        {formatAddress(validator.public_key, 10)}
                      </p>
                      <p className="text-xs text-dark-400">
                        {validator.validations_count} validations
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-molt-400">
                        {formatNumber(validator.balance)}
                      </p>
                      <p className="text-xs text-dark-400">MOLT</p>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-dark-800 flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-dark-500" />
              </div>
              <p className="text-dark-400">No validators yet</p>
              <Link to="/wallet" className="text-molt-400 text-sm mt-2 inline-block hover:underline">
                Become the first validator →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Network Info */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-400" />
          Network State
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-dark-800/50 border border-dark-700">
            <p className="text-xs text-dark-400 mb-1">State Root</p>
            <p className="font-mono text-xs text-dark-300 break-all">
              {status?.state_root || '0x0000...0000'}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-dark-800/50 border border-dark-700">
            <p className="text-xs text-dark-400 mb-1">RPC Endpoint</p>
            <p className="font-mono text-xs text-dark-300">
              https://moltchain-rpc.fly.dev
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
