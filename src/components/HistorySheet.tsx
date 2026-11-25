import { MessageSquare, MessageSquarePlus, Trash2, X } from 'lucide-react';
import type { ConversationSession } from '../types';

interface HistorySheetProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ConversationSession[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
}

export function HistorySheet({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: HistorySheetProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end items-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative z-10 w-full max-w-[430px] max-h-[82dvh] bg-[#0D111A] border-t border-x border-white/10 rounded-t-3xl flex flex-col overflow-hidden shadow-2xl">
        {/* Grab handle */}
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mt-3" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">Lịch sử hội thoại</h2>
              <p className="text-[11px] text-slate-400 tabular-nums">
                {sessions.length} cuộc trò chuyện đã lưu
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onNewSession}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-[11px] font-medium text-sky-300 transition-colors cursor-pointer whitespace-nowrap"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>Tạo mới</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Đóng lịch sử hội thoại"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 transcript-scroll">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition-colors ${
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
                  className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
