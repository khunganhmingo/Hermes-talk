export type AppStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

export interface McpToolDefinition {
  name: string;
  uri: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  enabled: boolean;
  source: 'builtin' | 'remote';
}

export interface McpLogEntry {
  id: string;
  time: string;
  direction: 'REQ →' | 'RES ←' | 'ERR !';
  endpoint: string;
  payload: unknown;
}

export interface McpCallMeta {
  toolName: string;
  uri: string;
  args: Record<string, unknown>;
  result: unknown;
  mode: 'remote' | 'local-bridge';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'gemini';
  text: string;
  timestamp: string;
  mcpCalls?: McpCallMeta[];
  isInterim?: boolean;
}

export interface ConversationSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export type GeminiVoiceName = 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir';

export interface McpConfig {
  endpoint: string;
  token: string;
  mode: 'auto' | 'remote' | 'local';
  voiceName: GeminiVoiceName;
  speakTextReplies: boolean;
}

export type UserRole = 'admin' | 'user';
export type AccountStatus = 'active' | 'locked';
export type FeaturePermission = 'voice_live' | 'text_chat' | 'hermes_mcp' | 'tts_preview';

export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: UserRole;
  status: AccountStatus;
  permissions: FeaturePermission[];
  expiresAtMs: number;
  note: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  lastLoginAtMs?: number;
  isPendingInvite?: boolean;
}

export type EffectiveAccountState = 'active' | 'expiring_soon' | 'expired' | 'locked';

export interface AccountAccessEvaluation {
  effectiveStatus: EffectiveAccountState;
  canUseApp: boolean;
  isExpired: boolean;
  isExpiringSoon: boolean;
  isLocked: boolean;
  remainingMs: number;
  remainingDays: number;
  reason: string | null;
}

export interface AdminStats {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  locked: number;
  admins: number;
  users: number;
}

export type ActivityAction =
  | 'login'
  | 'logout'
  | 'create_user'
  | 'update_user'
  | 'lock_user'
  | 'unlock_user'
  | 'extend_user'
  | 'delete_user'
  | 'auto_expire_lock'
  | 'update_profile'
  | 'use_voice_live'
  | 'use_text_chat'
  | 'use_hermes_mcp'
  | 'use_tts_preview';

export interface ActivityLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: UserRole;
  action: ActivityAction;
  targetId: string;
  targetLabel: string;
  detail: string;
  createdAtMs: number;
}
