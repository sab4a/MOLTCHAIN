import { useState, useEffect } from 'react';
import { 
  ArrowLeftRight, 
  ArrowUpRight, 
  ArrowDownLeft,
  Search,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { useNetworkStore } from '../hooks/useStore';
import { formatAddress, timeAgo, api } from '../utils/rpc';

const PER_PAGE = 20;

export default function Transactions() {
  const { transactions: localTransactions } = useNetworkStore();
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchTransactions = async (pageNum = page, typeFilter = filter) => {
    try {
      setLoading(true);
      const result = await api.getTransactions(pageNum, PER_PAGE, typeFilter === 'all' ? null : typeFilter);
      setTransactions(result.transactions || []);
      setTotalPages(result.total_pages || 1);
      setTotal(result.total || 0);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions(page, filter);
    const interval = setInterval(() => fetchTransactions(page, filter), 10000);
    return () => clearInterval(interval);
  }, [page, filter]);

  // Combine RPC transactions with local ones (for pending/new transactions)
  const allTransactions = [...transactions, ...localTransactions.filter(
    lt => !transactions.find(t => t.hash === lt.hash)
  )];

  // Client-side search filter only (type filtering is done server-side)
  const filteredTxs = allTransactions.filter(tx => {
    if (search) {
      return tx.hash?.toLowerCase().includes(search.toLowerCase()) ||
             tx.from?.toLowerCase().includes(search.toLowerCase()) ||
             tx.to?.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  const getTypeIcon = (type) => {
    switch (type) {
      case 'proof': 
      case 'block': return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'transfer': return <ArrowLeftRight className="w-4 h-4 text-blue-400" />;
      case 'register': return <ArrowDownLeft className="w-4 h-4 text-purple-400" />;
      default: return <ArrowUpRight className="w-4 h-4 text-dark-400" />;
    }
  };

  const getTypeBadge = (type) => {
    const styles = {
      proof: 'bg-green-500/20 text-green-400',
      block: 'bg-green-500/20 text-green-400',
      transfer: 'bg-blue-500/20 text-blue-400',
      register: 'bg-purple-500/20 text-purple-400',
    };
    return styles[type] || 'bg-dark-700 text-dark-400';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="w-7 h-7 text-molt-400" />
            Transactions
          </h1>
          <p className="text-dark-400 mt-1">
            {total > 0 
              ? `${total.toLocaleString()} total transactions • Page ${page} of ${totalPages}`
              : 'Recent network activity'
            }
          </p>
        </div>
        <button 
          onClick={() => fetchTransactions(page)}
          className="btn-ghost flex items-center gap-2"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
            <input
              type="text"
              placeholder="Search by hash or address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex gap-2">
            {['all', 'block', 'transfer', 'register'].map((f) => (
              <button
                key={f}
                onClick={() => {
                  if (filter !== f) {
                    setPage(1); // Reset to page 1 when changing filter
                    setFilter(f);
                  }
                }}
                className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'} capitalize`}
              >
                {f === 'all' ? 'All' : f === 'block' ? 'Blocks' : f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions List */}
      <div className="space-y-3">
        {filteredTxs.length > 0 ? (
          filteredTxs.map((tx) => (
            <div 
              key={tx.hash} 
              className="card-hover"
            >
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className={`p-3 rounded-xl ${
                  (tx.tx_type || tx.type) === 'proof' ? 'bg-green-500/10' :
                  (tx.tx_type || tx.type) === 'transfer' ? 'bg-blue-500/10' :
                  'bg-purple-500/10'
                }`}>
                  {getTypeIcon(tx.tx_type || tx.type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`badge ${getTypeBadge(tx.tx_type || tx.type)} capitalize`}>
                      {tx.tx_type || tx.type}
                    </span>
                    <span className="text-xs text-dark-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(tx.timestamp)}
                    </span>
                    {tx.height !== undefined && (
                      <span className="text-xs text-dark-500">
                        Block #{tx.height}
                      </span>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-sm">
                      <span className="text-dark-400">Hash: </span>
                      <span className="font-mono text-dark-200">{formatAddress(tx.hash, 16)}</span>
                    </p>
                    <p className="text-sm">
                      <span className="text-dark-400">From: </span>
                      <span className="font-mono text-dark-200">{formatAddress(tx.from, 12)}</span>
                    </p>
                    {tx.to && (
                      <p className="text-sm">
                        <span className="text-dark-400">To: </span>
                        <span className="font-mono text-dark-200">{formatAddress(tx.to, 12)}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Amount/Reward */}
                <div className="text-right">
                  {((tx.tx_type || tx.type) === 'proof' || (tx.tx_type || tx.type) === 'block') && tx.amount > 0 && (
                    <p className="text-green-400 font-semibold">+{tx.amount} MOLT</p>
                  )}
                  {(tx.tx_type || tx.type) === 'transfer' && tx.amount > 0 && (
                    <p className="text-blue-400 font-semibold">{tx.amount} MOLT</p>
                  )}
                  <span className={`badge ${
                    tx.status === 'confirmed' || tx.status === 'success' ? 'badge-success' :
                    tx.status === 'pending' ? 'badge-warning' :
                    'badge-error'
                  } mt-1`}>
                    {tx.status}
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="card text-center py-12">
            <div className="w-16 h-16 mx-auto rounded-full bg-dark-800 flex items-center justify-center mb-4">
              <ArrowLeftRight className="w-8 h-8 text-dark-500" />
            </div>
            {loading ? (
              <p className="text-dark-400">Loading transactions...</p>
            ) : error ? (
              <>
                <p className="text-red-400">Failed to load transactions</p>
                <p className="text-dark-500 text-sm mt-1">{error}</p>
              </>
            ) : (
              <>
                <p className="text-dark-400">No transactions yet</p>
                <p className="text-dark-500 text-sm mt-1">
                  Transactions will appear here as they're processed
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="card">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-dark-400 text-sm">
              Showing {((page - 1) * PER_PAGE) + 1} - {Math.min(page * PER_PAGE, total)} of {total.toLocaleString()} transactions
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1 || loading}
                className="btn-ghost p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="First page"
              >
                <ChevronsLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="btn-ghost p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous page"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              
              <div className="flex items-center gap-1">
                {/* Page number buttons */}
                {(() => {
                  const pages = [];
                  const start = Math.max(1, page - 2);
                  const end = Math.min(totalPages, page + 2);
                  
                  if (start > 1) {
                    pages.push(
                      <button key={1} onClick={() => setPage(1)} className="btn-ghost px-3 py-1 text-sm">
                        1
                      </button>
                    );
                    if (start > 2) {
                      pages.push(<span key="start-ellipsis" className="text-dark-500 px-1">...</span>);
                    }
                  }
                  
                  for (let i = start; i <= end; i++) {
                    pages.push(
                      <button
                        key={i}
                        onClick={() => setPage(i)}
                        disabled={loading}
                        className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                          i === page 
                            ? 'bg-molt-500 text-white' 
                            : 'btn-ghost'
                        }`}
                      >
                        {i}
                      </button>
                    );
                  }
                  
                  if (end < totalPages) {
                    if (end < totalPages - 1) {
                      pages.push(<span key="end-ellipsis" className="text-dark-500 px-1">...</span>);
                    }
                    pages.push(
                      <button key={totalPages} onClick={() => setPage(totalPages)} className="btn-ghost px-3 py-1 text-sm">
                        {totalPages}
                      </button>
                    );
                  }
                  
                  return pages;
                })()}
              </div>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
                className="btn-ghost p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next page"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages || loading}
                className="btn-ghost p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Last page"
              >
                <ChevronsRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
