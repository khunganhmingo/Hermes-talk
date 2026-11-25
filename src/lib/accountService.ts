import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  AccountStatus,
  ActivityAction,
  ActivityLog,
  FeaturePermission,
  UserAccount,
  UserRole,
} from '../types';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  ALL_PERMISSIONS,
  BOOTSTRAP_ADMIN_EMAIL,
  computeExtendedExpiryMs,
  DAY_MS,
  DEFAULT_TRIAL_DAYS,
  evaluateAccountAccess,
  normalizePermissions,
  sanitizeId,
  toInviteKey,
} from './rbac';

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

function mapUserDoc(id: string, data: Record<string, unknown>, isPendingInvite = false): UserAccount {
  return {
    id,
    email: String(data.email || '').slice(0, 160),
    displayName: String(data.displayName || 'Người dùng').slice(0, 120),
    photoURL: String(data.photoURL || '').slice(0, 500),
    role: data.role === 'admin' ? 'admin' : 'user',
    status: data.status === 'locked' ? 'locked' : 'active',
    permissions: normalizePermissions(data.permissions),
    expiresAtMs: typeof data.expiresAtMs === 'number' ? data.expiresAtMs : 0,
    note: String(data.note || '').slice(0, 500),
    createdAtMs: toMillis(data.createdAt),
    updatedAtMs: toMillis(data.updatedAt),
    lastLoginAtMs: data.lastLoginAt ? toMillis(data.lastLoginAt) : undefined,
    isPendingInvite,
  };
}

export async function recordActivityLog(params: {
  actorUid: string;
  actorEmail: string;
  actorRole: UserRole;
  action: ActivityAction;
  targetId?: string;
  targetLabel?: string;
  detail: string;
}): Promise<void> {
  const logId = sanitizeId(`log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const path = `activityLogs/${logId}`;
  try {
    await setDoc(doc(db, 'activityLogs', logId), {
      id: logId,
      actorUid: params.actorUid.slice(0, 128),
      actorEmail: (params.actorEmail || 'unknown@local').slice(0, 160),
      actorRole: params.actorRole,
      action: params.action,
      targetId: (params.targetId || '').slice(0, 128),
      targetLabel: (params.targetLabel || '').slice(0, 160),
      detail: (params.detail || 'Hoạt động hệ thống').slice(0, 300),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function syncUserAccountOnLogin(firebaseUser: User): Promise<UserAccount> {
  const uid = firebaseUser.uid;
  const email = (firebaseUser.email || '').trim().toLowerCase();
  const isBootstrap = email === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  const userRef = doc(db, 'users', uid);
  const userPath = `users/${uid}`;

  let existingSnap;
  try {
    existingSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!existingSnap.exists()) {
    const inviteKey = email ? toInviteKey(email) : '';
    let inviteData: Record<string, unknown> | null = null;

    if (inviteKey) {
      try {
        const inviteSnap = await getDoc(doc(db, 'userInvites', inviteKey));
        if (inviteSnap.exists()) {
          inviteData = inviteSnap.data() as Record<string, unknown>;
        }
      } catch {
        // Ignore if no invite exists
      }
    }

    const role: UserRole = isBootstrap
      ? 'admin'
      : inviteData?.role === 'admin'
        ? 'admin'
        : 'user';
    const status: AccountStatus = isBootstrap
      ? 'active'
      : inviteData?.status === 'locked'
        ? 'locked'
        : 'active';
    const permissions: FeaturePermission[] = isBootstrap
      ? [...ALL_PERMISSIONS]
      : inviteData
        ? normalizePermissions(inviteData.permissions)
        : [...ALL_PERMISSIONS];
    const expiresAtMs = isBootstrap
      ? 0
      : typeof inviteData?.expiresAtMs === 'number'
        ? inviteData.expiresAtMs
        : Date.now() + DEFAULT_TRIAL_DAYS * DAY_MS;

    const displayName = (
      firebaseUser.displayName ||
      (typeof inviteData?.displayName === 'string' ? inviteData.displayName : '') ||
      email.split('@')[0] ||
      'Người dùng mới'
    ).slice(0, 120);
    const photoURL = (firebaseUser.photoURL || '').slice(0, 500);
    const note = (typeof inviteData?.note === 'string' ? inviteData.note : '').slice(0, 500);

    try {
      await setDoc(userRef, {
        id: uid,
        email: email.slice(0, 160),
        displayName,
        photoURL,
        role,
        status,
        permissions,
        expiresAtMs,
        note,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }

    if (inviteKey && inviteData && !inviteData.claimedUid) {
      try {
        await updateDoc(doc(db, 'userInvites', inviteKey), {
          claimedUid: uid,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-fatal if invite was already claimed
      }
    }

    await recordActivityLog({
      actorUid: uid,
      actorEmail: email,
      actorRole: role,
      action: 'login',
      targetId: uid,
      targetLabel: displayName,
      detail: `Đăng nhập lần đầu thành công (${role === 'admin' ? 'Quản trị viên' : 'Người dùng'}).`,
    });

    return {
      id: uid,
      email,
      displayName,
      photoURL,
      role,
      status,
      permissions,
      expiresAtMs,
      note,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      lastLoginAtMs: Date.now(),
    };
  }

  const account = mapUserDoc(uid, existingSnap.data() as Record<string, unknown>);
  const access = evaluateAccountAccess(account);

  // Auto-lock when expired on login
  if (access.isExpired && account.status === 'active') {
    try {
      await updateDoc(userRef, {
        status: 'locked',
        updatedAt: serverTimestamp(),
      });
      account.status = 'locked';
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    }

    await recordActivityLog({
      actorUid: uid,
      actorEmail: account.email,
      actorRole: account.role,
      action: 'auto_expire_lock',
      targetId: uid,
      targetLabel: account.displayName,
      detail: 'Hệ thống tự động khóa tài khoản do đã hết thời hạn sử dụng.',
    });
  } else {
    const nextDisplayName = (firebaseUser.displayName || account.displayName).slice(0, 120);
    const nextPhotoURL = (firebaseUser.photoURL || account.photoURL || '').slice(0, 500);
    try {
      await updateDoc(userRef, {
        displayName: nextDisplayName,
        photoURL: nextPhotoURL,
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      account.displayName = nextDisplayName;
      account.photoURL = nextPhotoURL;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    }

    await recordActivityLog({
      actorUid: uid,
      actorEmail: account.email,
      actorRole: account.role,
      action: 'login',
      targetId: uid,
      targetLabel: account.displayName,
      detail: `Đăng nhập hệ thống (${account.role === 'admin' ? 'Admin' : 'User'}).`,
    });
  }

  return account;
}

export async function autoLockExpiredAccount(account: UserAccount): Promise<void> {
  if (account.status !== 'active' || !account.expiresAtMs || Date.now() < account.expiresAtMs) {
    return;
  }
  const path = `users/${account.id}`;
  try {
    await updateDoc(doc(db, 'users', account.id), {
      status: 'locked',
      updatedAt: serverTimestamp(),
    });
    await recordActivityLog({
      actorUid: account.id,
      actorEmail: account.email,
      actorRole: account.role,
      action: 'auto_expire_lock',
      targetId: account.id,
      targetLabel: account.displayName,
      detail: 'Tự động khóa quyền truy cập khi tài khoản hết hạn.',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeUserAccount(
  uid: string,
  onData: (account: UserAccount | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(mapUserDoc(snap.id, snap.data() as Record<string, unknown>));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (e) {
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );
}

export function subscribeAllUsers(
  onData: (accounts: UserAccount[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  let userDocs: UserAccount[] = [];
  let inviteDocs: Array<UserAccount & { claimedUid: string }> = [];

  const emitMerged = () => {
    const signedInEmails = new Set(userDocs.map((u) => u.email.toLowerCase()));
    const claimedIds = new Set(
      inviteDocs.filter((inv) => inv.claimedUid).map((inv) => inv.id)
    );

    const activeUsers = userDocs.filter((u) => !claimedIds.has(u.id));
    const pendingUsers = inviteDocs
      .filter((inv) => !inv.claimedUid && !signedInEmails.has(inv.email.toLowerCase()))
      .map(({ claimedUid: _c, ...rest }) => rest);

    const combined = [...activeUsers, ...pendingUsers].sort(
      (a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0)
    );
    onData(combined);
  };

  const unsubUsers = onSnapshot(
    collection(db, 'users'),
    (snap) => {
      userDocs = snap.docs.map((d) => mapUserDoc(d.id, d.data() as Record<string, unknown>, false));
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'users');
      } catch (e) {
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const unsubInvites = onSnapshot(
    collection(db, 'userInvites'),
    (snap) => {
      inviteDocs = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          ...mapUserDoc(d.id, raw, true),
          claimedUid: String(raw.claimedUid || ''),
        };
      });
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'userInvites');
      } catch (e) {
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  return () => {
    unsubUsers();
    unsubInvites();
  };
}

export function subscribeActivityLogs(
  isAdminView: boolean,
  uid: string,
  onData: (logs: ActivityLog[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = isAdminView
    ? query(collection(db, 'activityLogs'), orderBy('createdAt', 'desc'), limit(120))
    : query(collection(db, 'activityLogs'), where('actorUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const parsed: ActivityLog[] = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          actorUid: String(raw.actorUid || ''),
          actorEmail: String(raw.actorEmail || ''),
          actorRole: raw.actorRole === 'admin' ? 'admin' : 'user',
          action: (raw.action as ActivityAction) || 'login',
          targetId: String(raw.targetId || ''),
          targetLabel: String(raw.targetLabel || ''),
          detail: String(raw.detail || ''),
          createdAtMs: toMillis(raw.createdAt),
        };
      });
      parsed.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(parsed.slice(0, 100));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'activityLogs');
      } catch (e) {
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );
}

export async function adminCreateUser(
  payload: {
    email: string;
    displayName: string;
    role: UserRole;
    status: AccountStatus;
    permissions: FeaturePermission[];
    expiresAtMs: number;
    note: string;
  },
  actor: UserAccount
): Promise<void> {
  const cleanEmail = payload.email.trim().toLowerCase().slice(0, 160);
  const inviteId = sanitizeId(toInviteKey(cleanEmail));
  const cleanName = payload.displayName.trim().slice(0, 120) || cleanEmail.split('@')[0];
  const cleanNote = payload.note.trim().slice(0, 500);
  const perms = normalizePermissions(payload.permissions);

  const invitePath = `userInvites/${inviteId}`;
  try {
    await setDoc(doc(db, 'userInvites', inviteId), {
      id: inviteId,
      email: cleanEmail,
      displayName: cleanName,
      role: payload.role,
      status: payload.status,
      permissions: perms,
      expiresAtMs: Math.max(0, payload.expiresAtMs),
      note: cleanNote,
      claimedUid: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, invitePath);
  }

  await recordActivityLog({
    actorUid: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'create_user',
    targetId: inviteId,
    targetLabel: `${cleanName} (${cleanEmail})`,
    detail: `Tạo tài khoản mới · Quyền: ${payload.role === 'admin' ? 'Admin' : 'User'} · Trạng thái: ${payload.status}.`,
  });
}

export async function adminUpdateUser(
  target: UserAccount,
  updates: {
    displayName: string;
    role: UserRole;
    status: AccountStatus;
    permissions: FeaturePermission[];
    expiresAtMs: number;
    note: string;
  },
  actor: UserAccount
): Promise<void> {
  const cleanName = updates.displayName.trim().slice(0, 120) || target.displayName;
  const cleanNote = updates.note.trim().slice(0, 500);
  const perms = normalizePermissions(updates.permissions);
  const expiresAtMs = Math.max(0, updates.expiresAtMs);

  if (target.isPendingInvite) {
    const path = `userInvites/${target.id}`;
    try {
      await updateDoc(doc(db, 'userInvites', target.id), {
        displayName: cleanName,
        role: updates.role,
        status: updates.status,
        permissions: perms,
        expiresAtMs,
        note: cleanNote,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    const path = `users/${target.id}`;
    try {
      await updateDoc(doc(db, 'users', target.id), {
        displayName: cleanName,
        role: updates.role,
        status: updates.status,
        permissions: perms,
        expiresAtMs,
        note: cleanNote,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    if (updates.role !== target.role && target.id !== actor.id) {
      const adminDocRef = doc(db, 'admins', target.id);
      try {
        if (updates.role === 'admin') {
          await setDoc(adminDocRef, {
            uid: target.id,
            email: target.email,
            addedBy: actor.id,
            createdAt: serverTimestamp(),
          });
        } else {
          await deleteDoc(adminDocRef);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `admins/${target.id}`);
      }
    }
  }

  await recordActivityLog({
    actorUid: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'update_user',
    targetId: target.id,
    targetLabel: `${cleanName} (${target.email})`,
    detail: `Cập nhật thông tin tài khoản · Vai trò: ${updates.role} · Quyền: ${perms.length}.`,
  });
}

export async function adminToggleUserLock(
  target: UserAccount,
  actor: UserAccount
): Promise<void> {
  const nextStatus: AccountStatus = target.status === 'locked' ? 'active' : 'locked';
  const colName = target.isPendingInvite ? 'userInvites' : 'users';
  const path = `${colName}/${target.id}`;

  try {
    await updateDoc(doc(db, colName, target.id), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  await recordActivityLog({
    actorUid: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: nextStatus === 'locked' ? 'lock_user' : 'unlock_user',
    targetId: target.id,
    targetLabel: `${target.displayName} (${target.email})`,
    detail:
      nextStatus === 'locked'
        ? 'Quản trị viên đã khóa quyền truy cập tài khoản.'
        : 'Quản trị viên đã mở khóa tài khoản.',
  });
}

export async function adminExtendUserExpiry(
  target: UserAccount,
  daysToAdd: number | null,
  actor: UserAccount
): Promise<void> {
  const nextExpiryMs = computeExtendedExpiryMs(target.expiresAtMs, daysToAdd);
  const colName = target.isPendingInvite ? 'userInvites' : 'users';
  const path = `${colName}/${target.id}`;

  try {
    await updateDoc(doc(db, colName, target.id), {
      expiresAtMs: nextExpiryMs,
      status: 'active',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  await recordActivityLog({
    actorUid: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'extend_user',
    targetId: target.id,
    targetLabel: `${target.displayName} (${target.email})`,
    detail:
      daysToAdd === null
        ? 'Gia hạn thời hạn sử dụng thành Vĩnh viễn và mở khóa hoạt động.'
        : `Gia hạn thêm ${daysToAdd} ngày sử dụng và kích hoạt tài khoản.`,
  });
}

export async function adminDeleteUser(
  target: UserAccount,
  actor: UserAccount
): Promise<void> {
  const colName = target.isPendingInvite ? 'userInvites' : 'users';
  const path = `${colName}/${target.id}`;

  try {
    await deleteDoc(doc(db, colName, target.id));
    if (!target.isPendingInvite) {
      const inviteId = toInviteKey(target.email);
      await deleteDoc(doc(db, 'userInvites', inviteId)).catch(() => {});
      await deleteDoc(doc(db, 'admins', target.id)).catch(() => {});
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  await recordActivityLog({
    actorUid: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'delete_user',
    targetId: target.id,
    targetLabel: `${target.displayName} (${target.email})`,
    detail: 'Quản trị viên đã xóa tài khoản khỏi hệ thống.',
  });
}

export async function userUpdateOwnProfile(
  account: UserAccount,
  displayName: string
): Promise<void> {
  const cleanName = displayName.trim().slice(0, 120);
  if (!cleanName) throw new Error('Tên hiển thị không được để trống.');
  const path = `users/${account.id}`;

  try {
    await updateDoc(doc(db, 'users', account.id), {
      displayName: cleanName,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  await recordActivityLog({
    actorUid: account.id,
    actorEmail: account.email,
    actorRole: account.role,
    action: 'update_profile',
    targetId: account.id,
    targetLabel: cleanName,
    detail: `Người dùng cập nhật tên hiển thị thành "${cleanName}".`,
  });
}
