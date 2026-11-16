import { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  LogIn,
  LogOut,
  MessageSquarePlus,
  RefreshCw,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import type {
  ConversationSession,
  GeminiVoiceName,
  McpConfig,
} from '../types';

export interface GeminiConnectionState {
  configured: boolean;
  connected: boolean;
  models: string[];
  message: string;
  checking: boolean;
}

interface McpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  authLoading: boolean;
  authError: string | null;
  onSignInGoogle: () => void;
  onSignOut: () => void;
  geminiStatus: GeminiConnectionState;
  onCheckGemini: (model: string) => void;
  config: McpConfig;
  onConfigChange: (next: McpConfig) => void;
  onPreviewVoice: () => Promise<{ ok: boolean; usedFallback?: boolean; error?: string }>;
  connectedMode: 'remote' | 'local-bridge';
  activeEndpoint: string;
  isPinging: boolean;
  pingError: string | null;
  onPing: () => void;
  sessions: ConversationSession[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
}

const VOICES: Array<{ id: GeminiVoiceName; label: string }> = [
  { id: 'Kore', label: 'Kore (Nữ · Tự nhiên)' },
  { id: 'Zephyr', label: 'Zephyr (Nữ · Nhẹ nhàng)' },
  { id: 'Puck', label: 'Puck (Nam · Năng động)' },
  { id: 'Charon', label: 'Charon (Nam · Trầm ấm)' },
  { id: 'Fenrir', label: 'Fenrir (Nam · Mạnh mẽ)' },
];

export function McpDrawer({
  isOpen,
  onClose,
  user,
  authLoading,
  authError,
  onSignInGoogle,
  onSignOut,
  geminiStatus,
  onCheckGemini,
  config,
  onConfigChange,
  onPreviewVoice,
  connectedMode,
  activeEndpoint,
  isPinging,
  pingError,
  onPing,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: McpDrawerProps) {
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);
  const [voicePreviewNotice, setVoicePreviewNotice] = useState<{
    type: 'info' | 'error';
    text: string;
  } | null>(null);
  const [selectedGeminiModel, setSelectedGeminiModel] = useState('');

  if (!isOpen) return null;

  const handlePreviewVoiceClick = async () => {
    setIsPreviewingVoice(true);
    setVoicePreviewNotice(null);
    try {
      const result = await onPreviewVoice();
      if (result.usedFallback) {
        setVoicePreviewNotice({
          type: 'info',
          text: 'Gemini TTS đang quá hạn mức (429). Đang phát giọng đọc tiếng Việt dự phòng của trình duyệt.',
        });
      } else if (!result.ok && result.error) {
        setVoicePreviewNotice({
          type: 'error',
          text: result.error,
        });
      }
    } finally {
      setIsPreviewingVoice(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 lg:static lg:inset-auto lg:w-[400px] lg:shrink-0 flex flex-col justify-end lg:justify-start">
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative z-10 w-full max-h-[88dvh] lg:max-h-none lg:h-full bg-[#0D111A] border-t lg:border-t-0 lg:border-l border-white/10 rounded-t-3xl lg:rounded-none flex flex-col overflow-hidden">
        {/* Mobile grab handle */}
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mt-3 lg:hidden" />

        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">Hermes MCP & Lịch sử</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {connectedMode === 'remote' ? 'Connected Remote' : 'Local Hermes Core'} · {activeEndpoint}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Đóng bảng cấu hình"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 transcript-scroll text-xs">
          {/* Google Auth & Gemini API Connection */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-200">
              Tài khoản & Kết nối Gemini API
            </h3>

            {/* Google Auth Card */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2.5">
              {user ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'Google User'}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover border border-white/15 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300 font-semibold shrink-0">
                        {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white truncate">
                        {user.displayName || 'Tài khoản Google'}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {user.email}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onSignOut}
                    disabled={authLoading}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] text-slate-300 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200">Đăng nhập Google</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Xác thực tài khoản người dùng qua Google Auth
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onSignInGoogle}
                    disabled={authLoading}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white text-slate-900 hover:bg-slate-100 font-medium text-[11px] inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{authLoading ? 'Đang mở...' : 'Đăng nhập'}</span>
                  </button>
                </div>
              )}

              {authError && (
                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px]">
                  {authError}
                </div>
              )}
            </div>

            {/* Server-side Gemini API Connection & Available Models (hidden when signed in with Google Auth) */}
            {!user && (
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>Kết nối Gemini API</span>
                    {geminiStatus.connected && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <span
                    className={`text-[10.5px] font-medium shrink-0 ${
                      geminiStatus.configured ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {geminiStatus.configured
                      ? 'Secrets: Đã cấu hình'
                      : 'Secrets: Chưa cấu hình'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {geminiStatus.configured
                    ? `${geminiStatus.message} API Key được quản lý bảo mật ở máy chủ qua Settings > Secrets (không nhập trực tiếp trên trình duyệt).`
                    : 'Chưa có GEMINI_API_KEY trên máy chủ. Vui lòng thiết lập trong Settings > Secrets của dự án để kết nối.'}
                </p>

                <div>
                  <label
                    className="block text-[11px] text-slate-400 mb-1"
                    htmlFor="gemini-model"
                  >
                    Model Gemini hiện có ({geminiStatus.models.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      id="gemini-model"
                      value={selectedGeminiModel}
                      onChange={(e) => setSelectedGeminiModel(e.target.value)}
                      className="flex-1 min-w-0 h-9 bg-black/40 border border-white/15 rounded-xl px-2.5 text-slate-200 text-[11px] focus:outline-none focus:border-sky-400"
                    >
                      <option value="">-- Chọn model để kiểm tra --</option>
                      {geminiStatus.models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onCheckGemini(selectedGeminiModel)}
                      disabled={
                        !selectedGeminiModel ||
                        geminiStatus.checking ||
                        !geminiStatus.configured
                      }
                      className="h-9 px-3 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-200 font-medium text-[11px] inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${geminiStatus.checking ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {geminiStatus.checking ? 'Đang kiểm tra...' : 'Kiểm tra'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] text-slate-400 mb-1" htmlFor="gemini-voice">
                Giọng nói Google Gemini (Tiếng Việt)
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="gemini-voice"
                  value={config.voiceName}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      voiceName: e.target.value as GeminiVoiceName,
                    })
                  }
                  className="flex-1 min-w-0 h-9 bg-black/40 border border-white/15 rounded-xl px-2.5 text-slate-200 text-[11px] focus:outline-none focus:border-sky-400"
                >
                  {VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handlePreviewVoiceClick}
                  disabled={isPreviewingVoice}
                  title="Nghe thử giọng nói đang chọn"
                  className="h-9 px-3 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-300 font-medium text-[11px] inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                >
                  <Volume2 className={`w-3.5 h-3.5 ${isPreviewingVoice ? 'animate-pulse' : ''}`} />
                  <span>{isPreviewingVoice ? 'Đang tải...' : 'Nghe thử'}</span>
                </button>
              </div>
              {voicePreviewNotice && (
                <p
                  className={`mt-1.5 text-[11px] leading-relaxed ${
                    voicePreviewNotice.type === 'error' ? 'text-rose-300' : 'text-amber-300'
                  }`}
                >
                  {voicePreviewNotice.text}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-slate-300">
                Tự động đọc tin nhắn văn bản bằng giọng Gemini
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={config.speakTextReplies}
                aria-label="Tự động đọc tin nhắn văn bản bằng giọng Gemini"
                onClick={() =>
                  onConfigChange({
                    ...config,
                    speakTextReplies: !config.speakTextReplies,
                  })
                }
                className={`w-10 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${
                  config.speakTextReplies ? 'bg-sky-500' : 'bg-white/15'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white transition-transform transform ${
                    config.speakTextReplies ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Endpoint Config */}
          <section className="space-y-3 pt-2 border-t border-white/10">
            <h3 className="text-xs font-semibold text-slate-200">Kết nối Hermes MCP Server</h3>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1" htmlFor="mcp-endpoint">
                  MCP HTTP / SSE Endpoint URL (để trống dùng Local Hermes Core)
                </label>
                <input
                  id="mcp-endpoint"
                  type="text"
                  value={config.endpoint}
                  onChange={(e) => onConfigChange({ ...config, endpoint: e.target.value })}
                  placeholder="http://localhost:8080/mcp"
                  className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-sky-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1" htmlFor="mcp-token">
                    Bearer Token (tùy chọn)
                  </label>
                  <input
                    id="mcp-token"
                    type="password"
                    value={config.token}
                    onChange={(e) => onConfigChange({ ...config, token: e.target.value })}
                    placeholder="hermes_sk_..."
                    className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-sky-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1" htmlFor="mcp-mode">
                    Chế độ Bridge
                  </label>
                  <select
                    id="mcp-mode"
                    value={config.mode}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        mode: e.target.value as McpConfig['mode'],
                      })
                    }
                    className="w-full bg-black/40 border border-white/15 rounded-xl px-2.5 py-2 text-slate-200 text-[11px] focus:outline-none focus:border-sky-400"
                  >
                    <option value="auto">Tự động (Fallback Local)</option>
                    <option value="remote">Chỉ Remote Hermes</option>
                    <option value="local">Local Hermes Core</option>
                  </select>
                </div>
              </div>

              {/* Kiểm tra kết nối button positioned directly below Bearer Token */}
              <button
                type="button"
                onClick={onPing}
                disabled={isPinging}
                className="w-full min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-300 font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                <span>{isPinging ? 'Đang kiểm tra kết nối...' : 'Kiểm tra kết nối'}</span>
              </button>
            </div>

            {pingError && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px]">
                {pingError}
              </div>
            )}
          </section>

          {/* Conversation History */}
          <section className="space-y-2.5 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-200">Lịch sử cuộc trò chuyện</h3>
              <button
                type="button"
                onClick={onNewSession}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-sky-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Cuộc trò chuyện mới</span>
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto transcript-scroll">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <div
                    key={session.id}
                    className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 transition-colors ${
                      isActive
                        ? 'bg-sky-500/10 border-sky-400/35'
                        : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="text-xs font-medium text-slate-100 truncate">
                        {session.title}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                        {session.updatedAt} · {session.messages.length} tin nhắn
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.id)}
                      title="Xóa cuộc trò chuyện này"
                      aria-label={`Xóa ${session.title}`}
                      className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
