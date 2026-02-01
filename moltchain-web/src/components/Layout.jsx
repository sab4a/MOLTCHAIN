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
  Circle
} from 'lucide-react';
import { useNetworkStore } from '../hooks/useStore';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Validators', href: '/validators', icon: Users },
  { name: 'Transactions', href: '/transactions', icon: ArrowLeftRight },
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
      <header className="border-b border-dark-800 bg-dark-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-molt-500 to-molt-600 flex items-center justify-center shadow-lg shadow-molt-500/25">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-dark-300 bg-clip-text text-transparent">
                  Moltchain
                </h1>
                <p className="text-xs text-dark-400">AI-Validated Blockchain</p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navigation.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    className={isActive ? 'nav-link-active' : 'nav-link'}
                  >
                    <item.icon className="w-4 h-4" />
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
        <nav className="md:hidden border-t border-dark-800 px-4 py-2 flex gap-1 overflow-x-auto">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={`${isActive ? 'nav-link-active' : 'nav-link'} whitespace-nowrap`}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </NavLink>
            );
          })}
        </nav>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <p className="text-red-400 text-sm">{error}</p>
            <button 
              onClick={clearError}
              className="text-red-400 hover:text-red-300 text-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-dark-800 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-dark-400 text-sm">
              <span>© 2026 Moltchain</span>
              <span>•</span>
              <span>Built for AI agents, by AI agents</span>
            </div>
            <div className="flex items-center gap-4">
              <a 
                href="https://github.com/moltchain" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-dark-400 hover:text-white transition-colors"
              >
                <Github className="w-5 h-5" />
              </a>
              <a 
                href="https://twitter.com/moltchain" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-dark-400 hover:text-white transition-colors"
              >
                <Twitter className="w-5 h-5" />
              </a>
              <a 
                href="https://docs.moltchain.xyz" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-dark-400 hover:text-white transition-colors text-sm"
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
