import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Keyboard,
  Lock,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  Mic,
  Plug,
  Shield,
  Sparkles,
  User as UserIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { AdminDashboard } from './components/AdminDashboard';
import { Hermes3DCharacterCanvas } from './components/Hermes3DCharacterCanvas';
import { HistorySheet } from './components/HistorySheet';
import { McpDrawer, type GeminiConnectionState } from './components/McpDrawer';
import { ReactiveMicButton } from './components/ReactiveMicButton';
import { UserProfileModal } from './components/UserProfileModal';
import { useGeminiLive } from './hooks/useGeminiLive';
import {
  autoLockExpiredAccount,
  recordActivityLog,
  subscribeActivityLogs,
  subscribeAllUsers,
  subscribeUserAccount,
  syncUserAccountOnLogin,
} from './lib/accountService';
import { auth, googleProvider, verifyFirestoreConnection } from './lib/firebase';
import { evaluateAccountAccess, hasPermission } from './lib/rbac';
import type {
  ActivityLog,
  ChatMessage,
  ConversationSession,
  McpConfig,
  McpLogEntry,
  McpToolDefinition,
  UserAccount,
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
    text: 'Xin chào! Cuộc trò chuyện đang kết nối trực tiếp tới Hermes MCP. Gemini sẽ dịch và đọc lại câu trả lời từ Hermes cho bạn.',
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
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<'app' | 'admin'>('app');
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [allAccounts, setAllAccounts] = useState<UserAccount[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [adminDataError, setAdminDataError] = useState<string | null>(null);

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
  const [clockTick, setClockTick] = useState<number>(() => Date.now());
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isTranscriptVisible, setIsTranscriptVisible] = useState<boolean>(true);

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
      if (account) {
        await recordActivityLog({
          actorUid: account.id,
          actorEmail: account.email,
          actorRole: account.role,
          action: 'logout',
          targetId: account.id,
          targetLabel: account.displayName,
          detail: 'Người dùng đăng xuất khỏi hệ thống.',
        }).catch(() => {});
      }
      await signOut(auth);
      setActiveView('app');
      setIsProfileOpen(false);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Đăng xuất thất bại.');
    } finally {
      setAuthLoading(false);
    }
  }, [account]);

  // Initial connections & Firebase Auth subscription
  useEffect(() => {
    pingHermes(DEFAULT_CONFIG);
    checkGeminiStatus(false);
    verifyFirestoreConnection();

    let unsubAccountDoc: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (unsubAccountDoc) {
        unsubAccountDoc();
        unsubAccountDoc = null;
      }

      if (!currentUser) {
        setAccount(null);
        setAllAccounts([]);
        setActivityLogs([]);
        setAdminDataError(null);
        setAccountLoading(false);
        setActiveView('app');
        return;
      }

      setAccountLoading(true);
      setAuthError(null);
      try {
        const synced = await syncUserAccountOnLogin(currentUser);
        setAccount(synced);
        if (synced.role === 'admin') {
          setActiveView((prev) => (prev === 'admin' ? 'admin' : 'app'));
        } else {
          setActiveView('app');
        }
        unsubAccountDoc = subscribeUserAccount(
          currentUser.uid,
          (liveAccount) => {
            if (liveAccount) {
              setAccount(liveAccount);
              if (liveAccount.role !== 'admin') {
                setActiveView('app');
              }
            }
          },
          (err) => {
            setAuthError(err.message);
          }
        );
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Không thể đồng bộ hồ sơ tài khoản.');
      } finally {
        setAccountLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubAccountDoc) unsubAccountDoc();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to Admin collections or User personal logs
  useEffect(() => {
    if (!account) {
      setAllAccounts([]);
      setActivityLogs([]);
      return;
    }

    setAdminDataError(null);
    const isAdmin = account.role === 'admin';
    const unsubLogs = subscribeActivityLogs(
      isAdmin,
      account.id,
      (logs) => setActivityLogs(logs),
      (err) => setAdminDataError(err.message)
    );

    if (!isAdmin) {
      setAllAccounts([]);
      return () => unsubLogs();
    }

    const unsubUsers = subscribeAllUsers(
      (list) => setAllAccounts(list),
      (err) => setAdminDataError(err.message)
    );

    return () => {
      unsubLogs();
      unsubUsers();
    };
  }, [account?.id, account?.role]);

  // Periodic expiration check & automatic locking
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const access = useMemo(
    () => (account ? evaluateAccountAccess(account, clockTick) : null),
    [account, clockTick]
  );

  useEffect(() => {
    if (account && account.status === 'active' && access?.isExpired) {
      autoLockExpiredAccount(account).catch(() => {});
    }
  }, [account, access?.isExpired]);

  const canUseVoiceLive = hasPermission(account, 'voice_live', clockTick);
  const canUseTextChat = hasPermission(account, 'text_chat', clockTick);
  const canUseHermes = hasPermission(account, 'hermes_mcp', clockTick);
  const canPreviewTts = hasPermission(account, 'tts_preview', clockTick);

  const effectiveMcpConfig = useMemo<McpConfig>(
    () => ({
      ...mcpConfig,
      speakTextReplies: canPreviewTts ? mcpConfig.speakTextReplies : false,
    }),
    [canPreviewTts, mcpConfig]
  );

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
    mcpConfig: effectiveMcpConfig,
    tools: canUseHermes ? tools : [],
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
    if (isTranscriptVisible) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isTranscriptVisible, messages, interimUserText]);

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

  const guardUserAction = useCallback(
    (permission: 'voice_live' | 'text_chat' | 'tts_preview'): boolean => {
      if (!user || !account) {
        setErrorMessage('Vui lòng bấm "Đăng nhập" ở góc phải để xác thực tài khoản trước khi sử dụng.');
        return false;
      }
      if (!access?.canUseApp) {
        setErrorMessage(
          access?.reason || 'Tài khoản hiện đang bị khóa hoặc hết hạn sử dụng.'
        );
        return false;
      }
      if (!hasPermission(account, permission, clockTick)) {
        setErrorMessage('Tài khoản của bạn chưa được Admin cấp quyền sử dụng chức năng này.');
        return false;
      }
      if (
        (permission === 'voice_live' || permission === 'text_chat') &&
        !hasPermission(account, 'hermes_mcp', clockTick)
      ) {
        setErrorMessage(
          'Cuộc trò chuyện kết nối trực tiếp tới Hermes MCP. Tài khoản của bạn cần được cấp quyền "Hermes MCP Tools".'
        );
        return false;
      }
      return true;
    },
    [access, account, clockTick, setErrorMessage, user]
  );

  const handleGuardedToggleLive = useCallback(() => {
    if (!isLiveActive && !guardUserAction('voice_live')) return;
    if (!isLiveActive && account) {
      recordActivityLog({
        actorUid: account.id,
        actorEmail: account.email,
        actorRole: account.role,
        action: 'use_voice_live',
        targetId: account.id,
        targetLabel: account.displayName,
        detail: 'Khởi động phiên thoại thời gian thực Gemini Live.',
      }).catch(() => {});
    }
    toggleLiveSession();
  }, [account, guardUserAction, isLiveActive, toggleLiveSession]);

  const handleGuardedSendText = useCallback(
    (msg: string) => {
      if (!guardUserAction('text_chat')) return;
      if (account) {
        recordActivityLog({
          actorUid: account.id,
          actorEmail: account.email,
          actorRole: account.role,
          action: 'use_text_chat',
          targetId: account.id,
          targetLabel: account.displayName,
          detail: `Gửi tin nhắn văn bản (${msg.trim().slice(0, 60)}).`,
        }).catch(() => {});
      }
      sendTextMessage(msg);
    },
    [account, guardUserAction, sendTextMessage]
  );

  const handleSubmitText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textDraft.trim()) return;
    const msg = textDraft;
    setTextDraft('');
    handleGuardedSendText(msg);
  };

  const toggleQuickDictation = () => {
    if (!guardUserAction('text_chat')) return;
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
        handleGuardedSendText(fullText.trim());
      }
    };
    rec.onerror = () => setIsDictating(false);
    rec.onend = () => setIsDictating(false);

    recognitionRef.current = rec;
    setIsDictating(true);
    rec.start();
  };

  const isAdminView = account?.role === 'admin' && activeView === 'admin';
  const personalLogs = useMemo(
    () => (account ? activityLogs.filter((l) => l.actorUid === account.id) : []),
    [account, activityLogs]
  );

  return (
    <div className="h-dvh w-full bg-[#03050A] flex items-center justify-center overflow-hidden">
      {/* Locked Vertical Portrait Phone Frame */}
      <div className="relative h-dvh w-full max-w-[430px] mx-auto bg-[#07090F] text-slate-100 flex flex-col overflow-hidden sm:border-x sm:border-white/10 sm:shadow-[0_0_90px_rgba(0,0,0,0.95)]">
        {/* Interactive Three.js 3D AI Assistant Character Replacing Static Image Backdrop */}
        <Hermes3DCharacterCanvas
          status={status}
          audioLevelRef={audioLevelRef}
          isAdminView={isAdminView}
        />

        {/* Main Content Stage (pointer-events-none lets user rotate/tap 3D character in open area) */}
        <div className="pointer-events-none relative z-10 flex-1 flex flex-col h-full min-w-0 w-full">
          {/* Minimal Mobile Top Bar: Connection Status (Left) · 3-Line Menu (Right) */}
          <header className="pointer-events-auto relative flex items-center justify-between gap-3 px-4 pt-4 pb-2 shrink-0">
            <div
              className="flex items-center gap-2 text-xs font-medium text-slate-200 min-w-0"
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
                  ? 'Đang kiểm tra...'
                  : !geminiStatus.connected
                    ? 'Chưa kết nối Gemini'
                    : pingError
                      ? 'Lỗi Hermes MCP'
                      : isLiveActive
                        ? 'Đã kết nối · Gemini Live'
                        : connectedMode === 'remote'
                          ? 'Đã kết nối · Hermes Remote'
                          : 'Đã kết nối · Gemini & Hermes'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              aria-expanded={isMenuOpen}
              aria-label="Mở menu tùy chọn"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-[#0D111A]/90 hover:bg-[#151C2C] border border-white/15 text-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </header>

          {/* 3-Line Hamburger Dropdown Menu */}
          {isMenuOpen && (
            <>
              <div
                className="pointer-events-auto fixed inset-0 z-30"
                onClick={() => setIsMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="pointer-events-auto absolute right-4 top-16 z-40 w-64 rounded-2xl bg-[#0D111A]/95 border border-white/15 shadow-2xl p-2 space-y-1 text-xs">
                {!user ? (
                  <button
                    type="button"
                    disabled={authLoading}
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleSignInGoogle();
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-white text-slate-950 hover:bg-slate-100 font-semibold flex items-center gap-2.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <LogIn className="w-4 h-4 shrink-0" />
                    <span>{authLoading ? 'Đang đăng nhập...' : 'Đăng nhập Google'}</span>
                  </button>
                ) : accountLoading || !account ? (
                  <div className="px-3 py-2.5 text-slate-300">Đang xác thực tài khoản...</div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        setIsProfileOpen(true);
                      }}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl hover:bg-white/[0.07] text-left flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      {account.photoURL ? (
                        <img
                          src={account.photoURL}
                          alt={account.displayName}
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded-full object-cover shrink-0 border border-white/15"
                        />
                      ) : (
                        <UserIcon className="w-4 h-4 text-sky-400 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-white truncate">
                          {account.displayName}
                        </div>
                        <div className="text-[11px] text-sky-300">
                          {account.role === 'admin' ? 'Quản trị viên (Admin)' : 'Người dùng (User)'}
                        </div>
                      </div>
                    </button>

                    {account.role === 'admin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          setActiveView((prev) => (prev === 'admin' ? 'app' : 'admin'));
                        }}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl hover:bg-white/[0.07] text-slate-100 font-medium flex items-center gap-2.5 transition-colors cursor-pointer"
                      >
                        {isAdminView ? (
                          <>
                            <Sparkles className="w-4 h-4 text-sky-300 shrink-0" />
                            <span>Quay lại Ứng dụng AI</span>
                          </>
                        ) : (
                          <>
                            <Shield className="w-4 h-4 text-sky-400 shrink-0" />
                            <span>Quản trị hệ thống</span>
                          </>
                        )}
                      </button>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsHistoryOpen(true);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl hover:bg-white/[0.07] text-slate-100 font-medium flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Lịch sử hội thoại</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsDrawerOpen(true);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl hover:bg-white/[0.07] text-slate-100 font-medium flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Plug className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Kết nối Gemini &amp; Hermes</span>
                </button>

                {user && (
                  <button
                    type="button"
                    disabled={authLoading}
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleSignOut();
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl hover:bg-rose-500/15 text-rose-300 font-medium flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>Đăng xuất</span>
                  </button>
                )}
              </div>
            </>
          )}

          {/* Auth Error Notice */}
          {authError && (
            <div className="pointer-events-auto mx-4 mb-2 px-4 py-2.5 rounded-xl bg-rose-950/90 border border-rose-500/35 text-rose-200 text-xs flex items-center justify-between gap-3 shrink-0">
              <span>{authError}</span>
              <button
                type="button"
                onClick={() => setAuthError(null)}
                className="text-rose-300 hover:text-white font-medium shrink-0 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          )}

        {/* Render Admin Dashboard OR User AI Service Stage */}
        {isAdminView && account ? (
          <div className="pointer-events-auto flex-1 flex flex-col min-h-0 overflow-hidden">
            <AdminDashboard
              currentAdmin={account}
              accounts={allAccounts}
              logs={activityLogs}
              loadingError={adminDataError}
            />
          </div>
        ) : (
          <>
            {/* Expiring Soon Warning Banner */}
            {account && access?.canUseApp && access.isExpiringSoon && (
              <div className="pointer-events-auto mx-5 sm:mx-8 mb-2 px-4 py-2.5 rounded-xl bg-amber-950/85 border border-amber-400/30 text-amber-200 text-xs flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="truncate">
                    Tài khoản của bạn còn <strong>{access.remainingDays} ngày</strong> sử dụng trước khi tự động khóa.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsProfileOpen(true)}
                  className="text-amber-300 hover:text-white font-medium underline underline-offset-2 shrink-0 cursor-pointer"
                >
                  Chi tiết
                </button>
              </div>
            )}

            {/* Locked / Expired Blocking Banner */}
            {account && access && !access.canUseApp && (
              <div className="pointer-events-auto mx-5 sm:mx-8 my-2 px-4 py-3.5 rounded-2xl bg-rose-950/85 border border-rose-500/35 text-rose-100 text-xs space-y-2.5 shrink-0">
                <div className="flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-white">
                      {access.isExpired ? 'Tài khoản đã hết hạn sử dụng' : 'Tài khoản đang bị khóa'}
                    </div>
                    <p className="text-rose-200/90 leading-relaxed">{access.reason}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-6">
                  <button
                    type="button"
                    onClick={() => setIsProfileOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium cursor-pointer"
                  >
                    Xem thông tin tài khoản
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium cursor-pointer"
                  >
                    Đăng xuất
                  </button>
                </div>
              </div>
            )}

            {/* Sign-in Prompt for Guests */}
            {!user && (
              <div className="pointer-events-auto mx-5 sm:mx-8 mb-2 px-4 py-3 rounded-xl bg-[#0B1528]/90 border border-sky-400/25 text-slate-200 text-xs flex flex-wrap items-center justify-between gap-3 shrink-0">
                <span>
                  Vui lòng <strong>Đăng nhập</strong> bằng tài khoản Google để sử dụng dịch vụ Gemini Live &amp; Hermes MCP theo quyền được cấp.
                </span>
                <button
                  type="button"
                  onClick={handleSignInGoogle}
                  disabled={authLoading}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Đăng nhập ngay</span>
                </button>
              </div>
            )}

            {/* Open 3D Viewport Pass-Through Spacer (Drag to rotate 360°, tap character to wave) */}
            <div className="flex-1 min-h-[120px] pointer-events-none" aria-hidden="true" />

            {/* Error Notification Banner */}
            {errorMessage && (
              <div className="pointer-events-auto mx-4 mb-2 px-3.5 py-2 rounded-xl bg-rose-950/90 border border-rose-500/35 text-rose-200 text-xs flex items-center justify-between gap-3 shrink-0">
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

            {/* On-screen Conversation Visibility Toggle */}
            <div className="pointer-events-auto px-4 pb-1.5 flex items-center justify-between gap-2 shrink-0">
              <span className="text-[11px] text-slate-400 select-none">
                Kéo xoay 3D · Chạm nhân vật để tương tác
              </span>
              <button
                type="button"
                onClick={() => setIsTranscriptVisible((prev) => !prev)}
                aria-pressed={isTranscriptVisible}
                aria-label={isTranscriptVisible ? 'Ẩn khung hội thoại' : 'Hiện khung hội thoại'}
                className="min-h-[36px] px-3 py-1.5 rounded-full bg-[#0B1120]/90 hover:bg-[#0D162E] border border-white/15 text-[11px] font-medium text-slate-200 inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              >
                {isTranscriptVisible ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-slate-300" />
                    <span>Ẩn hội thoại</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5 text-sky-400" />
                    <span>Hiện hội thoại</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Transcript Feed (Compact Half-Height & Smaller Typography) */}
            {isTranscriptVisible && (
              <main className="pointer-events-auto transcript-scroll h-[23dvh] min-h-[136px] max-h-[210px] shrink-0 overflow-y-auto px-3.5 py-1.5 space-y-2">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] px-3 py-2 text-xs leading-snug ${
                        msg.role === 'user'
                          ? 'bg-[#0B1120]/92 border border-white/15 text-slate-100 rounded-2xl rounded-tr-sm'
                          : 'bg-[#0D162E]/92 border border-sky-400/25 text-slate-100 rounded-2xl rounded-tl-sm'
                      }`}
                    >
                      {/* Hermes MCP Tool Invocations */}
                      {msg.mcpCalls && msg.mcpCalls.length > 0 && (
                        <div className="mb-1.5 space-y-1">
                          {msg.mcpCalls.map((call, idx) => {
                            const key = `${msg.id}-${idx}`;
                            const isExpanded = Boolean(expandedCalls[key]);
                            return (
                              <div key={key}>
                                <button
                                  type="button"
                                  onClick={() => toggleExpandedCall(key)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-[10px] font-mono text-sky-300 transition-colors cursor-pointer"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3 h-3" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3" />
                                  )}
                                  <span>{call.uri}</span>
                                </button>
                                {isExpanded && (
                                  <pre className="mt-1 p-2 rounded-lg bg-black/50 border border-white/10 font-mono text-[10px] text-slate-300 overflow-x-auto">
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
                    <div className="mt-0.5 px-1 flex items-center gap-2 text-[10px] text-slate-400 tabular-nums">
                      <span>
                        {msg.role === 'user' ? 'Bạn' : 'Gemini'} · {msg.timestamp}
                        {msg.isInterim ? ' · Đang nhận diện' : ''}
                      </span>
                      {msg.role === 'gemini' && !msg.isInterim && canPreviewTts && (
                        <button
                          type="button"
                          onClick={() => playGeminiTts(msg.text)}
                          title="Nghe lại bằng giọng Google Gemini"
                          aria-label="Nghe lại câu trả lời bằng giọng Google Gemini"
                          className="inline-flex items-center gap-1 text-slate-300 hover:text-sky-300 transition-colors cursor-pointer"
                        >
                          <Volume2 className="w-3 h-3" />
                          <span>Nghe</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Quick Starter Prompts on Fresh Session */}
                {messages.length <= 1 && canUseTextChat && (
                  <div className="pt-1 flex flex-wrap gap-1.5 justify-end">
                    {QUICK_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => handleGuardedSendText(prompt)}
                        className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[11px] text-slate-300 hover:text-white transition-colors cursor-pointer text-left"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}

                <div ref={transcriptEndRef} />
              </main>
            )}

            {/* Live Interim Speech Caption */}
            {interimUserText && (
              <div className="pointer-events-auto px-5 sm:px-8 py-1.5 text-center shrink-0">
                <p className="text-xs text-sky-300/90 italic truncate">“{interimUserText}”</p>
              </div>
            )}

            {/* Optional Keyboard Text Input Bar */}
            {showTextInput && canUseTextChat && (
              <form onSubmit={handleSubmitText} className="pointer-events-auto px-5 sm:px-8 pt-2 pb-1 shrink-0">
                <div className="flex items-center gap-2 bg-[#0B1120]/90 border border-white/15 rounded-full px-3.5 py-1.5 focus-within:border-sky-400/60 transition-colors">
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
            <footer className="pointer-events-auto px-5 pt-3 pb-5 shrink-0 flex items-center justify-center gap-5">
              <button
                type="button"
                onClick={() => {
                  if (!guardUserAction('text_chat')) return;
                  setShowTextInput((prev) => !prev);
                }}
                title={
                  !canUseTextChat
                    ? 'Cần đăng nhập và được cấp quyền Chat văn bản'
                    : showTextInput
                      ? 'Ẩn bàn phím'
                      : 'Mở bàn phím'
                }
                aria-label="Chuyển đổi nhập văn bản"
                className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                  !canUseTextChat
                    ? 'bg-[#0B1120]/80 border-white/10 text-slate-600'
                    : showTextInput
                      ? 'bg-[#152238] border-white/30 text-white'
                      : 'bg-[#0B1120]/90 hover:bg-[#151E32] border-white/15 text-slate-200'
                }`}
              >
                <Keyboard className="w-5 h-5" />
              </button>

              <ReactiveMicButton
                status={status}
                statusLabel={statusLabel}
                isLiveActive={isLiveActive}
                canUseVoiceLive={canUseVoiceLive}
                audioLevelRef={audioLevelRef}
                onClick={handleGuardedToggleLive}
              />

              <button
                type="button"
                onClick={() => setIsSpeakerMuted((prev) => !prev)}
                title={isSpeakerMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
                aria-label={isSpeakerMuted ? 'Bật loa phản hồi' : 'Tắt loa phản hồi'}
                className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                  isSpeakerMuted
                    ? 'bg-rose-950/85 border-rose-400/45 text-rose-300'
                    : 'bg-[#0B1120]/90 hover:bg-[#151E32] border-white/15 text-slate-200'
                }`}
              >
                {isSpeakerMuted ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
            </footer>
          </>
        )}
        </div>
      </div>

      {/* Hermes MCP Bridge & Voice Settings Drawer */}
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
          if (!guardUserAction('tts_preview')) {
            return { ok: false, error: 'Tài khoản chưa được cấp quyền Đọc giọng nói TTS.' };
          }
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
        accountRole={account?.role ?? null}
        canPreviewVoice={canPreviewTts}
        canUseHermes={canUseHermes}
      />

      {/* Dedicated Conversation History Sheet */}
      <HistorySheet
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => {
          handleSelectSession(id);
          setIsTranscriptVisible(true);
          setIsHistoryOpen(false);
        }}
        onNewSession={() => {
          handleNewSession();
          setIsTranscriptVisible(true);
          setIsHistoryOpen(false);
        }}
        onDeleteSession={handleDeleteSession}
      />

      {/* User Personal Profile & Permissions Modal */}
      {account && (
        <UserProfileModal
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          account={account}
          personalLogs={personalLogs}
        />
      )}
    </div>
  );
}
