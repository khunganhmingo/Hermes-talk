import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  History,
  Lock,
  Save,
  Shield,
  User as UserIcon,
  X,
} from 'lucide-react';
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  evaluateAccountAccess,
  formatExpiryLabel,
  hasPermission,
} from '../lib/rbac';
import { userUpdateOwnProfile } from '../lib/accountService';
import type { ActivityLog, UserAccount } from '../types';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: UserAccount;
  personalLogs: ActivityLog[];
}

export function UserProfileModal({
  isOpen,
  onClose,
  account,
  personalLogs,
}: UserProfileModalProps) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    setDisplayName(account.displayName);
    setFeedback(null);
  }, [account.displayName, isOpen]);

  if (!isOpen) return null;

  const access = evaluateAccountAccess(account);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await userUpdateOwnProfile(account, displayName);
      setFeedback({
        type: 'success',
        text: 'Đã cập nhật thông tin cá nhân.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể cập nhật hồ sơ.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-[#0D111A] border border-white/15 overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-white">Thông tin tài khoản cá nhân</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
            aria-label="Đóng hồ sơ"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 text-xs max-h-[82dvh] overflow-y-auto transcript-scroll">
          {/* Account Header Summary */}
          <div className="flex items-center gap-3.5 pb-4 border-b border-white/10">
            {account.photoURL ? (
              <img
                src={account.photoURL}
                alt={account.displayName}
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-full object-cover border border-white/15 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300 text-base font-semibold shrink-0">
                {(account.displayName || account.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">
                {account.displayName}
              </div>
              <div className="text-[11px] font-mono text-slate-400 truncate">{account.email}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 text-sky-300 font-medium">
                  <Shield className="w-3.5 h-3.5" />
                  <span>{account.role === 'admin' ? 'Quản trị viên (Admin)' : 'Người dùng (User)'}</span>
                </span>
                <span className="text-slate-600">·</span>
                <span className="inline-flex items-center gap-1 font-mono text-slate-300 tabular-nums">
                  <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                  <span>{formatExpiryLabel(account.expiresAtMs)}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Account Access Status Notice */}
          {!access.canUseApp ? (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 flex items-start gap-2.5 text-rose-200">
              <Lock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{access.reason}</span>
            </div>
          ) : access.isExpiringSoon ? (
            <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-3 flex items-start gap-2.5 text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Tài khoản của bạn còn <strong>{access.remainingDays} ngày</strong> sử dụng. Vui lòng
                liên hệ Quản trị viên để gia hạn trước khi bị tự động khóa.
              </span>
            </div>
          ) : null}

          {/* Editable Display Name */}
          <form onSubmit={handleSave} className="space-y-2.5">
            <label className="block text-[11px] text-slate-400" htmlFor="profile-display-name">
              Tên hiển thị cá nhân
            </label>
            <div className="flex items-center gap-2">
              <input
                id="profile-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="flex-1 h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 text-xs focus:outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                disabled={saving || !displayName.trim()}
                className="h-9 px-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Đang lưu...' : 'Lưu'}</span>
              </button>
            </div>
            {feedback && (
              <p
                className={`text-[11px] ${
                  feedback.type === 'success' ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {feedback.text}
              </p>
            )}
          </form>

          {/* Granted Feature Permissions */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold text-slate-300">
              Quyền sử dụng dịch vụ được cấp
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_PERMISSIONS.map((perm) => {
                const allowed = hasPermission(account, perm);
                return (
                  <div
                    key={perm}
                    className={`rounded-xl border px-3 py-2 flex items-start gap-2 ${
                      allowed
                        ? 'bg-emerald-500/[0.06] border-emerald-500/25 text-slate-100'
                        : 'bg-white/[0.02] border-white/10 text-slate-500'
                    }`}
                  >
                    {allowed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-medium">{PERMISSION_LABELS[perm].label}</div>
                      <div className="text-[10.5px] opacity-80">
                        {allowed ? 'Được phép sử dụng' : 'Chưa được cấp quyền'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Personal Activity Logs */}
          <div className="space-y-2 pt-2 border-t border-white/10">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
              <History className="w-3.5 h-3.5 text-slate-400" />
              <span>Lịch sử hoạt động gần đây</span>
            </div>
            {personalLogs.length === 0 ? (
              <p className="text-[11px] text-slate-500">Chưa có lịch sử hoạt động.</p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto transcript-scroll">
                {personalLogs.slice(0, 20).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg bg-white/[0.025] border border-white/[0.07] px-3 py-2 flex items-start justify-between gap-2"
                  >
                    <span className="text-[11px] text-slate-300">{log.detail}</span>
                    <span className="text-[10.5px] font-mono text-slate-500 whitespace-nowrap tabular-nums">
                      {new Date(log.createdAtMs).toLocaleString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
