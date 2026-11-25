import type {
  AccountAccessEvaluation,
  AdminStats,
  FeaturePermission,
  UserAccount,
} from '../types.ts';

export const BOOTSTRAP_ADMIN_EMAIL = 'taiphanmemtot@gmail.com';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRING_SOON_WINDOW_MS = 7 * DAY_MS;
export const DEFAULT_TRIAL_DAYS = 30;

export const ALL_PERMISSIONS: FeaturePermission[] = [
  'voice_live',
  'text_chat',
  'hermes_mcp',
  'tts_preview',
];

export const PERMISSION_LABELS: Record<
  FeaturePermission,
  { label: string; description: string }
> = {
  voice_live: {
    label: 'Gemini Live Thoại',
    description: 'Trò chuyện giọng nói hai chiều thời gian thực qua WebSocket',
  },
  text_chat: {
    label: 'Chat Văn bản',
    description: 'Nhắn tin và nhận phản hồi từ Gemini kèm lịch sử hội thoại',
  },
  hermes_mcp: {
    label: 'Hermes MCP Tools',
    description: 'Kích hoạt và gọi công cụ từ Hermes MCP Server',
  },
  tts_preview: {
    label: 'Đọc giọng nói TTS',
    description: 'Nghe lại hoặc nghe thử giọng đọc tiếng Việt của Google Gemini',
  },
};

export function toInviteKey(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_');
}

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

export function normalizePermissions(perms?: unknown): FeaturePermission[] {
  if (!Array.isArray(perms)) return [];
  const valid = new Set<FeaturePermission>();
  for (const item of perms) {
    if (typeof item === 'string' && ALL_PERMISSIONS.includes(item as FeaturePermission)) {
      valid.add(item as FeaturePermission);
    }
  }
  return Array.from(valid);
}

export function evaluateAccountAccess(
  account: Pick<UserAccount, 'role' | 'status' | 'expiresAtMs' | 'permissions'>,
  nowMs: number = Date.now()
): AccountAccessEvaluation {
  if (account.status === 'locked') {
    const isAlsoExpired = account.expiresAtMs > 0 && nowMs >= account.expiresAtMs;
    return {
      effectiveStatus: isAlsoExpired ? 'expired' : 'locked',
      canUseApp: false,
      isExpired: isAlsoExpired,
      isExpiringSoon: false,
      isLocked: true,
      remainingMs: isAlsoExpired ? 0 : account.expiresAtMs > 0 ? account.expiresAtMs - nowMs : Infinity,
      remainingDays: 0,
      reason: isAlsoExpired
        ? 'Tài khoản đã hết hạn sử dụng và bị khóa tự động. Vui lòng liên hệ Quản trị viên để gia hạn.'
        : 'Tài khoản hiện đang bị Quản trị viên tạm khóa.',
    };
  }

  if (account.expiresAtMs > 0) {
    const remainingMs = account.expiresAtMs - nowMs;
    if (remainingMs <= 0) {
      return {
        effectiveStatus: 'expired',
        canUseApp: false,
        isExpired: true,
        isExpiringSoon: false,
        isLocked: true,
        remainingMs: 0,
        remainingDays: 0,
        reason: 'Tài khoản đã hết hạn sử dụng và tự động khóa quyền truy cập. Vui lòng liên hệ Admin để gia hạn.',
      };
    }

    const remainingDays = Math.ceil(remainingMs / DAY_MS);
    if (remainingMs <= EXPIRING_SOON_WINDOW_MS) {
      return {
        effectiveStatus: 'expiring_soon',
        canUseApp: true,
        isExpired: false,
        isExpiringSoon: true,
        isLocked: false,
        remainingMs,
        remainingDays,
        reason: null,
      };
    }

    return {
      effectiveStatus: 'active',
      canUseApp: true,
      isExpired: false,
      isExpiringSoon: false,
      isLocked: false,
      remainingMs,
      remainingDays,
      reason: null,
    };
  }

  return {
    effectiveStatus: 'active',
    canUseApp: true,
    isExpired: false,
    isExpiringSoon: false,
    isLocked: false,
    remainingMs: Infinity,
    remainingDays: Infinity,
    reason: null,
  };
}

export function hasPermission(
  account: Pick<UserAccount, 'role' | 'status' | 'expiresAtMs' | 'permissions'> | null | undefined,
  permission: FeaturePermission,
  nowMs: number = Date.now()
): boolean {
  if (!account) return false;
  const evalResult = evaluateAccountAccess(account, nowMs);
  if (!evalResult.canUseApp) return false;
  if (account.role === 'admin') return true;
  return account.permissions.includes(permission);
}

export function computeExtendedExpiryMs(
  currentExpiresAtMs: number,
  daysToAdd: number | null,
  nowMs: number = Date.now()
): number {
  if (daysToAdd === null || daysToAdd <= 0) {
    return 0;
  }
  const baseMs = currentExpiresAtMs > nowMs ? currentExpiresAtMs : nowMs;
  return baseMs + daysToAdd * DAY_MS;
}

export function computeAdminStats(
  accounts: UserAccount[],
  nowMs: number = Date.now()
): AdminStats {
  const stats: AdminStats = {
    total: accounts.length,
    active: 0,
    expiringSoon: 0,
    expired: 0,
    locked: 0,
    admins: 0,
    users: 0,
  };

  for (const acc of accounts) {
    if (acc.role === 'admin') stats.admins += 1;
    else stats.users += 1;

    const evalResult = evaluateAccountAccess(acc, nowMs);
    if (evalResult.effectiveStatus === 'active') stats.active += 1;
    else if (evalResult.effectiveStatus === 'expiring_soon') {
      stats.active += 1;
      stats.expiringSoon += 1;
    } else if (evalResult.effectiveStatus === 'expired') {
      stats.expired += 1;
      stats.locked += 1;
    } else if (evalResult.effectiveStatus === 'locked') {
      stats.locked += 1;
    }
  }

  return stats;
}

export function formatExpiryLabel(
  expiresAtMs: number,
  nowMs: number = Date.now()
): string {
  if (!expiresAtMs || expiresAtMs <= 0) return 'Vĩnh viễn';
  const diff = expiresAtMs - nowMs;
  const dateText = new Date(expiresAtMs).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  if (diff <= 0) return `Hết hạn (${dateText})`;
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 24) {
    return `Còn ${Math.max(1, hours)} giờ (${dateText})`;
  }
  const days = Math.ceil(diff / DAY_MS);
  return `Còn ${days} ngày (${dateText})`;
}
