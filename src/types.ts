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
