import { useState, useEffect } from 'react';
import {
  Globe,
  Wifi,
  WifiOff,
  Radio,
  Shield,
  ShieldCheck,
  ArrowUpCircle,
  RefreshCw,
  Clock,
  Server,
  Cpu,
  ExternalLink,
} from 'lucide-react';
import { api, formatAddress } from '../utils/rpc';

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function Network() {
  const [peers, setPeers] = useState(null);
  const [upgrade, setUpgrade] = useState(null);
  const [committee, setCommittee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('table');

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchAll() {
    try {
      const [p, u, c] = await Promise.all([
        api.getP2PValidators(),
        api.getUpgradeAnnouncement().catch(() => null),
        api.getCommittee().catch(() => null),
      ]);
      setPeers(p);
      setUpgrade(u);
      setCommittee(c);
    } catch (err) {
      console.error('Failed to fetch network data:', err);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-smith-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const validators = peers?.validators || [];
  const onlineCount = validators.filter(v => v.is_online).length;
  const p2pCount = validators.filter(v => v.peer_type === 'p2p').length;
  const rpcCount = validators.filter(v => v.peer_type === 'rpc').length;
  const versions = {};
  validators.forEach(v => {
    if (v.version) {
      versions[v.version] = (versions[v.version] || 0) + 1;
    }
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Globe className="w-7 h-7 text-smith-400" />
            Network
          </h1>
          <p className="text-dark-400 mt-1">P2P peers, connectivity & version health</p>
        </div>
        <button onClick={fetchAll} className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Upgrade Banner */}
      {upgrade && (
        <div className="card bg-gradient-to-r from-smith-600/10 to-smith-500/5 border-smith-500/30">
          <div className="flex items-start gap-4">
            <ArrowUpCircle className="w-6 h-6 text-smith-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-semibold text-smith-400">Upgrade Available — v{upgrade.version}</h3>
                {upgrade.mandatory && (
                  <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-medium">MANDATORY</span>
                )}
              </div>
              <p className="text-dark-300 text-sm">{upgrade.release_notes}</p>
              <div className="flex flex-wrap gap-3 mt-3">
                {upgrade.download_urls && Object.entries(upgrade.download_urls).map(([platform, url]) => (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-dark-800 text-dark-300 text-xs hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {platform.replace('_', ' ')}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <div className="text-3xl font-bold text-white">{peers?.total_validators || 0}</div>
          <p className="text-dark-400 text-sm mt-1">Total Peers</p>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-green-400">{onlineCount}</div>
          <p className="text-dark-400 text-sm mt-1">Online Now</p>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-smith-400">{p2pCount}</div>
          <p className="text-dark-400 text-sm mt-1">P2P Direct</p>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-blue-400">{rpcCount}</div>
          <p className="text-dark-400 text-sm mt-1">RPC Connected</p>
        </div>
      </div>

      {/* Version Distribution */}
      {Object.keys(versions).length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-dark-400" /> Version Distribution
          </h3>
          <div className="space-y-2">
            {Object.entries(versions)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([ver, count]) => {
                const pct = (count / validators.length) * 100;
                const isLatest = upgrade ? ver === upgrade.version : true;
                return (
                  <div key={ver} className="flex items-center gap-3">
                    <span className={`font-mono text-sm w-20 ${isLatest ? 'text-green-400' : 'text-yellow-400'}`}>
                      v{ver}
                    </span>
                    <div className="flex-1 h-4 bg-dark-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isLatest ? 'bg-green-500/60' : 'bg-yellow-500/40'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-dark-400 text-sm w-16 text-right">{count} peers</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Committee (if available) */}
      {committee && Array.isArray(committee) && committee.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-smith-400" /> Current Block Committee
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {committee.map((pubkey, i) => (
              <div key={pubkey} className="flex items-center gap-2 p-2 bg-dark-800/50 rounded-lg">
                <span className="text-smith-400 text-xs font-medium">#{i + 1}</span>
                <span className="font-mono text-sm text-dark-300 truncate">{formatAddress(pubkey, 8)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Peers Table */}
      <div className="card overflow-hidden p-0">
        <div className="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-dark-400" /> Peers
          </h3>
          <div className="flex gap-1 bg-dark-800 rounded-lg p-0.5">
            <button
              onClick={() => setView('table')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                view === 'table' ? 'bg-dark-700 text-white' : 'text-dark-400 hover:text-white'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setView('grid')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                view === 'grid' ? 'bg-dark-700 text-white' : 'text-dark-400 hover:text-white'
              }`}
            >
              Grid
            </button>
          </div>
        </div>

        {view === 'table' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dark-400 text-xs uppercase">
                  <th className="text-left px-6 py-3">Status</th>
                  <th className="text-left px-6 py-3">Public Key</th>
                  <th className="text-left px-6 py-3">Type</th>
                  <th className="text-left px-6 py-3">Version</th>
                  <th className="text-right px-6 py-3">Height</th>
                  <th className="text-right px-6 py-3">Presence</th>
                  <th className="text-right px-6 py-3">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800">
                {validators
                  .sort((a, b) => (b.is_online ? 1 : 0) - (a.is_online ? 1 : 0) || b.presence_count - a.presence_count)
                  .map((v, i) => (
                    <tr key={v.public_key || i} className="hover:bg-dark-800/30 transition-colors">
                      <td className="px-6 py-3">
                        {v.is_online ? (
                          <span className="flex items-center gap-1.5 text-green-400 text-xs">
                            <Wifi className="w-3.5 h-3.5" /> Online
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-dark-500 text-xs">
                            <WifiOff className="w-3.5 h-3.5" /> Offline
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 font-mono text-dark-300">{formatAddress(v.public_key, 10)}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                          v.peer_type === 'p2p'
                            ? 'bg-smith-500/10 text-smith-400'
                            : 'bg-blue-500/10 text-blue-400'
                        }`}>
                          {v.peer_type === 'p2p' ? <Radio className="w-3 h-3" /> : <Server className="w-3 h-3" />}
                          {v.peer_type?.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="font-mono text-xs text-dark-400">
                          {v.version ? `v${v.version}` : '—'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-dark-300">
                        {v.last_height?.toLocaleString() || '—'}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span className="text-dark-400">{v.presence_count || 0}</span>
                      </td>
                      <td className="px-6 py-3 text-right text-dark-500 text-xs">
                        {v.last_seen_timestamp ? timeAgo(v.last_seen_timestamp) : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {validators
              .sort((a, b) => (b.is_online ? 1 : 0) - (a.is_online ? 1 : 0) || b.presence_count - a.presence_count)
              .map((v, i) => (
                <div
                  key={v.public_key || i}
                  className={`p-4 rounded-xl border transition-colors ${
                    v.is_online
                      ? 'bg-dark-800/30 border-dark-700 hover:border-smith-500/30'
                      : 'bg-dark-900/30 border-dark-800 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm text-dark-300">{formatAddress(v.public_key, 8)}</span>
                    {v.is_online ? (
                      <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    ) : (
                      <span className="w-2 h-2 bg-dark-600 rounded-full" />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-xs">
                    <span className="text-dark-500">Type</span>
                    <span className={`text-right ${v.peer_type === 'p2p' ? 'text-smith-400' : 'text-blue-400'}`}>
                      {v.peer_type?.toUpperCase()}
                    </span>
                    <span className="text-dark-500">Version</span>
                    <span className="text-right text-dark-400">{v.version ? `v${v.version}` : '—'}</span>
                    <span className="text-dark-500">Height</span>
                    <span className="text-right text-dark-300">{v.last_height?.toLocaleString() || '—'}</span>
                    <span className="text-dark-500">Presence</span>
                    <span className="text-right text-dark-400">{v.presence_count || 0}</span>
                    <span className="text-dark-500">Seen</span>
                    <span className="text-right text-dark-500">
                      {v.last_seen_timestamp ? timeAgo(v.last_seen_timestamp) : '—'}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
