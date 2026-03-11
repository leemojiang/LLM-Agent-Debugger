import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Play, 
  Pause, 
  Trash2, 
  Search, 
  Settings, 
  Activity, 
  ChevronRight, 
  ChevronDown,
  Terminal,
  MessageSquare,
  Code,
  Eye,
  Send,
  Clock,
  Filter,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { JsonView as ReactJsonView, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

// --- Types ---
interface LogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  request_headers: string;
  request_body: string;
  response_headers?: string;
  response_body?: string;
  status_code?: number;
  session_id: string;
  is_sse: boolean;
  status: 'pending' | 'completed' | 'error';
  sse_chunks?: string[];
  duration?: number;
  tokens?: {
    input: number;
    output: number;
    total: number;
    cache_read?: number;
    cache_creation?: number;
  };
}

// --- Components ---

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <button 
      onClick={handleCopy}
      className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-500 hover:text-emerald-400 transition-all"
      title="Copy to clipboard"
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
};

const JsonView = ({ data }: { data: any }) => {
  // Use memo to prevent re-renders from resetting expansion state if data hasn't changed
  const memoData = React.useMemo(() => data, [JSON.stringify(data)]);
  
  return (
    <div className="font-mono text-sm bg-zinc-950 p-4 rounded-lg overflow-auto max-h-[500px] border border-zinc-800 custom-scrollbar">
      <ReactJsonView 
        data={memoData} 
        shouldExpandNode={() => true} 
        style={darkStyles}
      />
    </div>
  );
};

const MarkdownView = ({ content }: { content: string }) => {
  return (
    <div className="prose prose-invert max-w-none bg-zinc-900 p-6 rounded-lg border border-zinc-800 overflow-auto max-h-[500px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
};

export default function App() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [config, setConfig] = useState<any>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'error'>('all');
  const [viewMode, setViewMode] = useState<'json' | 'markdown'>('json');
  const [sseViewMode, setSseViewMode] = useState<'parsed' | 'raw'>('parsed');
  const [editBody, setEditBody] = useState('');
  const [isReleasing, setIsReleasing] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [status, setStatus] = useState({ proxy: 'offline', upstream: 'offline', upstreamUrl: '', proxyUrl: '' });
  const [isEditingUpstream, setIsEditingUpstream] = useState(false);
  const [newUpstreamUrl, setNewUpstreamUrl] = useState('');
  
  const socketRef = useRef<Socket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('config_update', (data) => {
      setAutoMode(data.autoMode);
      setConfig(data);
    });

    socketRef.current.on('connect', () => {
      setStatus(prev => ({ ...prev, proxy: 'online' }));
    });

    socketRef.current.on('disconnect', () => {
      setStatus(prev => ({ ...prev, proxy: 'offline' }));
    });

    socketRef.current.on('status_update', (data) => {
      setStatus(prev => ({ ...prev, ...data }));
    });

    socketRef.current.on('request_received', (req) => {
      setLogs(prev => [{ ...req, status: 'pending', sse_chunks: [], timestamp: new Date().toISOString() }, ...prev]);
      setIsReplaying(false); // Stop replaying state when a new request is received
    });

    socketRef.current.on('response_received', ({ id, status, body, duration, tokens }) => {
      setLogs(prev => prev.map(log => 
        log.id === id ? { ...log, status: 'completed', status_code: status, response_body: body, duration, tokens } : log
      ));
    });

    socketRef.current.on('response_started', ({ id, isSSE, status }) => {
      setLogs(prev => prev.map(log => 
        log.id === id ? { ...log, is_sse: isSSE, status_code: status || log.status_code } : log
      ));
    });

    socketRef.current.on('sse_chunk', ({ id, chunk }) => {
      setLogs(prev => prev.map(log => 
        log.id === id ? { ...log, sse_chunks: [...(log.sse_chunks || []), chunk] } : log
      ));
    });

    socketRef.current.on('response_finished', ({ id, duration, tokens, status }) => {
      setLogs(prev => prev.map(log => 
        log.id === id ? { ...log, status: 'completed', duration, tokens, status_code: status || log.status_code } : log
      ));
    });

    socketRef.current.on('response_error', ({ id, error, isConnectionError }) => {
      setLogs(prev => prev.map(log => 
        log.id === id ? { 
          ...log, 
          status: 'error', 
          status_code: isConnectionError ? 502 : 500,
          response_body: error 
        } : log
      ));
    });

    socketRef.current.on('logs_cleared', () => setLogs([]));

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const selectedLog = logs.find(l => l.id === selectedId);

  useEffect(() => {
    if (selectedLog) {
      try {
        // Try to format the JSON for better editing experience
        const obj = JSON.parse(selectedLog.request_body);
        setEditBody(JSON.stringify(obj, null, 2));
      } catch {
        setEditBody(selectedLog.request_body);
      }
    } else {
      setEditBody('');
    }
    setIsReleasing(false); // Reset releasing state when selection changes
  }, [selectedId]); // Only depend on selectedId to avoid resetting while editing

  // --- SSE Parsing Logic ---
  const parseSSEContent = (chunks: string[]) => {
    let fullText = '';
    chunks.forEach(chunk => {
      const lines = chunk.split('\n');
      lines.forEach(line => {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') return;
          try {
            const data = JSON.parse(dataStr);
            // OpenAI Format
            if (data.choices?.[0]?.delta?.content) {
              fullText += data.choices[0].delta.content;
            }
            // Anthropic Format (from user example)
            else if (data.delta?.text) {
              fullText += data.delta.text;
            }
            // Other common formats
            else if (data.content) {
              fullText += data.content;
            }
          } catch (e) {
            // Not JSON or partial JSON, skip
          }
        }
      });
    });
    return fullText;
  };
  const handleRelease = () => {
    if (!selectedId || isReleasing) return;
    
    setIsReleasing(true);
    let modifiedBody;
    try {
      modifiedBody = JSON.parse(editBody);
    } catch {
      modifiedBody = editBody;
    }

    // Small delay to show feedback
    setTimeout(() => {
      socketRef.current?.emit('release_request', { id: selectedId, modifiedBody });
      setLogs(prev => prev.map(l => l.id === selectedId ? { ...l, request_body: JSON.stringify(modifiedBody) } : l));
    }, 400);
  };

  const toggleAutoMode = () => {
    socketRef.current?.emit('toggle_auto_mode', !autoMode);
  };

  const updateUpstream = () => {
    socketRef.current?.emit('update_config', { upstreamUrl: newUpstreamUrl });
    setIsEditingUpstream(false);
  };

  const clearLogs = () => {
    socketRef.current?.emit('clear_logs');
  };

  const handleReplay = (id: string) => {
    setIsReplaying(true);
    let modifiedBody;
    try {
      modifiedBody = JSON.parse(editBody);
    } catch {
      modifiedBody = editBody;
    }
    socketRef.current?.emit('replay_request', { id, modifiedBody });
    
    // Fallback to stop loading if no request is received within 5s
    setTimeout(() => setIsReplaying(false), 5000);
  };

  const filteredLogs = logs.filter(l => {
    const matchesSearch = l.url.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         l.session_id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 border-r border-zinc-800 flex flex-col bg-zinc-900/50">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="text-emerald-500 w-5 h-5" />
            <h1 className="font-bold tracking-tight">Agent Debugger</h1>
          </div>
          <button 
            onClick={clearLogs}
            className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 transition-colors"
            title="Clear Logs"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className="p-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Filter by URL or Session..."
              className="w-full bg-zinc-800 border-none rounded-lg py-2 pl-9 pr-4 text-sm focus:ring-1 focus:ring-emerald-500 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-1 bg-zinc-800/50 p-1 rounded-lg">
            {(['all', 'pending', 'completed', 'error'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`flex-1 text-[9px] font-bold py-1 rounded uppercase transition-all ${statusFilter === f ? (f === 'error' ? 'bg-rose-600 text-white' : 'bg-zinc-700 text-emerald-400') : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {f}
              </button>
            ))}
          </div>
          {logs.length > 0 && (
            <div className="flex justify-between items-center px-1 text-[9px] text-zinc-500 uppercase font-bold tracking-wider">
              <span>Session Stats</span>
              <span className="text-emerald-500/80">{logs.reduce((acc, l) => acc + (l.tokens?.total || 0), 0)} Total Tokens</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredLogs.map((log) => (
            <div 
              key={log.id}
              onClick={() => setSelectedId(log.id)}
              className={`p-3 border-b border-zinc-800/50 cursor-pointer transition-colors hover:bg-zinc-800/50 ${selectedId === log.id ? 'bg-zinc-800 border-l-2 border-l-emerald-500' : ''}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                  log.method === 'POST' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                }`}>
                  {log.method}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-xs font-mono truncate text-zinc-300 mb-1" title={log.url}>
                {log.url}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] text-zinc-500 truncate max-w-[120px]">
                    ID: {log.session_id}
                  </span>
                  {log.tokens && log.tokens.total > 0 && (
                    <span className="text-[9px] text-emerald-500/70 font-mono">
                      {log.tokens.input}i / {log.tokens.output}o
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end">
                  {log.status === 'pending' ? (
                    <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                  ) : log.status === 'completed' ? (
                    <div className="flex flex-col items-end">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${log.status_code === 200 ? 'text-emerald-500' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>
                        {log.status_code}
                      </span>
                      {log.duration && (
                        <span className="text-[9px] text-zinc-600 font-mono mt-0.5">
                          {log.duration}ms
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-900/30">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Mode</span>
              <button 
                onClick={toggleAutoMode}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                  autoMode 
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                  : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {autoMode ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                {autoMode ? 'AUTO' : 'MANUAL'}
              </button>
            </div>
            <div className="h-4 w-px bg-zinc-800"></div>
            
            {/* Status Indicators */}
            <div className="flex items-center gap-8 font-mono text-[10px] uppercase tracking-wider">
              {/* Proxy Status */}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 font-sans font-bold">Proxy</span>
                  <span className="text-[9px] text-zinc-600 font-sans lowercase">(Agent data will come here)</span>
                  <span className={status.proxy === 'online' ? 'text-emerald-400' : 'text-rose-500'}>
                    {status.proxy === 'online' ? '● RUNNING' : '○ DISCONNECTED'}
                  </span>
                </div>
                <span className="text-[9px] text-zinc-500 lowercase leading-none truncate max-w-[200px]" title={status.proxyUrl}>
                  {status.proxyUrl}
                </span>
              </div>

              <div className="h-6 w-px bg-zinc-800"></div>

              {/* Upstream Status */}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 font-sans font-bold">Upstream</span>
                  <span className="text-[9px] text-zinc-600 font-sans lowercase">(API end point)</span>
                  <span className={status.upstream === 'online' ? 'text-emerald-400' : 'text-rose-500'}>
                    {status.upstream === 'online' ? '● ONLINE' : '○ OFFLINE'}
                  </span>
                  <button 
                    onClick={() => {
                      setNewUpstreamUrl(status.upstreamUrl);
                      setIsEditingUpstream(!isEditingUpstream);
                    }}
                    className="p-1 hover:bg-zinc-800 rounded text-zinc-500 transition-colors"
                  >
                    <Settings size={12} />
                  </button>
                </div>
                {isEditingUpstream ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input 
                      type="text" 
                      value={newUpstreamUrl}
                      onChange={(e) => setNewUpstreamUrl(e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[9px] text-zinc-200 focus:outline-none focus:border-emerald-500 w-40"
                      placeholder="http://..."
                    />
                    <button 
                      onClick={updateUpstream}
                      className="bg-emerald-500 text-white px-2 py-0.5 rounded text-[8px] font-bold"
                    >
                      SAVE
                    </button>
                  </div>
                ) : (
                  <span className="text-[9px] text-zinc-500 lowercase leading-none truncate max-w-[200px]" title={status.upstreamUrl}>
                    {status.upstreamUrl}
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex bg-zinc-800 p-1 rounded-lg">
              <button 
                onClick={() => setViewMode('json')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${viewMode === 'json' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                JSON
              </button>
              <button 
                onClick={() => setViewMode('markdown')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${viewMode === 'markdown' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Markdown
              </button>
            </div>
          </div>
        </div>

        {/* Usage Guide */}
        <div className="px-6 py-3 bg-emerald-500/5 border-b border-zinc-800">
          <div className="flex items-center gap-4 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-emerald-500 font-bold uppercase tracking-widest text-[9px]">Usage Guide</span>
              <div className="h-3 w-px bg-zinc-800"></div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">1. Set Agent base_url:</span>
              <code className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 text-emerald-400 select-all">
                {status.proxyUrl}
              </code>
            </div>
            <div className="h-3 w-px bg-zinc-800"></div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">2. Path Mapping:</span>
              <span className="text-zinc-400 font-mono text-[10px]">/v1/chat</span>
              <span className="text-zinc-600">→</span>
              <span className="text-zinc-400 font-mono text-[10px] truncate max-w-[200px]">{status.upstreamUrl}/v1/chat</span>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {selectedLog ? (
            <div className="max-w-5xl mx-auto space-y-8">
              {/* Header Info */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-lg font-bold flex items-center gap-2">
                      <Terminal size={20} className="text-emerald-500" />
                      Request Details
                    </h2>
                    <p className="text-zinc-500 text-[10px] mt-1 font-mono">
                      <span className="text-zinc-600 mr-1">Trace ID:</span>
                      {selectedLog.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {selectedLog.status !== 'pending' && (
                      <button 
                        onClick={() => handleReplay(selectedLog.id)}
                        disabled={isReplaying}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all border ${
                          isReplaying 
                            ? 'bg-zinc-800 text-zinc-500 border-zinc-700 cursor-not-allowed' 
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700 active:scale-95'
                        }`}
                        title="Replay this request"
                      >
                        {isReplaying ? (
                          <div className="h-3 w-3 border-2 border-zinc-500 border-t-zinc-300 rounded-full animate-spin" />
                        ) : (
                          <Play size={14} />
                        )}
                        {isReplaying ? 'REPLAYING...' : 'REPLAY'}
                      </button>
                    )}
                    {selectedLog.status === 'pending' && (
                    <button 
                      onClick={handleRelease}
                      disabled={isReleasing}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all shadow-lg ${
                        isReleasing 
                          ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' 
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
                      }`}
                    >
                      {isReleasing ? (
                        <div className="h-4 w-4 border-2 border-zinc-500 border-t-zinc-300 rounded-full animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}
                      {isReleasing ? 'RELEASING...' : 'RELEASE REQUEST'}
                    </button>
                  )}
                </div>
              </div>
                
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                  <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 col-span-2">
                    <span className="text-[10px] text-zinc-500 uppercase block mb-1">Method & URL</span>
                    <div className="text-sm font-mono truncate">
                      <span className="text-blue-400 font-bold mr-2">{selectedLog.method}</span>
                      {selectedLog.url}
                    </div>
                  </div>
                  <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase block mb-1">Status & Latency</span>
                    <div className="text-sm font-mono flex items-center gap-2">
                      {selectedLog.status === 'pending' ? (
                        <span className="text-amber-500">Waiting...</span>
                      ) : (
                        <>
                          <span className={`${selectedLog.status_code === 200 ? 'text-emerald-500' : 'text-rose-500'} font-bold`}>
                            {selectedLog.status_code}
                          </span>
                          {selectedLog.duration && (
                            <div className="flex items-center gap-1 text-zinc-500 text-xs bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                              <Clock size={10} />
                              <span>{selectedLog.duration}ms</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase block mb-1">Token Usage</span>
                    <div className="text-xs font-mono">
                      {selectedLog.tokens && selectedLog.tokens.total > 0 ? (
                        <div className="space-y-1">
                          <div className="flex justify-between gap-4">
                            <span className="text-zinc-500">In:</span>
                            <span className="text-emerald-400 font-bold">{selectedLog.tokens.input}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-zinc-500">Out:</span>
                            <span className="text-emerald-400 font-bold">{selectedLog.tokens.output}</span>
                          </div>
                          {(selectedLog.tokens.cache_read || selectedLog.tokens.cache_creation) ? (
                            <div className="pt-1 border-t border-zinc-800 mt-1 flex flex-col gap-0.5">
                              {selectedLog.tokens.cache_read ? (
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-blue-400/70">Cache Hit:</span>
                                  <span className="text-blue-400">{selectedLog.tokens.cache_read}</span>
                                </div>
                              ) : null}
                              {selectedLog.tokens.cache_creation ? (
                                <div className="flex justify-between text-[9px]">
                                  <span className="text-amber-400/70">Cache New:</span>
                                  <span className="text-amber-400">{selectedLog.tokens.cache_creation}</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-600">N/A</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Request / Response Split */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left: Request */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-2 text-zinc-400">
                      <ChevronRight size={16} />
                      UPSTREAM REQUEST
                    </h3>
                    <div className="flex items-center gap-2">
                      {selectedLog.status !== 'pending' && (
                        <span className="text-[10px] text-amber-500/80 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          Editable for Replay
                        </span>
                      )}
                      <CopyButton text={editBody || selectedLog.request_body} />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="text-[10px] text-zinc-500 uppercase flex justify-between">
                      <span>{selectedLog.status === 'pending' ? 'Edit Payload' : 'Modify for Replay'}</span>
                      {selectedLog.status === 'pending' && <span className="text-amber-500">Intercepted</span>}
                    </div>
                    <div className="relative group">
                      <textarea 
                        className={`w-full h-96 bg-zinc-950 border rounded-lg p-4 font-mono text-sm focus:ring-1 transition-all outline-none custom-scrollbar resize-none ${
                          selectedLog.status === 'pending' 
                            ? 'border-amber-500/30 focus:ring-amber-500 text-emerald-400' 
                            : 'border-zinc-800 focus:ring-emerald-500 text-zinc-300'
                        }`}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        spellCheck={false}
                      />
                      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[10px] bg-zinc-900 text-zinc-500 px-2 py-1 rounded border border-zinc-800">
                          JSON Editor
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Response */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-2 text-zinc-400">
                      <ChevronDown size={16} />
                      DOWNSTREAM RESPONSE
                    </h3>
                    <div className="flex items-center gap-3">
                      {selectedLog.is_sse && (
                        <div className="flex bg-zinc-800 p-0.5 rounded-md border border-zinc-700">
                          <button 
                            onClick={() => setSseViewMode('parsed')}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${sseViewMode === 'parsed' ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >
                            PARSED
                          </button>
                          <button 
                            onClick={() => setSseViewMode('raw')}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${sseViewMode === 'raw' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >
                            RAW
                          </button>
                        </div>
                      )}
                      <CopyButton text={selectedLog.is_sse ? (selectedLog.sse_chunks?.join('') || '') : (selectedLog.response_body || '')} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    {selectedLog.is_sse ? (
                      <div className="space-y-4">
                        {sseViewMode === 'raw' ? (
                          <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 font-mono text-xs overflow-auto max-h-[500px] custom-scrollbar">
                            {selectedLog.sse_chunks?.map((chunk, i) => (
                              <div key={i} className="mb-1 text-zinc-400 border-b border-zinc-800 pb-1">
                                {chunk}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {viewMode === 'json' ? (
                              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 font-mono text-xs overflow-auto max-h-[500px] custom-scrollbar">
                                <div className="text-zinc-500 mb-2 italic text-[10px] flex justify-between items-center">
                                  <span>Parsed SSE Content (Text Aggregation)</span>
                                  <span className="text-emerald-500 animate-pulse">Streaming...</span>
                                </div>
                                <div className="text-emerald-400 whitespace-pre-wrap leading-relaxed">
                                  {parseSSEContent(selectedLog.sse_chunks || []) || 'Waiting for stream content...'}
                                </div>
                              </div>
                            ) : (
                              <MarkdownView content={parseSSEContent(selectedLog.sse_chunks || []) || 'Waiting for stream...'} />
                            )}
                          </div>
                        )}
                      </div>
                    ) : selectedLog.response_body ? (
                      viewMode === 'json' ? (
                        <JsonView data={(() => {
                          try { return JSON.parse(selectedLog.response_body!); }
                          catch { return { raw: selectedLog.response_body }; }
                        })()} />
                      ) : (
                        <MarkdownView content={selectedLog.response_body!} />
                      )
                    ) : (
                      <div className="h-64 flex flex-col items-center justify-center bg-zinc-900/50 border border-dashed border-zinc-800 rounded-xl text-zinc-600">
                        <Clock className="mb-2 opacity-20" size={32} />
                        <p className="text-sm">Waiting for response...</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-zinc-700">
              <div className="relative mb-6">
                <Activity size={80} className="opacity-10" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <MessageSquare size={32} className="opacity-20" />
                </div>
              </div>
              <h3 className="text-xl font-bold text-zinc-500">No Request Selected</h3>
              <p className="text-sm mt-2 max-w-xs text-center opacity-50">
                Select a request from the sidebar to inspect payloads, modify data, and debug your LLM agent.
              </p>
            </div>
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}} />
    </div>
  );
}
