import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Edit3,
  History,
  Lock,
  Plus,
  Search,
  Shield,
  Trash2,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  ALL_PERMISSIONS,
  BOOTSTRAP_ADMIN_EMAIL,
  DAY_MS,
  PERMISSION_LABELS,
  computeAdminStats,
  evaluateAccountAccess,
  formatExpiryLabel,
  normalizePermissions,
} from '../lib/rbac';
import {
  adminCreateUser,
  adminDeleteUser,
  adminExtendUserExpiry,
  adminToggleUserLock,
  adminUpdateUser,
} from '../lib/accountService';
import type {
  AccountStatus,
  ActivityAction,
  ActivityLog,
  FeaturePermission,
  UserAccount,
  UserRole,
} from '../types';

interface AdminDashboardProps {
  currentAdmin: UserAccount;
  accounts: UserAccount[];
  logs: ActivityLog[];
  loadingError?: string | null;
}

type AccountFilter = 'all' | 'active' | 'expiring_soon' | 'expired' | 'locked' | 'admin';
type AdminTab = 'users' | 'logs';
type ExpiryPreset = '7' | '30' | '90' | '365' | 'unlimited' | 'custom';

const ACTION_LABELS: Record<ActivityAction, string> = {
  login: 'Đăng nhập',
  logout: 'Đăng xuất',
  create_user: 'Tạo tài khoản',
  update_user: 'Cập nhật tài khoản',
  lock_user: 'Khóa tài khoản',
  unlock_user: 'Mở khóa tài khoản',
  extend_user: 'Gia hạn tài khoản',
  delete_user: 'Xóa tài khoản',
  auto_expire_lock: 'Tự động khóa hết hạn',
  update_profile: 'Sửa hồ sơ cá nhân',
  use_voice_live: 'Dùng Gemini Live',
  use_text_chat: 'Chat văn bản',
  use_hermes_mcp: 'Gọi Hermes MCP',
  use_tts_preview: 'Nghe giọng TTS',
};

function toDateInputValue(ms: number): string {
  if (!ms || ms <= 0) {
    const d = new Date(Date.now() + 30 * DAY_MS);
    return d.toISOString().slice(0, 10);
  }
  return new Date(ms).toISOString().slice(0, 10);
}

function fromDateInputValue(dateStr: string): number {
  if (!dateStr) return Date.now() + 30 * DAY_MS;
  const parsed = new Date(`${dateStr}T23:59:59`);
  return Number.isNaN(parsed.getTime()) ? Date.now() + 30 * DAY_MS : parsed.getTime();
}

export function AdminDashboard({
  currentAdmin,
  accounts,
  logs,
  loadingError,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [logFilter, setLogFilter] = useState<string>('all');

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Create / Edit Modal state
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [editingTarget, setEditingTarget] = useState<UserAccount | null>(null);
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('user');
  const [formStatus, setFormStatus] = useState<AccountStatus>('active');
  const [formPermissions, setFormPermissions] = useState<FeaturePermission[]>([...ALL_PERMISSIONS]);
  const [formExpiryPreset, setFormExpiryPreset] = useState<ExpiryPreset>('30');
  const [formCustomDate, setFormCustomDate] = useState(toDateInputValue(0));
  const [formNote, setFormNote] = useState('');
  const [submittingForm, setSubmittingForm] = useState(false);

  // Quick Extend Modal state
  const [extendTarget, setExtendTarget] = useState<UserAccount | null>(null);
  const [extendCustomDate, setExtendCustomDate] = useState('');

  // Delete Confirmation Modal state
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null);

  const stats = useMemo(() => computeAdminStats(accounts), [accounts]);

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter((acc) => {
      const access = evaluateAccountAccess(acc);
      if (filter === 'active' && !access.canUseApp) return false;
      if (filter === 'expiring_soon' && !access.isExpiringSoon) return false;
      if (filter === 'expired' && !access.isExpired) return false;
      if (filter === 'locked' && !access.isLocked) return false;
      if (filter === 'admin' && acc.role !== 'admin') return false;

      if (!q) return true;
      return (
        acc.displayName.toLowerCase().includes(q) ||
        acc.email.toLowerCase().includes(q) ||
        acc.note.toLowerCase().includes(q)
      );
    });
  }, [accounts, filter, searchQuery]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((log) => {
      if (logFilter !== 'all' && log.action !== logFilter) return false;
      if (!q) return true;
      return (
        log.actorEmail.toLowerCase().includes(q) ||
        log.targetLabel.toLowerCase().includes(q) ||
        log.detail.toLowerCase().includes(q)
      );
    });
  }, [logFilter, logs, searchQuery]);

  const openCreateModal = () => {
    setEditorMode('create');
    setEditingTarget(null);
    setFormEmail('');
    setFormName('');
    setFormRole('user');
    setFormStatus('active');
    setFormPermissions([...ALL_PERMISSIONS]);
    setFormExpiryPreset('30');
    setFormCustomDate(toDateInputValue(Date.now() + 30 * DAY_MS));
    setFormNote('');
    setActionMessage(null);
  };

  const openEditModal = (acc: UserAccount) => {
    setEditorMode('edit');
    setEditingTarget(acc);
    setFormEmail(acc.email);
    setFormName(acc.displayName);
    setFormRole(acc.role);
    setFormStatus(acc.status);
    setFormPermissions(
      acc.role === 'admin' ? [...ALL_PERMISSIONS] : normalizePermissions(acc.permissions)
    );
    if (!acc.expiresAtMs || acc.expiresAtMs <= 0) {
      setFormExpiryPreset('unlimited');
    } else {
      setFormExpiryPreset('custom');
      setFormCustomDate(toDateInputValue(acc.expiresAtMs));
    }
    setFormNote(acc.note || '');
    setActionMessage(null);
  };

  const resolveFormExpiresAtMs = (): number => {
    if (formExpiryPreset === 'unlimited') return 0;
    if (formExpiryPreset === 'custom') return fromDateInputValue(formCustomDate);
    const days = Number(formExpiryPreset);
    return Date.now() + days * DAY_MS;
  };

  const handleTogglePermission = (perm: FeaturePermission) => {
    setFormPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSubmitEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingForm(true);
    setActionMessage(null);

    try {
      const expiresAtMs = resolveFormExpiresAtMs();
      const effectivePermissions =
        formRole === 'admin' ? [...ALL_PERMISSIONS] : normalizePermissions(formPermissions);

      if (editorMode === 'create') {
        const email = formEmail.trim().toLowerCase();
        if (!email || !email.includes('@')) {
          throw new Error('Vui lòng nhập địa chỉ email Google hợp lệ.');
        }
        await adminCreateUser(
          {
            email,
            displayName: formName.trim() || email.split('@')[0],
            role: formRole,
            status: formStatus,
            permissions: effectivePermissions,
            expiresAtMs,
            note: formNote,
          },
          currentAdmin
        );
        setActionMessage({
          type: 'success',
          text: `Đã tạo tài khoản cho ${email}. Quyền và thời hạn sẽ áp dụng ngay khi người dùng đăng nhập.`,
        });
      } else if (editorMode === 'edit' && editingTarget) {
        await adminUpdateUser(
          editingTarget,
          {
            displayName: formName.trim() || editingTarget.displayName,
            role: formRole,
            status: formStatus,
            permissions: effectivePermissions,
            expiresAtMs,
            note: formNote,
          },
          currentAdmin
        );
        setActionMessage({
          type: 'success',
          text: `Đã cập nhật tài khoản ${editingTarget.email}.`,
        });
      }
      setEditorMode(null);
      setEditingTarget(null);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể lưu thay đổi tài khoản.',
      });
    } finally {
      setSubmittingForm(false);
    }
  };

  const handleQuickToggleLock = async (acc: UserAccount) => {
    if (acc.id === currentAdmin.id || acc.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) {
      setActionMessage({
        type: 'error',
        text: 'Không thể tự khóa tài khoản Quản trị viên gốc đang hoạt động.',
      });
      return;
    }
    setBusyId(acc.id);
    setActionMessage(null);
    try {
      await adminToggleUserLock(acc, currentAdmin);
      setActionMessage({
        type: 'success',
        text:
          acc.status === 'locked'
            ? `Đã mở khóa tài khoản ${acc.email}.`
            : `Đã khóa quyền truy cập tài khoản ${acc.email}.`,
      });
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Thao tác khóa/mở khóa thất bại.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleApplyQuickExtend = async (daysToAdd: number | null) => {
    if (!extendTarget) return;
    setBusyId(extendTarget.id);
    setActionMessage(null);
    try {
      await adminExtendUserExpiry(extendTarget, daysToAdd, currentAdmin);
      setActionMessage({
        type: 'success',
        text:
          daysToAdd === null
            ? `Đã gia hạn Vĩnh viễn cho ${extendTarget.email}.`
            : `Đã gia hạn +${daysToAdd} ngày cho ${extendTarget.email}.`,
      });
      setExtendTarget(null);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gia hạn tài khoản thất bại.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleApplyCustomExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendTarget || !extendCustomDate) return;
    setBusyId(extendTarget.id);
    setActionMessage(null);
    try {
      const nextMs = fromDateInputValue(extendCustomDate);
      await adminUpdateUser(
        extendTarget,
        {
          displayName: extendTarget.displayName,
          role: extendTarget.role,
          status: 'active',
          permissions: extendTarget.permissions,
          expiresAtMs: nextMs,
          note: extendTarget.note,
        },
        currentAdmin
      );
      setActionMessage({
        type: 'success',
        text: `Đã đặt thời hạn mới cho ${extendTarget.email} đến ${new Date(nextMs).toLocaleDateString('vi-VN')}.`,
      });
      setExtendTarget(null);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Cập nhật thời hạn thất bại.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (
      deleteTarget.id === currentAdmin.id ||
      deleteTarget.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
    ) {
      setActionMessage({
        type: 'error',
        text: 'Không thể xóa tài khoản Quản trị viên gốc.',
      });
      setDeleteTarget(null);
      return;
    }
    setBusyId(deleteTarget.id);
    setActionMessage(null);
    try {
      await adminDeleteUser(deleteTarget, currentAdmin);
      setActionMessage({
        type: 'success',
        text: `Đã xóa tài khoản ${deleteTarget.email} khỏi hệ thống.`,
      });
      setDeleteTarget(null);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể xóa tài khoản.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2 transcript-scroll">
      <div className="w-full space-y-4">
        {/* Console Title Bar */}
        <div className="flex flex-col gap-3 pt-1">
          <div>
            <h1 className="text-lg font-semibold text-white tracking-tight">
              Hệ thống Quản trị &amp; Phân quyền
            </h1>
            <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
              {stats.admins} Admin · {stats.users} User · Tự động khóa tài khoản khi hết hạn
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>Tạo tài khoản</span>
          </button>
        </div>

        {/* KPI Dashboard Row */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab('users');
              setFilter('all');
            }}
            className={`text-left rounded-xl bg-[#0D111A] border p-3.5 transition-colors cursor-pointer ${
              filter === 'all' && activeTab === 'users'
                ? 'border-sky-400/50'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Tổng tài khoản</span>
              <Users className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-white tabular-nums">
              {stats.total}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('users');
              setFilter('active');
            }}
            className={`text-left rounded-xl bg-[#0D111A] border p-3.5 transition-colors cursor-pointer ${
              filter === 'active' && activeTab === 'users'
                ? 'border-emerald-400/50'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Đang hoạt động</span>
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-emerald-300 tabular-nums">
              {stats.active}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('users');
              setFilter('expiring_soon');
            }}
            className={`text-left rounded-xl bg-[#0D111A] border p-3.5 transition-colors cursor-pointer ${
              filter === 'expiring_soon' && activeTab === 'users'
                ? 'border-amber-400/50'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Sắp hết hạn</span>
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-amber-300 tabular-nums">
              {stats.expiringSoon}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('users');
              setFilter('expired');
            }}
            className={`text-left rounded-xl bg-[#0D111A] border p-3.5 transition-colors cursor-pointer ${
              filter === 'expired' && activeTab === 'users'
                ? 'border-orange-400/50'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Đã hết hạn</span>
              <CalendarClock className="w-3.5 h-3.5 text-orange-400" />
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-orange-300 tabular-nums">
              {stats.expired}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('users');
              setFilter('locked');
            }}
            className={`col-span-2 text-left rounded-xl bg-[#0D111A] border p-3.5 transition-colors cursor-pointer ${
              filter === 'locked' && activeTab === 'users'
                ? 'border-rose-400/50'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Đang bị khóa</span>
              <Lock className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-rose-300 tabular-nums">
              {stats.locked}
            </div>
          </button>
        </div>

        {/* Expiration Alert Banner */}
        {(stats.expiringSoon > 0 || stats.expired > 0) && (
          <div className="rounded-xl bg-amber-500/[0.08] border border-amber-400/25 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Cảnh báo thời hạn: Có{' '}
                <strong className="font-semibold tabular-nums">{stats.expiringSoon}</strong> tài
                khoản sắp hết hạn (≤ 7 ngày) và{' '}
                <strong className="font-semibold tabular-nums">{stats.expired}</strong> tài khoản
                đã hết hạn.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveTab('users');
                setFilter(stats.expiringSoon > 0 ? 'expiring_soon' : 'expired');
              }}
              className="text-amber-300 hover:text-white font-medium underline underline-offset-2 cursor-pointer whitespace-nowrap"
            >
              Xem danh sách cần gia hạn
            </button>
          </div>
        )}

        {/* Action Feedback / Database Error */}
        {(actionMessage || loadingError) && (
          <div
            className={`rounded-xl px-4 py-2.5 text-xs flex items-center justify-between gap-3 border ${
              actionMessage?.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            }`}
          >
            <span>{actionMessage?.text || loadingError}</span>
            {actionMessage && (
              <button
                type="button"
                onClick={() => setActionMessage(null)}
                className="text-current opacity-80 hover:opacity-100 cursor-pointer shrink-0"
              >
                Đóng
              </button>
            )}
          </div>
        )}

        {/* Main Workspace Surface */}
        <div className="rounded-2xl bg-[#0D111A] border border-white/10 overflow-hidden">
          {/* Tabs & Search Toolbar */}
          <div className="px-4 sm:px-5 py-3.5 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab('users')}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'users'
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Tài khoản ({accounts.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'logs'
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Lịch sử hoạt động ({logs.length})</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:w-64 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    activeTab === 'users'
                      ? 'Tìm tên, email hoặc ghi chú...'
                      : 'Tìm email, đối tượng, chi tiết...'
                  }
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-black/40 border border-white/10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>

              {activeTab === 'users' ? (
                <select
                  aria-label="Lọc trạng thái tài khoản"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as AccountFilter)}
                  className="h-9 px-3 rounded-lg bg-black/40 border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-sky-400"
                >
                  <option value="all">Tất cả ({stats.total})</option>
                  <option value="active">Hoạt động ({stats.active})</option>
                  <option value="expiring_soon">Sắp hết hạn ({stats.expiringSoon})</option>
                  <option value="expired">Đã hết hạn ({stats.expired})</option>
                  <option value="locked">Bị khóa ({stats.locked})</option>
                  <option value="admin">Quản trị viên ({stats.admins})</option>
                </select>
              ) : (
                <select
                  aria-label="Lọc loại hành động"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-black/40 border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-sky-400"
                >
                  <option value="all">Mọi hoạt động</option>
                  {Object.entries(ACTION_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Users Table */}
          {activeTab === 'users' && (
            <div className="overflow-x-auto">
              {filteredAccounts.length === 0 ? (
                <div className="px-6 py-12 text-center text-xs text-slate-400">
                  Không tìm thấy tài khoản nào khớp bộ lọc hiện tại.
                </div>
              ) : (
                <table className="w-full text-left border-collapse min-w-[780px]">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-medium text-slate-400">
                      <th className="py-3 px-4">Người dùng</th>
                      <th className="py-3 px-3">Vai trò</th>
                      <th className="py-3 px-3">Trạng thái</th>
                      <th className="py-3 px-3">Thời hạn</th>
                      <th className="py-3 px-3">Quyền chức năng</th>
                      <th className="py-3 px-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-xs">
                    {filteredAccounts.map((acc) => {
                      const access = evaluateAccountAccess(acc);
                      const isBootstrap =
                        acc.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
                      const isSelf = acc.id === currentAdmin.id;
                      const isRowBusy = busyId === acc.id;

                      return (
                        <tr
                          key={`${acc.isPendingInvite ? 'inv' : 'usr'}-${acc.id}`}
                          className="hover:bg-white/[0.025] transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {acc.photoURL ? (
                                <img
                                  src={acc.photoURL}
                                  alt={acc.displayName}
                                  referrerPolicy="no-referrer"
                                  className="w-8 h-8 rounded-full object-cover border border-white/15 shrink-0"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-white/[0.07] border border-white/10 flex items-center justify-center text-slate-200 font-semibold shrink-0">
                                  {(acc.displayName || acc.email || 'U').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="font-medium text-slate-100 truncate flex items-center gap-1.5">
                                  <span className="truncate">{acc.displayName}</span>
                                  {acc.isPendingInvite && (
                                    <span className="text-[10px] text-sky-300 font-normal shrink-0">
                                      · Chờ đăng nhập
                                    </span>
                                  )}
                                  {isSelf && (
                                    <span className="text-[10px] text-slate-400 font-normal shrink-0">
                                      · Bạn
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono truncate">
                                  {acc.email}
                                </div>
                                {acc.note && (
                                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                    {acc.note}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-3 whitespace-nowrap">
                            {acc.role === 'admin' ? (
                              <span className="inline-flex items-center gap-1 text-sky-300 font-medium">
                                <Shield className="w-3.5 h-3.5" />
                                <span>Admin</span>
                              </span>
                            ) : (
                              <span className="text-slate-300">User</span>
                            )}
                          </td>

                          <td className="py-3 px-3 whitespace-nowrap">
                            {access.effectiveStatus === 'active' && (
                              <span className="inline-flex items-center gap-1.5 text-emerald-300">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Hoạt động</span>
                              </span>
                            )}
                            {access.effectiveStatus === 'expiring_soon' && (
                              <span className="inline-flex items-center gap-1.5 text-amber-300">
                                <Clock className="w-3.5 h-3.5" />
                                <span>Sắp hết hạn</span>
                              </span>
                            )}
                            {access.effectiveStatus === 'expired' && (
                              <span className="inline-flex items-center gap-1.5 text-orange-300">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Hết hạn</span>
                              </span>
                            )}
                            {access.effectiveStatus === 'locked' && (
                              <span className="inline-flex items-center gap-1.5 text-rose-300">
                                <Lock className="w-3.5 h-3.5" />
                                <span>Bị khóa</span>
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-slate-300 tabular-nums">
                            {formatExpiryLabel(acc.expiresAtMs)}
                          </td>

                          <td className="py-3 px-3 text-[11px] text-slate-300">
                            {acc.role === 'admin' ? (
                              <span className="text-sky-300/90">Toàn quyền quản trị</span>
                            ) : acc.permissions.length === 0 ? (
                              <span className="text-slate-500">Chưa cấp quyền</span>
                            ) : (
                              <span className="text-slate-300">
                                {acc.permissions.length}/4 ·{' '}
                                {acc.permissions
                                  .map((p) => PERMISSION_LABELS[p].label.split(' ')[0])
                                  .join(', ')}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isRowBusy}
                                onClick={() => {
                                  setExtendTarget(acc);
                                  setExtendCustomDate(toDateInputValue(acc.expiresAtMs));
                                }}
                                title="Gia hạn thời gian sử dụng"
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-sky-500/20 border border-white/10 text-sky-300 text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40"
                              >
                                <CalendarClock className="w-3.5 h-3.5" />
                                <span>Gia hạn</span>
                              </button>

                              <button
                                type="button"
                                disabled={isRowBusy}
                                onClick={() => openEditModal(acc)}
                                title="Chỉnh sửa phân quyền & thông tin"
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-slate-200 text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Sửa</span>
                              </button>

                              <button
                                type="button"
                                disabled={isRowBusy || isSelf || isBootstrap}
                                onClick={() => handleQuickToggleLock(acc)}
                                title={
                                  isSelf || isBootstrap
                                    ? 'Không thể khóa Admin gốc'
                                    : acc.status === 'locked'
                                      ? 'Mở khóa tài khoản'
                                      : 'Khóa tài khoản'
                                }
                                className={`min-h-[34px] w-8 rounded-lg border inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                                  acc.status === 'locked'
                                    ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/20'
                                    : 'bg-white/[0.04] border-white/10 text-amber-300 hover:bg-amber-500/15'
                                }`}
                              >
                                {acc.status === 'locked' ? (
                                  <Unlock className="w-3.5 h-3.5" />
                                ) : (
                                  <Lock className="w-3.5 h-3.5" />
                                )}
                              </button>

                              <button
                                type="button"
                                disabled={isRowBusy || isSelf || isBootstrap}
                                onClick={() => setDeleteTarget(acc)}
                                title={
                                  isSelf || isBootstrap
                                    ? 'Không thể xóa Admin gốc'
                                    : 'Xóa tài khoản'
                                }
                                className="min-h-[34px] w-8 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 border border-white/10 text-slate-400 hover:text-rose-300 inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Activity Logs Table */}
          {activeTab === 'logs' && (
            <div className="overflow-x-auto">
              {filteredLogs.length === 0 ? (
                <div className="px-6 py-12 text-center text-xs text-slate-400">
                  Chưa có bản ghi lịch sử hoạt động nào khớp bộ lọc.
                </div>
              ) : (
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-medium text-slate-400">
                      <th className="py-3 px-4">Thời gian</th>
                      <th className="py-3 px-3">Người thực hiện</th>
                      <th className="py-3 px-3">Hành động</th>
                      <th className="py-3 px-3">Đối tượng</th>
                      <th className="py-3 px-4">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-xs">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400 whitespace-nowrap tabular-nums">
                          {new Date(log.createdAtMs).toLocaleString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 px-3 text-slate-200 whitespace-nowrap">
                          <span className="font-mono text-[11px]">{log.actorEmail}</span>
                          <span className="text-[10.5px] text-slate-500 ml-1.5">
                            ({log.actorRole})
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-sky-300 font-medium">
                          {ACTION_LABELS[log.action] || log.action}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 truncate max-w-[180px]">
                          {log.targetLabel || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400">{log.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Account Modal */}
      {editorMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-[#0D111A] border border-white/15 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {editorMode === 'create' ? (
                  <Plus className="w-4 h-4 text-sky-400" />
                ) : (
                  <Edit3 className="w-4 h-4 text-sky-400" />
                )}
                <h2 className="text-sm font-semibold text-white">
                  {editorMode === 'create'
                    ? 'Tạo tài khoản mới'
                    : `Chỉnh sửa · ${editingTarget?.email}`}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditorMode(null)}
                className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitEditor} className="p-5 space-y-4 text-xs max-h-[80dvh] overflow-y-auto transcript-scroll">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1" htmlFor="adm-email">
                    Email Google
                  </label>
                  <input
                    id="adm-email"
                    type="email"
                    required
                    disabled={editorMode === 'edit'}
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="nhanvien@gmail.com"
                    className="w-full h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-sky-400 disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1" htmlFor="adm-name">
                    Tên hiển thị
                  </label>
                  <input
                    id="adm-name"
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    className="w-full h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 text-xs focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1" htmlFor="adm-role">
                    Vai trò
                  </label>
                  <select
                    id="adm-role"
                    value={formRole}
                    disabled={
                      editingTarget?.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
                    }
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      setFormRole(nextRole);
                      if (nextRole === 'admin') {
                        setFormPermissions([...ALL_PERMISSIONS]);
                      }
                    }}
                    className="w-full h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 text-xs focus:outline-none focus:border-sky-400 disabled:opacity-60"
                  >
                    <option value="user">User (Người dùng dịch vụ)</option>
                    <option value="admin">Admin (Quản trị viên)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1" htmlFor="adm-status">
                    Trạng thái
                  </label>
                  <select
                    id="adm-status"
                    value={formStatus}
                    disabled={
                      editingTarget?.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
                    }
                    onChange={(e) => setFormStatus(e.target.value as AccountStatus)}
                    className="w-full h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 text-xs focus:outline-none focus:border-sky-400 disabled:opacity-60"
                  >
                    <option value="active">Hoạt động (Active)</option>
                    <option value="locked">Bị khóa (Locked)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1" htmlFor="adm-expiry">
                    Thời hạn sử dụng
                  </label>
                  <select
                    id="adm-expiry"
                    value={formExpiryPreset}
                    onChange={(e) => setFormExpiryPreset(e.target.value as ExpiryPreset)}
                    className="w-full h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 text-xs focus:outline-none focus:border-sky-400"
                  >
                    <option value="7">7 ngày</option>
                    <option value="30">30 ngày (Mặc định)</option>
                    <option value="90">90 ngày</option>
                    <option value="365">365 ngày</option>
                    <option value="unlimited">Vĩnh viễn</option>
                    <option value="custom">Chọn ngày cụ thể</option>
                  </select>
                </div>

                {formExpiryPreset === 'custom' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="adm-custom-date">
                      Ngày hết hạn
                    </label>
                    <input
                      id="adm-custom-date"
                      type="date"
                      value={formCustomDate}
                      onChange={(e) => setFormCustomDate(e.target.value)}
                      className="w-full h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-400"
                    />
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-slate-400">
                    Quyền sử dụng chức năng
                  </span>
                  {formRole === 'admin' && (
                    <span className="text-[11px] text-sky-300">
                      Admin luôn có toàn quyền
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ALL_PERMISSIONS.map((perm) => {
                    const checked = formRole === 'admin' || formPermissions.includes(perm);
                    return (
                      <label
                        key={perm}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-colors cursor-pointer ${
                          checked
                            ? 'bg-sky-500/10 border-sky-400/35 text-slate-100'
                            : 'bg-black/30 border-white/10 text-slate-400'
                        } ${formRole === 'admin' ? 'opacity-70 cursor-default' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={formRole === 'admin'}
                          onChange={() => handleTogglePermission(perm)}
                          className="mt-0.5 accent-sky-400"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium">{PERMISSION_LABELS[perm].label}</div>
                          <div className="text-[10.5px] text-slate-400 leading-snug mt-0.5">
                            {PERMISSION_LABELS[perm].description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1" htmlFor="adm-note">
                  Ghi chú quản trị (tùy chọn)
                </label>
                <input
                  id="adm-note"
                  type="text"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="Ví dụ: Gói Doanh nghiệp Q4, nhân sự phòng kỹ thuật..."
                  className="w-full h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 text-xs focus:outline-none focus:border-sky-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setEditorMode(null)}
                  className="min-h-[38px] px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 font-medium cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingForm}
                  className="min-h-[38px] px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold cursor-pointer disabled:opacity-50"
                >
                  {submittingForm
                    ? 'Đang lưu...'
                    : editorMode === 'create'
                      ? 'Tạo tài khoản'
                      : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Extend Expiry Modal */}
      {extendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-[#0D111A] border border-white/15 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-semibold text-white">Gia hạn tài khoản</h2>
              </div>
              <button
                type="button"
                onClick={() => setExtendTarget(null)}
                className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <div className="font-medium text-white">{extendTarget.displayName}</div>
                <div className="text-[11px] font-mono text-slate-400">{extendTarget.email}</div>
                <div className="mt-1.5 text-[11px] text-slate-300 tabular-nums">
                  Hạn hiện tại: <strong className="text-sky-300">{formatExpiryLabel(extendTarget.expiresAtMs)}</strong>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-400 mb-2">Gia hạn nhanh (tự mở khóa nếu đang hết hạn):</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '+7 ngày', days: 7 },
                    { label: '+30 ngày', days: 30 },
                    { label: '+90 ngày', days: 90 },
                    { label: '+1 năm', days: 365 },
                    { label: 'Vĩnh viễn', days: null },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      disabled={busyId === extendTarget.id}
                      onClick={() => handleApplyQuickExtend(opt.days)}
                      className="min-h-[38px] px-3 rounded-xl bg-white/[0.05] hover:bg-sky-500/20 border border-white/10 hover:border-sky-400/40 text-slate-100 font-medium cursor-pointer disabled:opacity-50"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleApplyCustomExtend} className="pt-3 border-t border-white/10 space-y-2.5">
                <label className="block text-[11px] text-slate-400" htmlFor="extend-custom">
                  Hoặc chọn ngày hết hạn cụ thể:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="extend-custom"
                    type="date"
                    value={extendCustomDate}
                    onChange={(e) => setExtendCustomDate(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-xl bg-black/40 border border-white/15 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="submit"
                    disabled={busyId === extendTarget.id || !extendCustomDate}
                    className="h-9 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    Áp dụng
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-[#0D111A] border border-rose-500/30 p-5 space-y-4 text-xs shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-300 shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Xác nhận xóa tài khoản</h2>
                <p className="text-slate-400 mt-1 leading-relaxed">
                  Bạn có chắc muốn xóa tài khoản{' '}
                  <strong className="text-slate-200">{deleteTarget.email}</strong>? Người dùng này
                  sẽ mất quyền truy cập hiện tại.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[38px] px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 font-medium cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={busyId === deleteTarget.id}
                onClick={handleConfirmDelete}
                className="min-h-[38px] px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                {busyId === deleteTarget.id ? 'Đang xóa...' : 'Xóa tài khoản'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
