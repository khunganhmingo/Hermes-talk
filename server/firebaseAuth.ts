import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FeaturePermission, UserAccount } from '../src/types.ts';
import {
  ALL_PERMISSIONS,
  BOOTSTRAP_ADMIN_EMAIL,
  evaluateAccountAccess,
  hasPermission,
  normalizePermissions,
} from '../src/lib/rbac.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseConfigJson {
  projectId: string;
  firestoreDatabaseId: string;
  apiKey: string;
}

const configPath = path.resolve(__dirname, '..', 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as FirebaseConfigJson;

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> = {};
let certsExpireAtMs = 0;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < certsExpireAtMs && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error('Không thể tải chứng chỉ xác thực Firebase Auth.');
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await res.json()) as Record<string, string>;
  certsExpireAtMs = now + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, 'base64');
}

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseToken> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Token đăng nhập không hợp lệ.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlToBuffer(headerB64).toString('utf-8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(base64UrlToBuffer(payloadB64).toString('utf-8')) as {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Thuật toán xác thực token không hợp lệ.');
  }

  const certs = await getGooglePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Không tìm thấy khóa công khai xác thực Firebase.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signatureValid = verifier.verify(cert, base64UrlToBuffer(signatureB64));
  if (!signatureValid) {
    throw new Error('Chữ ký token không hợp lệ.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
  if (payload.aud !== firebaseConfig.projectId) {
    throw new Error('Token không thuộc dự án Firebase hiện tại.');
  }
  if (payload.iss !== `https://securetoken.google.com/${firebaseConfig.projectId}`) {
    throw new Error('Nhà phát hành token không hợp lệ.');
  }
  if (!payload.sub) {
    throw new Error('Token thiếu định danh người dùng.');
  }
  if (!payload.email_verified) {
    throw new Error('Email tài khoản chưa được xác minh.');
  }

  return {
    uid: payload.sub,
    email: (payload.email || '').toLowerCase(),
    emailVerified: Boolean(payload.email_verified),
    name: payload.name,
  };
}

function parseFirestoreValue(field: Record<string, unknown> | undefined): unknown {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('booleanValue' in field) return Boolean(field.booleanValue);
  if ('arrayValue' in field) {
    const vals = (field.arrayValue as { values?: Array<Record<string, unknown>> })?.values ?? [];
    return vals.map((v) => parseFirestoreValue(v));
  }
  return undefined;
}

export async function fetchUserAccountFromFirestore(
  uid: string,
  idToken: string,
  tokenEmail: string,
  tokenName?: string
): Promise<UserAccount> {
  const docUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${encodeURIComponent(uid)}`;
  const res = await fetch(docUrl, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (res.status === 404) {
    if (tokenEmail === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
      return {
        id: uid,
        email: tokenEmail,
        displayName: tokenName || 'Quản trị viên',
        photoURL: '',
        role: 'admin',
        status: 'active',
        permissions: [...ALL_PERMISSIONS],
        expiresAtMs: 0,
        note: '',
      };
    }
    throw new Error('Hồ sơ tài khoản chưa được khởi tạo. Vui lòng tải lại trang hoặc đăng nhập lại.');
  }

  if (!res.ok) {
    throw new Error('Không thể xác minh trạng thái tài khoản từ cơ sở dữ liệu.');
  }

  const docJson = (await res.json()) as {
    fields?: Record<string, Record<string, unknown>>;
  };
  const f = docJson.fields ?? {};

  return {
    id: uid,
    email: String(parseFirestoreValue(f.email) ?? tokenEmail),
    displayName: String(parseFirestoreValue(f.displayName) ?? tokenName ?? 'Người dùng'),
    photoURL: String(parseFirestoreValue(f.photoURL) ?? ''),
    role: parseFirestoreValue(f.role) === 'admin' ? 'admin' : 'user',
    status: parseFirestoreValue(f.status) === 'locked' ? 'locked' : 'active',
    permissions: normalizePermissions(parseFirestoreValue(f.permissions)),
    expiresAtMs: Number(parseFirestoreValue(f.expiresAtMs) ?? 0),
    note: String(parseFirestoreValue(f.note) ?? ''),
  };
}

export async function authorizeBackendRequest(
  idToken: string | undefined,
  requiredPermission?: FeaturePermission
): Promise<{
  ok: boolean;
  statusCode: number;
  error?: string;
  account?: UserAccount;
}> {
  if (!idToken) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Vui lòng đăng nhập tài khoản để sử dụng tính năng này.',
    };
  }

  try {
    const claims = await verifyFirebaseIdToken(idToken);
    const account = await fetchUserAccountFromFirestore(
      claims.uid,
      idToken,
      claims.email,
      claims.name
    );

    const access = evaluateAccountAccess(account);
    if (!access.canUseApp) {
      // If expired while still marked active, patch status=locked on Firestore using user's token
      if (access.isExpired && account.status === 'active') {
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${encodeURIComponent(claims.uid)}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt`;
        await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: {
              status: { stringValue: 'locked' },
              updatedAt: { timestampValue: new Date().toISOString() },
            },
          }),
        }).catch(() => {});
      }

      return {
        ok: false,
        statusCode: 403,
        error: access.reason || 'Tài khoản không có quyền truy cập.',
        account,
      };
    }

    if (requiredPermission && !hasPermission(account, requiredPermission)) {
      return {
        ok: false,
        statusCode: 403,
        error: `Tài khoản của bạn chưa được Admin cấp quyền "${requiredPermission}".`,
        account,
      };
    }

    return { ok: true, statusCode: 200, account };
  } catch (err) {
    return {
      ok: false,
      statusCode: 401,
      error: err instanceof Error ? err.message : 'Xác thực phiên đăng nhập thất bại.',
    };
  }
}
