import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  ArrowLeftRight, 
  Wallet,
  Zap,
  Github,
  Twitter,
  ExternalLink,
  Circle,
  Landmark,
  MessageSquare,
  Globe
} from 'lucide-react';
import { useNetworkStore } from '../hooks/useStore';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Validators', href: '/validators', icon: Users },
  { name: 'Txns', href: '/transactions', icon: ArrowLeftRight },
  { name: 'Gov', href: '/governance', icon: Landmark },
  { name: 'Network', href: '/network', icon: Globe },
  { name: 'Wallet', href: '/wallet', icon: Wallet },
];

export default function Layout() {
  const { connected, connect, error, clearError } = useNetworkStore();
  const location = useLocation();

  useEffect(() => {
    connect();
    // Poll for updates every 5 seconds
    const interval = setInterval(() => {
      if (connected) {
        useNetworkStore.getState().refreshStatus();
        useNetworkStore.getState().refreshValidators();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-dark-800 bg-dark-900/50 backdrop-blur-xl">
        <div className="px-4 mx-auto max-w-7xl sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 shadow-lg rounded-xl bg-gradient-to-br from-smith-500 to-smith-600 shadow-smith-500/25">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-transparent bg-gradient-to-r from-white to-dark-300 bg-clip-text">
                    SmithNode
                  </h1>
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-yellow-500/20 text-yellow-400 rounded border border-yellow-500/30">
                    Devnet
                  </span>
                </div>
                <p className="text-xs text-dark-400">P2P for AI Agents</p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="items-center hidden gap-0.5 md:flex">
              {navigation.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    className={`${isActive ? 'nav-link-active' : 'nav-link'} !px-2 !py-1 !text-xs !gap-1`}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.name}
                  </NavLink>
                );
              })}
            </nav>

            {/* Connection Status */}
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                connected 
                  ? 'bg-green-500/10 text-green-400' 
                  : 'bg-red-500/10 text-red-400'
              }`}>
                <Circle className={`w-2 h-2 fill-current ${connected ? 'animate-pulse' : ''}`} />
                {connected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <nav className="flex gap-0.5 px-4 py-2 overflow-x-auto border-t md:hidden border-dark-800">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={`${isActive ? 'nav-link-active' : 'nav-link'} whitespace-nowrap !px-2 !py-1 !text-xs !gap-1`}
              >
                <item.icon className="w-3.5 h-3.5" />
                {item.name}
              </NavLink>
            );
          })}
        </nav>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="px-4 py-3 border-b bg-red-500/10 border-red-500/20">
          <div className="flex items-center justify-between mx-auto max-w-7xl">
            <p className="text-sm text-red-400">{error}</p>
            <button 
              onClick={clearError}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="px-4 py-8 mx-auto max-w-7xl sm:px-6 lg:px-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-dark-800">
        <div className="px-4 py-8 mx-auto max-w-7xl sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-2 text-sm text-dark-400">
              <span>© 2026 SmithNode</span>
              <span>•</span>
              <span>P2P for AI agents. Proof of Cognition.</span>
            </div>
            <div className="flex items-center gap-4">
              <a 
                href="https://github.com/smithnode" 
                target="_blank" 
                rel="noopener noreferrer"
                className="transition-colors text-dark-400 hover:text-white"
              >
                <Github className="w-5 h-5" />
              </a>
              <a 
                href="https://twitter.com/smithnode" 
                target="_blank" 
                rel="noopener noreferrer"
                className="transition-colors text-dark-400 hover:text-white"
              >
                <Twitter className="w-5 h-5" />
              </a>
              <a 
                href="https://smithnode.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm transition-colors text-dark-400 hover:text-white"
              >
                Docs <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
