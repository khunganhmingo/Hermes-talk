import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Keyboard,
  Mic,
  MicOff,
  Plug,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { McpDrawer, type GeminiConnectionState } from './components/McpDrawer';
import { WaveformCanvas } from './components/WaveformCanvas';
import { useGeminiLive } from './hooks/useGeminiLive';
import { auth, googleProvider, verifyFirestoreConnection } from './lib/firebase';
import type {
  ChatMessage,
  ConversationSession,
  McpConfig,
  McpLogEntry,
  McpToolDefinition,
} from './types';

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const SESSIONS_STORAGE_KEY = 'gemini_live_hermes_sessions_v1';

const DEFAULT_CONFIG: McpConfig = {
  endpoint: '',
  token: '',
  mode: 'auto',
  voiceName: 'Kore',
  speakTextReplies: true,
};

const QUICK_PROMPTS = [
  'Kiểm tra trạng thái hệ thống Hermes',
  'Tìm trong bộ nhớ lịch trình hôm nay',
  'Lưu ghi chú: Demo Gemini Live lúc 15:00',
];

function formatSessionDate() {
  return new Date().toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: `welcome-${Date.now()}`,
    role: 'gemini',
    text: 'Xin chào! Gemini Live đã kết nối với toàn bộ công cụ Hermes MCP. Nhấn nút Micro để nói trực tiếp hoặc gõ tin nhắn bên dưới.',
    timestamp: formatSessionDate(),
  };
}

function deriveSessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.text.trim());
  if (!firstUser) return 'Cuộc trò chuyện mới';
  const clean = firstUser.text.trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

function loadSavedSessions(): ConversationSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ConversationSession[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Ignore storage read errors
  }
  return [];
}

export default function App() {
  const [mcpConfig, setMcpConfig] = useState<McpConfig>(DEFAULT_CONFIG);
  const [tools, setTools] = useState<McpToolDefinition[]>([]);
  const [connectedMode, setConnectedMode] = useState<'remote' | 'local-bridge'>('local-bridge');
  const [activeEndpoint, setActiveEndpoint] = useState<string>('/api/hermes/mcp');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [isPinging, setIsPinging] = useState<boolean>(false);
  const [pingError, setPingError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [geminiStatus, setGeminiStatus] = useState<GeminiConnectionState>({
    configured: false,
    connected: false,
    models: [
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
      'gemini-3.8-live',
      'gemini-3.8-flash-lite-tts',
    ],
    message: 'Đang kiểm tra cấu hình Gemini API...',
    checking: false,
  });

  const [sessions, setSessions] = useState<ConversationSession[]>(() => {
    const saved = loadSavedSessions();
    if (saved.length > 0) return saved;
    return [
      {
        id: `session-${Date.now()}`,
        title: 'Cuộc trò chuyện mới',
        updatedAt: formatSessionDate(),
        messages: [createWelcomeMessage()],
      },
    ];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const saved = loadSavedSessions();
    return saved[0]?.id ?? '';
  });

  const [showTextInput, setShowTextInput] = useState<boolean>(false);
  const [textDraft, setTextDraft] = useState<string>('');
  const [isDictating, setIsDictating] = useState<boolean>(false);
  const [expandedCalls, setExpandedCalls] = useState<Record<string, boolean>>({});

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const hydratedRef = useRef<boolean>(false);

  const appendLogs = useCallback((_newEntries: McpLogEntry[]) => {
    // Log viewer removed per UI preference
  }, []);

  const pingHermes = useCallback(
    async (overrideConfig?: McpConfig) => {
      const cfg = overrideConfig ?? mcpConfig;
      setIsPinging(true);
      setPingError(null);
      try {
        const res = await fetch('/api/hermes/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: cfg.endpoint,
            token: cfg.token,
            mode: cfg.mode,
          }),
        });
        const data = (await res.json()) as {
          connectedMode: 'remote' | 'local-bridge';
          endpointUsed: string;
          tools: McpToolDefinition[];
          logs: McpLogEntry[];
          error?: string;
        };

        if (data.logs) {
          appendLogs(data.logs);
        }
        if (data.error) {
          setPingError(data.error);
        }
        if (Array.isArray(data.tools) && data.tools.length > 0) {
          setTools(data.tools.map((t) => ({ ...t, enabled: true })));
        }
        if (data.connectedMode) setConnectedMode(data.connectedMode);
        if (data.endpointUsed) setActiveEndpoint(data.endpointUsed);
      } catch (err) {
        setPingError(err instanceof Error ? err.message : 'Lỗi kết nối Hermes MCP');
      } finally {
        setIsPinging(false);
      }
    },
    [appendLogs, mcpConfig]
  );

  const checkGeminiStatus = useCallback(async (verify = false, model?: string) => {
    setGeminiStatus((prev) => ({ ...prev, checking: true }));
    try {
      const url = verify
        ? `/api/gemini/status?verify=true${model ? `&model=${encodeURIComponent(model)}` : ''}`
        : '/api/gemini/status';
      const res = await fetch(url);
      const data = (await res.json()) as {
        configured?: boolean;
        connected?: boolean;
        models?: string[];
        message?: string;
      };
      setGeminiStatus((prev) => ({
        configured: Boolean(data.configured),
        connected: Boolean(data.connected),
        models: Array.isArray(data.models) && data.models.length > 0 ? data.models : prev.models,
        message: data.message || 'Không rõ trạng thái kết nối Gemini API.',
        checking: false,
      }));
    } catch (err) {
      setGeminiStatus((prev) => ({
        ...prev,
        configured: false,
        connected: false,
        message: err instanceof Error ? err.message : 'Lỗi kiểm tra kết nối Gemini API.',
        checking: false,
      }));
    }
  }, []);

  const handleSignInGoogle = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('Đã hủy cửa sổ đăng nhập Google.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Trình duyệt đã chặn cửa sổ bật lên. Vui lòng cho phép popup để đăng nhập.');
      } else {
        setAuthError(err instanceof Error ? err.message : 'Đăng nhập Google thất bại.');
      }
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signOut(auth);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Đăng xuất thất bại.');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    pingHermes(DEFAULT_CONFIG);
    checkGeminiStatus(false);
    verifyFirestoreConnection();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    status,
    statusLabel,
    isLiveActive,
    isSpeakerMuted,
    setIsSpeakerMuted,
    errorMessage,
    setErrorMessage,
    interimUserText,
    messages,
    audioLevelRef,
    toggleLiveSession,
    sendTextMessage,
    playGeminiTts,
    replaceMessages,
  } = useGeminiLive({
    mcpConfig,
    tools,
    onMcpLogs: appendLogs,
  });

  // Hydrate initial session messages on first mount
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const currentId = activeSessionId || sessions[0]?.id;
    if (currentId) {
      setActiveSessionId(currentId);
      const found = sessions.find((s) => s.id === currentId);
      if (found && found.messages.length > 0) {
        replaceMessages(found.messages);
      }
    }
  }, [activeSessionId, replaceMessages, sessions]);

  // Keep active session synced with live messages & persist to localStorage
  useEffect(() => {
    if (!activeSessionId || !hydratedRef.current) return;
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              title: deriveSessionTitle(messages),
              updatedAt: formatSessionDate(),
              messages,
            }
          : s
      );
      try {
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(next.slice(0, 25)));
      } catch {
        // Ignore quota errors
      }
      return next;
    });
  }, [activeSessionId, messages]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, interimUserText]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const target = sessions.find((s) => s.id === sessionId);
      if (!target) return;
      setActiveSessionId(sessionId);
      replaceMessages(target.messages);
    },
    [replaceMessages, sessions]
  );

  const handleNewSession = useCallback(() => {
    const welcome = createWelcomeMessage();
    const newSession: ConversationSession = {
      id: `session-${Date.now()}`,
      title: 'Cuộc trò chuyện mới',
      updatedAt: formatSessionDate(),
      messages: [welcome],
    };
    setSessions((prev) => {
      const next = [newSession, ...prev].slice(0, 25);
      try {
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
    setActiveSessionId(newSession.id);
    replaceMessages([welcome]);
  }, [replaceMessages]);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== sessionId);
        if (remaining.length === 0) {
          const fresh: ConversationSession = {
            id: `session-${Date.now()}`,
            title: 'Cuộc trò chuyện mới',
            updatedAt: formatSessionDate(),
            messages: [createWelcomeMessage()],
          };
          setActiveSessionId(fresh.id);
          replaceMessages(fresh.messages);
          try {
            localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify([fresh]));
          } catch {
            // Ignore
          }
          return [fresh];
        }

        if (sessionId === activeSessionId) {
          setActiveSessionId(remaining[0].id);
          replaceMessages(remaining[0].messages);
        }
        try {
          localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(remaining));
        } catch {
          // Ignore
        }
        return remaining;
      });
    },
    [activeSessionId, replaceMessages]
  );

  const toggleExpandedCall = useCallback((key: string) => {
    setExpandedCalls((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleSubmitText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textDraft.trim()) return;
    const msg = textDraft;
    setTextDraft('');
    sendTextMessage(msg);
  };

  const toggleQuickDictation = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setErrorMessage('Trình duyệt không hỗ trợ nhận diện giọng nói trực tiếp cho ô nhập liệu.');
      return;
    }

    if (isDictating && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsDictating(false);
      return;
    }

    const rec = new SpeechRec();
    rec.lang = 'vi-VN';
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let fullText = '';
      let hasFinal = false;
      for (let i = 0; i < event.results.length; i++) {
        fullText += event.results[i][0].transcript;
        if (event.results[i].isFinal) hasFinal = true;
      }
      setTextDraft(fullText);
      if (hasFinal && fullText.trim()) {
        setIsDictating(false);
        setTextDraft('');
        sendTextMessage(fullText.trim());
      }
    };
    rec.onerror = () => setIsDictating(false);
    rec.onend = () => setIsDictating(false);

    recognitionRef.current = rec;
    setIsDictating(true);
    rec.start();
  };

  const geminiActive = status === 'speaking' || status === 'thinking';

  return (
    <div className="relative h-dvh w-full bg-[#07090F] text-slate-100 flex flex-col lg:flex-row overflow-hidden">
      {/* Subtle Ambient Glow */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(circle at 25% 18%, rgba(56, 189, 248, 0.08) 0%, transparent 45%), radial-gradient(circle at 75% 75%, rgba(168, 85, 247, 0.09) 0%, transparent 50%)',
        }}
      />

      {/* Main Gemini Live Conversational Stage */}
      <div className="relative z-10 flex-1 flex flex-col h-full min-w-0 max-w-3xl w-full mx-auto">
        {/* Top Header */}
        <header className="flex items-center justify-between gap-4 px-5 sm:px-8 pt-5 pb-2 shrink-0">
          {/* Connection Status Readout (Left) */}
          <div
            className="flex items-center gap-2 text-xs font-medium text-slate-300 min-w-0"
            title={
              pingError ||
              geminiStatus.message ||
              (connectedMode === 'remote' ? 'Hermes MCP Remote' : 'Local Hermes Core')
            }
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                geminiStatus.checking || isPinging
                  ? 'bg-amber-400 animate-pulse'
                  : pingError || !geminiStatus.connected
                    ? 'bg-rose-400'
                    : isLiveActive
                      ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                      : 'bg-emerald-400'
              }`}
              aria-hidden="true"
            />
            <span className="truncate">
              {geminiStatus.checking || isPinging
                ? 'Đang kiểm tra kết nối...'
                : !geminiStatus.connected
                  ? 'Chưa kết nối Gemini'
                  : pingError
                    ? 'Lỗi kết nối Hermes MCP'
                    : isLiveActive
                      ? 'Đã kết nối · Gemini Live'
                      : connectedMode === 'remote'
                        ? 'Đã kết nối · Hermes Remote'
                        : 'Đã kết nối · Gemini & Hermes'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plug className="w-4 h-4 text-sky-400" />
            <span>Kết nối</span>
          </button>
        </header>

        {/* Centerpiece Audio Waveform */}
        <WaveformCanvas status={status} audioLevelRef={audioLevelRef} />

        {/* Error Notification Banner */}
        {errorMessage && (
          <div className="mx-5 sm:mx-8 mb-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-3 shrink-0">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-300 hover:text-white font-medium shrink-0 cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Live Transcript Feed */}
        <main className="transcript-scroll flex-1 overflow-y-auto px-5 sm:px-8 py-2 space-y-3.5">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[78%] px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-white/[0.06] border border-white/10 text-slate-100 rounded-2xl rounded-tr-sm'
                    : 'bg-indigo-500/[0.11] border border-purple-400/20 text-slate-100 rounded-2xl rounded-tl-sm'
                }`}
              >
                {/* Hermes MCP Tool Invocations */}
                {msg.mcpCalls && msg.mcpCalls.length > 0 && (
                  <div className="mb-2.5 space-y-1.5">
                    {msg.mcpCalls.map((call, idx) => {
                      const key = `${msg.id}-${idx}`;
                      const isExpanded = Boolean(expandedCalls[key]);
                      return (
                        <div key={key}>
                          <button
                            type="button"
                            onClick={() => toggleExpandedCall(key)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-[11px] font-mono text-sky-300 transition-colors cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            <span>{call.uri}</span>
                          </button>
                          {isExpanded && (
                            <pre className="mt-1.5 p-2.5 rounded-lg bg-black/50 border border-white/10 font-mono text-[10.5px] text-slate-300 overflow-x-auto">
                              {JSON.stringify(
                                {
                                  tool: call.toolName,
                                  mode: call.mode,
                                  args: call.args,
                                  result: call.result,
                                },
                                null,
                                2
                              )}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
              </div>
              <div className="mt-1 px-1 flex items-center gap-2 text-[11px] text-slate-500 tabular-nums">
                <span>
                  {msg.role === 'user' ? 'Bạn' : 'Gemini'} · {msg.timestamp}
                  {msg.isInterim ? ' · Đang nhận diện' : ''}
                </span>
                {msg.role === 'gemini' && !msg.isInterim && (
                  <button
                    type="button"
                    onClick={() => playGeminiTts(msg.text)}
                    title="Nghe lại bằng giọng Google Gemini"
                    aria-label="Nghe lại câu trả lời bằng giọng Google Gemini"
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-sky-300 transition-colors cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Nghe</span>
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Quick Starter Prompts on Fresh Session */}
          {messages.length <= 1 && (
            <div className="pt-2 flex flex-wrap gap-2 justify-end">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendTextMessage(prompt)}
                  className="px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer text-left"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          <div ref={transcriptEndRef} />
        </main>

        {/* Live Interim Speech Caption */}
        {interimUserText && (
          <div className="px-5 sm:px-8 py-1.5 text-center shrink-0">
            <p className="text-xs text-sky-300/90 italic truncate">
              “{interimUserText}”
            </p>
          </div>
        )}

        {/* Optional Keyboard Text Input Bar */}
        {showTextInput && (
          <form onSubmit={handleSubmitText} className="px-5 sm:px-8 pt-2 pb-1 shrink-0">
            <div className="flex items-center gap-2 bg-white/[0.06] border border-white/15 rounded-full px-3.5 py-1.5 focus-within:border-sky-400/60 transition-colors">
              <input
                type="text"
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="Nhập tin nhắn hoặc lệnh Hermes MCP..."
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none py-1.5"
                autoFocus
              />
              <button
                type="button"
                onClick={toggleQuickDictation}
                title="Đọc nhanh vào ô văn bản"
                className={`min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isDictating
                    ? 'bg-rose-500/25 text-rose-300'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                aria-label="Nhận diện giọng nói vào ô nhập"
              >
                <Mic className="w-4 h-4" />
              </button>
              <button
                type="submit"
                disabled={!textDraft.trim()}
                className="min-w-[40px] min-h-[40px] rounded-full bg-gradient-to-r from-sky-500 to-purple-500 text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
                aria-label="Gửi tin nhắn"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* Bottom Ergonomic Control Dock */}
        <footer className="px-6 pt-3 pb-6 shrink-0 flex items-center justify-center gap-5 sm:gap-6">
          <button
            type="button"
            onClick={() => setShowTextInput((prev) => !prev)}
            title={showTextInput ? 'Ẩn bàn phím' : 'Mở bàn phím'}
            aria-label="Chuyển đổi nhập văn bản"
            className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
              showTextInput
                ? 'bg-white/15 border-white/25 text-white'
                : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/10 text-slate-300'
            }`}
          >
            <Keyboard className="w-5 h-5" />
          </button>

          {/* Central Gemini Live Microphone Button */}
          <button
            type="button"
            onClick={toggleLiveSession}
            title={isLiveActive ? 'Tạm dừng trò chuyện trực tiếp' : 'Bắt đầu trò chuyện Gemini Live'}
            aria-label={isLiveActive ? 'Tắt micro Gemini Live' : 'Bật micro Gemini Live'}
            className={`w-16 h-16 rounded-full border flex items-center justify-center transition-all duration-300 cursor-pointer ${
              isLiveActive
                ? 'bg-gradient-to-br from-sky-500/30 to-purple-500/35 border-sky-400/70 text-white shadow-[0_0_28px_rgba(56,189,248,0.45)] scale-105'
                : 'bg-white/[0.08] hover:bg-white/[0.14] border-white/20 text-slate-100 shadow-lg'
            }`}
          >
            {isLiveActive ? (
              <MicOff className="w-6 h-6 text-rose-300" />
            ) : (
              <Mic className="w-6 h-6" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsSpeakerMuted((prev) => !prev)}
            title={isSpeakerMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            aria-label={isSpeakerMuted ? 'Bật loa phản hồi' : 'Tắt loa phản hồi'}
            className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
              isSpeakerMuted
                ? 'bg-rose-500/15 border-rose-400/40 text-rose-300'
                : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/10 text-slate-300'
            }`}
          >
            {isSpeakerMuted ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>
        </footer>
      </div>

      {/* Hermes MCP Bridge, Auth & Conversation History Drawer */}
      <McpDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        user={user}
        authLoading={authLoading}
        authError={authError}
        onSignInGoogle={handleSignInGoogle}
        onSignOut={handleSignOut}
        geminiStatus={geminiStatus}
        onCheckGemini={(model) => checkGeminiStatus(true, model)}
        config={mcpConfig}
        onConfigChange={setMcpConfig}
        onPreviewVoice={async () => {
          if (isSpeakerMuted) {
            setIsSpeakerMuted(false);
          }
          return playGeminiTts('Xin chào, đây là giọng nói tiếng Việt của Google Gemini.', {
            voiceName: mcpConfig.voiceName,
            forcePlay: true,
            fallbackToBrowserSpeech: true,
          });
        }}
        connectedMode={connectedMode}
        activeEndpoint={activeEndpoint}
        isPinging={isPinging}
        pingError={pingError}
        onPing={() => pingHermes()}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => {
          handleSelectSession(id);
          if (window.innerWidth < 1024) setIsDrawerOpen(false);
        }}
        onNewSession={() => {
          handleNewSession();
          if (window.innerWidth < 1024) setIsDrawerOpen(false);
        }}
        onDeleteSession={handleDeleteSession}
      />
    </div>
  );
}
