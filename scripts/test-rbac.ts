import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_PERMISSIONS,
  DAY_MS,
  computeAdminStats,
  computeExtendedExpiryMs,
  evaluateAccountAccess,
  formatExpiryLabel,
  hasPermission,
  normalizePermissions,
  toInviteKey,
} from '../src/lib/rbac.ts';
import { authorizeBackendRequest } from '../server/firebaseAuth.ts';
import type { UserAccount } from '../src/types.ts';

const NOW = 1_760_000_000_000;

function makeAccount(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    displayName: 'Nguyễn Văn A',
    photoURL: '',
    role: 'user',
    status: 'active',
    permissions: ['voice_live', 'text_chat'],
    expiresAtMs: NOW + 30 * DAY_MS,
    note: '',
    ...overrides,
  };
}

test('toInviteKey chuẩn hóa email thành key Firestore an toàn', () => {
  assert.equal(toInviteKey('  User.Name+01@Gmail.COM '), 'user_name_01_gmail_com');
  assert.equal(toInviteKey('taiphanmemtot@gmail.com'), 'taiphanmemtot_gmail_com');
});

test('normalizePermissions lọc các quyền hợp lệ và loại bỏ trùng lặp', () => {
  const result = normalizePermissions([
    'voice_live',
    'unknown_perm',
    'voice_live',
    'hermes_mcp',
    123,
  ]);
  assert.deepEqual(result, ['voice_live', 'hermes_mcp']);
  assert.deepEqual(normalizePermissions(null), []);
});

test('evaluateAccountAccess phân loại chính xác active, expiring_soon, expired và locked', () => {
  const activeUser = makeAccount({ expiresAtMs: NOW + 20 * DAY_MS });
  const activeEval = evaluateAccountAccess(activeUser, NOW);
  assert.equal(activeEval.effectiveStatus, 'active');
  assert.equal(activeEval.canUseApp, true);
  assert.equal(activeEval.isExpiringSoon, false);
  assert.equal(activeEval.isExpired, false);

  const expiringUser = makeAccount({ expiresAtMs: NOW + 3 * DAY_MS });
  const expiringEval = evaluateAccountAccess(expiringUser, NOW);
  assert.equal(expiringEval.effectiveStatus, 'expiring_soon');
  assert.equal(expiringEval.canUseApp, true);
  assert.equal(expiringEval.isExpiringSoon, true);
  assert.equal(expiringEval.remainingDays, 3);

  const expiredUser = makeAccount({ expiresAtMs: NOW - 1000, status: 'active' });
  const expiredEval = evaluateAccountAccess(expiredUser, NOW);
  assert.equal(expiredEval.effectiveStatus, 'expired');
  assert.equal(expiredEval.canUseApp, false);
  assert.equal(expiredEval.isExpired, true);
  assert.equal(expiredEval.isLocked, true);

  const lockedUser = makeAccount({ status: 'locked', expiresAtMs: NOW + 20 * DAY_MS });
  const lockedEval = evaluateAccountAccess(lockedUser, NOW);
  assert.equal(lockedEval.effectiveStatus, 'locked');
  assert.equal(lockedEval.canUseApp, false);
  assert.equal(lockedEval.isExpired, false);
  assert.equal(lockedEval.isLocked, true);

  const unlimitedUser = makeAccount({ expiresAtMs: 0 });
  const unlimitedEval = evaluateAccountAccess(unlimitedUser, NOW);
  assert.equal(unlimitedEval.effectiveStatus, 'active');
  assert.equal(unlimitedEval.canUseApp, true);
  assert.equal(unlimitedEval.remainingDays, Infinity);
});

test('hasPermission kiểm tra phân quyền 2 cấp Admin vs User và tự động chặn khi hết hạn/bị khóa', () => {
  const user = makeAccount({
    role: 'user',
    permissions: ['text_chat', 'tts_preview'],
    expiresAtMs: NOW + 15 * DAY_MS,
  });
  assert.equal(hasPermission(user, 'text_chat', NOW), true);
  assert.equal(hasPermission(user, 'tts_preview', NOW), true);
  assert.equal(hasPermission(user, 'voice_live', NOW), false);
  assert.equal(hasPermission(user, 'hermes_mcp', NOW), false);

  // User hết hạn -> khóa mọi quyền
  const expiredUser = { ...user, expiresAtMs: NOW - 1 };
  assert.equal(hasPermission(expiredUser, 'text_chat', NOW), false);

  // User bị khóa -> khóa mọi quyền
  const lockedUser = { ...user, status: 'locked' as const };
  assert.equal(hasPermission(lockedUser, 'text_chat', NOW), false);

  // Admin luôn có toàn quyền khi đang active
  const admin = makeAccount({
    role: 'admin',
    permissions: [],
    expiresAtMs: 0,
  });
  for (const perm of ALL_PERMISSIONS) {
    assert.equal(hasPermission(admin, perm, NOW), true);
  }
});

test('computeExtendedExpiryMs gia hạn cộng dồn hoặc từ thời điểm hiện tại nếu đã hết hạn', () => {
  // Còn hạn -> cộng tiếp vào hạn hiện tại
  const futureExpiry = NOW + 10 * DAY_MS;
  assert.equal(computeExtendedExpiryMs(futureExpiry, 30, NOW), futureExpiry + 30 * DAY_MS);

  // Đã hết hạn -> tính từ hiện tại
  const pastExpiry = NOW - 5 * DAY_MS;
  assert.equal(computeExtendedExpiryMs(pastExpiry, 7, NOW), NOW + 7 * DAY_MS);

  // Gia hạn vĩnh viễn
  assert.equal(computeExtendedExpiryMs(futureExpiry, null, NOW), 0);
});

test('computeAdminStats thống kê chính xác dashboard Admin', () => {
  const accounts: UserAccount[] = [
    makeAccount({ id: 'a1', role: 'admin', expiresAtMs: 0 }),
    makeAccount({ id: 'u1', expiresAtMs: NOW + 20 * DAY_MS }), // active
    makeAccount({ id: 'u2', expiresAtMs: NOW + 2 * DAY_MS }), // active + expiringSoon
    makeAccount({ id: 'u3', expiresAtMs: NOW - 10_000, status: 'active' }), // expired + locked
    makeAccount({ id: 'u4', status: 'locked', expiresAtMs: NOW + 10 * DAY_MS }), // locked
  ];

  const stats = computeAdminStats(accounts, NOW);
  assert.equal(stats.total, 5);
  assert.equal(stats.active, 3);
  assert.equal(stats.expiringSoon, 1);
  assert.equal(stats.expired, 1);
  assert.equal(stats.locked, 2);
  assert.equal(stats.admins, 1);
  assert.equal(stats.users, 4);
});

test('formatExpiryLabel hiển thị đúng nhãn thời hạn', () => {
  assert.equal(formatExpiryLabel(0, NOW), 'Vĩnh viễn');
  assert.match(formatExpiryLabel(NOW + 5 * DAY_MS, NOW), /^Còn 5 ngày/);
  assert.match(formatExpiryLabel(NOW - 5000, NOW), /^Hết hạn/);
});

test('authorizeBackendRequest từ chối request thiếu hoặc sai token (401)', async () => {
  const missing = await authorizeBackendRequest(undefined, 'text_chat');
  assert.equal(missing.ok, false);
  assert.equal(missing.statusCode, 401);

  const malformed = await authorizeBackendRequest('not.a.valid.jwt', 'voice_live');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.statusCode, 401);
});

test('Hermes MCP hỗ trợ tool hermes_chat trực tiếp và fallback chọn đúng tool', async () => {
  const { BUILTIN_HERMES_TOOLS, handleLocalHermesRpc, pickFallbackHermesTool } = await import(
    '../server/hermesMcp.ts'
  );

  const pickedLocal = pickFallbackHermesTool(BUILTIN_HERMES_TOOLS, 'Xin chào Hermes');
  assert.equal(pickedLocal.toolName, 'hermes_chat');
  assert.equal(pickedLocal.args.message, 'Xin chào Hermes');

  const rpcRes = handleLocalHermesRpc({
    jsonrpc: '2.0',
    id: 'test-1',
    method: 'tools/call',
    params: {
      name: 'hermes_chat',
      arguments: { message: 'Kiểm tra lịch trình hôm nay' },
    },
  }) as {
    result?: {
      structuredContent?: {
        source?: string;
        reply?: string;
      };
    };
  };

  assert.equal(rpcRes.result?.structuredContent?.source, 'Hermes-MCP-Core');
  assert.ok(rpcRes.result?.structuredContent?.reply?.includes('Hermes MCP'));
});
