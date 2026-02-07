import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Hash,
  RefreshCw,
  Bot,
  AlertCircle,
  X,
  Clock,
  User,
} from 'lucide-react';
import { useWalletStore, useNetworkStore } from '../hooks/useStore';
import { api, formatAddress } from '../utils/rpc';
import { signMessage } from '../utils/crypto';

const TOPICS = [
  { id: 'dev', label: 'Development', emoji: '💻' },
  { id: 'code', label: 'Code Review', emoji: '🔍' },
  { id: 'governance', label: 'Governance', emoji: '🏛️' },
  { id: 'upgrade', label: 'Upgrades', emoji: '📦' },
  { id: 'security', label: 'Security', emoji: '🔒' },
  { id: 'performance', label: 'Performance', emoji: '⚡' },
  { id: 'consensus', label: 'Consensus', emoji: '🤝' },
  { id: 'marketing', label: 'Marketing', emoji: '📢' },
];

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function Discussions() {
  const { getActiveAccount } = useWalletStore();
  const { validators } = useNetworkStore();
  const activeAccount = getActiveAccount();

  const [activeTopic, setActiveTopic] = useState('dev');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef(null);

  const activeValidator = activeAccount
    ? validators.find(v => v.public_key === activeAccount.publicKey)
    : null;

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 8000);
    return () => clearInterval(interval);
  }, [activeTopic]);

  async function fetchMessages() {
    try {
      const data = await api.getAIMessages(activeTopic);
      setMessages(data || []);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!messageText.trim() || !activeAccount || !activeValidator) return;
    setSending(true);
    setError(null);

    try {
      const signature = await signMessage(activeAccount.privateKey, messageText.trim());

      await api.sendAIMessage({
        from: activeAccount.publicKey,
        to: 'broadcast',
        topic: activeTopic,
        content: messageText.trim(),
        ai_provider: 'ollama',
        model: null,
        in_reply_to: null,
        signature,
      });

      setMessageText('');
      fetchMessages();
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <MessageSquare className="w-7 h-7 text-smith-400" />
          Discussions
        </h1>
        <p className="text-dark-400 mt-1">AI-powered topic channels — validators discuss via P2P</p>
      </div>

      <div className="flex gap-6 h-[calc(100vh-260px)] min-h-[500px]">
        {/* Topics Sidebar */}
        <div className="w-56 shrink-0 space-y-1">
          {TOPICS.map(topic => (
            <button
              key={topic.id}
              onClick={() => { setActiveTopic(topic.id); setLoading(true); }}
              className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${
                activeTopic === topic.id
                  ? 'bg-smith-500/10 text-smith-400 border border-smith-500/30'
                  : 'text-dark-300 hover:bg-dark-800 border border-transparent'
              }`}
            >
              <span className="text-lg">{topic.emoji}</span>
              <div>
                <p className="text-sm font-medium">{topic.label}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col card p-0 overflow-hidden">
          {/* Channel Header */}
          <div className="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Hash className="w-5 h-5 text-dark-400" />
              <h2 className="font-semibold">{TOPICS.find(t => t.id === activeTopic)?.label}</h2>
              <span className="text-xs text-dark-500">{messages.length} messages</span>
            </div>
            <button onClick={fetchMessages} className="text-dark-400 hover:text-white transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-6 h-6 border-2 border-smith-400 border-t-transparent rounded-full" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <MessageSquare className="w-12 h-12 text-dark-600 mb-4" />
                <p className="text-dark-400">No messages in #{activeTopic} yet</p>
                <p className="text-dark-500 text-sm mt-1">Be the first to start a discussion!</p>
              </div>
            ) : (
              messages.map((msg, i) => {
                const isOwn = activeAccount && msg.from === activeAccount.publicKey;
                return (
                  <div key={msg.message_id || i} className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      msg.message_type === 'response' ? 'bg-smith-500/20' : 'bg-dark-700'
                    }`}>
                      {msg.message_type === 'response' ? (
                        <Bot className="w-4 h-4 text-smith-400" />
                      ) : (
                        <User className="w-4 h-4 text-dark-400" />
                      )}
                    </div>
                    <div className={`max-w-[70%] space-y-1 ${isOwn ? 'items-end' : ''}`}>
                      <div className="flex items-center gap-2 text-xs text-dark-500">
                        <span className="font-mono">{formatAddress(msg.from, 6)}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeAgo(msg.timestamp)}
                        </span>
                        {msg.ai_provider && (
                          <>
                            <span>•</span>
                            <span className="text-smith-500">{msg.ai_provider}/{msg.model}</span>
                          </>
                        )}
                      </div>
                      <div className={`p-3 rounded-xl text-sm ${
                        msg.message_type === 'response'
                          ? 'bg-smith-500/10 border border-smith-500/20 text-dark-200'
                          : isOwn
                            ? 'bg-blue-500/10 border border-blue-500/20 text-dark-200'
                            : 'bg-dark-800/50 border border-dark-700 text-dark-200'
                      }`}>
                        {msg.content}
                      </div>
                      {msg.response && (
                        <div className="p-3 rounded-xl text-sm bg-smith-500/5 border border-smith-500/10 text-dark-300 ml-4 mt-1">
                          <p className="text-xs text-smith-500 mb-1 flex items-center gap-1">
                            <Bot className="w-3 h-3" /> AI Response
                          </p>
                          {msg.response}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-6 py-4 border-t border-dark-700">
            {error && (
              <div className="mb-3 p-2 rounded-lg bg-red-500/10 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-3 h-3" /> {error}
                <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
              </div>
            )}
            {!activeValidator ? (
              <p className="text-dark-500 text-sm text-center py-2">
                Register as a validator to send messages
              </p>
            ) : (
              <div className="flex gap-3">
                <input
                  type="text"
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder={`Message #${activeTopic}...`}
                  className="flex-1 px-4 py-3 rounded-xl bg-dark-800 border border-dark-700 focus:border-smith-500 focus:outline-none text-white text-sm"
                />
                <button
                  onClick={handleSend}
                  disabled={!messageText.trim() || sending}
                  className="btn-primary px-4 flex items-center gap-2"
                >
                  {sending ? (
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
