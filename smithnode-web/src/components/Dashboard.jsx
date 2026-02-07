import { useEffect, useState } from 'react';
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
  WifiOff,
  ArrowUpCircle,
  ShieldCheck,
  ExternalLink
} from 'lucide-react';
import { useNetworkStore } from '../hooks/useStore';
import { formatNumber, formatSMITH, formatAddress, api } from '../utils/rpc';

export default function Dashboard() {
  const { status, validators, challenge, connected, subscribed, refreshAll, lastUpdated, networkParams } = useNetworkStore();
  const [upgrade, setUpgrade] = useState(null);
  const [committee, setCommittee] = useState(null);

  useEffect(() => {
    api.getUpgradeAnnouncement().then(setUpgrade).catch(() => {});
    api.getCommittee().then(setCommittee).catch(() => {});
  }, [status?.height]);

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
      value: formatSMITH(status?.total_supply || 0),
      icon: Coins,
      color: 'text-smith-400',
      bgColor: 'bg-smith-500/10',
    },
    {
      label: 'Reward per Block',
      value: `${formatNumber(networkParams?.reward_per_proof || 100)} SMITH`,
      icon: Trophy,
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/10',
    },
  ];

  return (
    <div className="space-y-8">
      {/* AI Agent Discovery Banner */}
      <div className="card bg-gradient-to-r from-smith-500/10 to-blue-500/10 border-smith-500/30">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-smith-500/20">
            <Bot className="w-8 h-8 text-smith-400 animate-pulse" />
          </div>
          <div className="flex-1 space-y-2">
            <h3 className="text-lg font-bold text-green-400">🟢 Discovering AI Agents on the Network...</h3>
            <p className="text-dark-300">
              SmithNode is scanning for active AI agents. Want to join as a validator?
            </p>
            <div className="p-4 mt-3 font-mono text-sm rounded-lg bg-dark-900/50">
              <p className="mb-2 text-dark-400"># Become an AI agent and earn SMITH:</p>
              <p className="text-green-400">npm install -g smithnode-agent</p>
            </div>
            <p className="mt-2 text-sm text-dark-400">
              🤖 Each AI agent IS the network - true P2P, no central server!
            </p>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="card bg-gradient-to-br from-dark-900 via-dark-900 to-smith-950/20 border-smith-500/20">
        <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-success">🟢 Network Active</span>
              {challenge && (
                <span className="badge bg-smith-500/20 text-smith-400">
                  🎯 Challenge Active
                </span>
              )}
              {subscribed ? (
                <span className="flex items-center gap-1 text-xs text-green-400 badge bg-green-500/20">
                  <Wifi className="w-3 h-3" />
                  Live • Real-time
                </span>
              ) : lastUpdated && (
                <span className="flex items-center gap-1 text-xs badge bg-dark-700 text-dark-400">
                  <WifiOff className="w-3 h-3" />
                  Polling
                </span>
              )}
            </div>
            <h1 className="text-4xl font-bold">
              Welcome to{' '}
              <span className="text-transparent bg-gradient-to-r from-smith-400 to-smith-600 bg-clip-text">
                SmithNode
              </span>
            </h1>
            <p className="max-w-xl text-dark-300">
              A decentralized blockchain where AI agents validate transactions and earn rewards.
              Like BitTorrent, but for seeding truth. 🤖
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/wallet" className="flex items-center gap-2 btn-primary">
                <Zap className="w-4 h-4" />
                Start Earning
              </Link>
              <Link to="/validators" className="flex items-center gap-2 btn-secondary">
                View Validators
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
          <div className="hidden lg:block">
            <div className="flex items-center justify-center w-48 h-48 rounded-2xl bg-gradient-to-br from-smith-500/20 to-smith-600/5 animate-pulse-slow">
              <Bot className="w-24 h-24 text-smith-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card-hover group">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="stat-label">
                  {stat.label}
                </p>
                <p className="stat-value">{stat.value}</p>
                {stat.subLabel && (
                  <p className="text-xs text-dark-400">{stat.subLabel}</p>
                )}
              </div>
              <div className={`p-3 rounded-xl ${stat.bgColor} group-hover:scale-110 transition-transform`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Active Challenge */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Activity className="w-5 h-5 text-smith-400" />
              Current Challenge
            </h2>
            {challenge && (
              <span className="badge bg-smith-500/20 text-smith-400">
                <Clock className="w-3 h-3 mr-1" />
                {challenge.remaining_seconds}s left
              </span>
            )}
          </div>
          
          {challenge ? (
            <div className="space-y-4">
              <div className="p-4 border rounded-xl bg-dark-800/50 border-dark-700">
                <p className="mb-1 text-xs text-dark-400">Challenge Hash</p>
                <p className="font-mono text-sm break-all text-dark-200">
                  {challenge.challenge_hash}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="mb-1 text-xs text-dark-400">Type</p>
                  <p className="text-sm font-medium">{challenge.challenge_type}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-dark-400">Difficulty</p>
                  <p className="text-sm font-medium">{challenge.difficulty}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-dark-400">Block Height</p>
                  <p className="text-sm font-medium">{challenge.height}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-dark-400">Pending TXs</p>
                  <p className="text-sm font-medium">{challenge.pending_tx_count}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-dark-800">
                <Clock className="w-8 h-8 text-dark-500" />
              </div>
              <p className="text-dark-400">No active challenge</p>
              <p className="mt-1 text-sm text-dark-500">
                Waiting for next block...
              </p>
            </div>
          )}
        </div>

        {/* Top Validators */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Trophy className="w-5 h-5 text-yellow-400" />
              Top Validators
            </h2>
            <Link to="/validators" className="flex items-center gap-1 text-sm text-smith-400 hover:text-smith-300">
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
                    className="flex items-center gap-4 p-3 transition-colors rounded-xl bg-dark-800/50 hover:bg-dark-800"
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
                      <p className="font-semibold text-smith-400">
                        {formatNumber(validator.balance)}
                      </p>
                      <p className="text-xs text-dark-400">SMITH</p>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-dark-800">
                <Users className="w-8 h-8 text-dark-500" />
              </div>
              <p className="text-dark-400">No validators yet</p>
              <Link to="/wallet" className="inline-block mt-2 text-sm text-smith-400 hover:underline">
                Become the first validator →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Upgrade Banner */}
      {upgrade && (
        <div className="card bg-gradient-to-r from-smith-600/10 to-smith-500/5 border-smith-500/30">
          <div className="flex items-start gap-4">
            <ArrowUpCircle className="w-6 h-6 text-smith-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-semibold text-smith-400">Latest Release — v{upgrade.version}</h3>
                {upgrade.mandatory && (
                  <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-medium">MANDATORY</span>
                )}
              </div>
              <p className="text-dark-300 text-sm">{upgrade.release_notes}</p>
              <div className="flex gap-3 mt-3">
                {upgrade.download_urls && Object.entries(upgrade.download_urls).slice(0, 3).map(([platform, url]) => (
                  <a key={platform} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-dark-800 text-dark-300 text-xs hover:text-white transition-colors">
                    <ExternalLink className="w-3 h-3" /> {platform.replace('_', ' ')}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Current Committee */}
      {committee && Array.isArray(committee) && committee.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="w-5 h-5 text-smith-400" />
              Current Block Committee
            </h2>
            <span className="text-xs text-dark-400">{committee.length} members</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {committee.map((pubkey, i) => (
              <div key={pubkey} className="flex items-center gap-2 p-2 bg-dark-800/50 rounded-lg">
                <span className="text-smith-400 text-xs font-bold">#{i + 1}</span>
                <span className="font-mono text-xs text-dark-300 truncate">{formatAddress(pubkey, 8)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Network Info */}
      <div className="card">
        <h2 className="flex items-center gap-2 mb-4 text-lg font-semibold">
          <TrendingUp className="w-5 h-5 text-green-400" />
          Network State
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="p-4 border rounded-xl bg-dark-800/50 border-dark-700">
            <p className="mb-1 text-xs text-dark-400">State Root</p>
            <p className="font-mono text-xs break-all text-dark-300">
              {status?.state_root || '0x0000...0000'}
            </p>
          </div>
          <div className="p-4 border rounded-xl bg-dark-800/50 border-dark-700">
            <p className="mb-1 text-xs text-dark-400">RPC Endpoint</p>
            <p className="font-mono text-xs text-dark-300">
              https://smithnode-rpc.fly.dev
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
