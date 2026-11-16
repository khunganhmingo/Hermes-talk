import os from 'os';
import type { McpLogEntry, McpToolDefinition } from '../src/types.ts';

interface MemoryEntry {
  id: string;
  topic: string;
  content: string;
  createdAt: string;
}

interface WorkflowRun {
  executionId: string;
  workflowName: string;
  status: 'COMPLETED' | 'QUEUED';
  triggeredAt: string;
  durationMs: number;
}

const memoryStore: MemoryEntry[] = [
  {
    id: 'mem_901',
    topic: 'Kiến trúc Hermes MCP',
    content: 'Kết nối song công JSON-RPC 2.0 với Gemini Live để truy xuất ngữ cảnh thời gian thực và điều phối công cụ.',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'mem_904',
    topic: 'Lịch trình hôm nay',
    content: '16:00 Họp đồng bộ API Gateway, kiểm thử luồng thoại Gemini Live và rà soát log Hermes MCP.',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'mem_912',
    topic: 'Quy chuẩn Endpoint',
    content: 'Hermes MCP Server hỗ trợ Streamable HTTP (JSON & SSE) cho initialize, tools/list và tools/call.',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
];

const workflowHistory: WorkflowRun[] = [];

export const BUILTIN_HERMES_TOOLS: McpToolDefinition[] = [
  {
    name: 'hermes_search_memory',
    uri: 'hermes://memory/semantic_search',
    description: 'Truy xuất trí nhớ ngữ cảnh, ghi chú, lịch trình và tri thức đã lưu trên Hermes Server.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Từ khóa hoặc câu hỏi cần tìm kiếm trong bộ nhớ Hermes.',
        },
      },
      required: ['query'],
    },
    enabled: true,
    source: 'builtin',
  },
  {
    name: 'hermes_save_memory',
    uri: 'hermes://memory/store',
    description: 'Lưu ghi chú mới, lịch hẹn hoặc thông tin quan trọng vào bộ nhớ Hermes MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Tiêu đề ngắn gọn cho ghi chú cần lưu.',
        },
        content: {
          type: 'string',
          description: 'Nội dung chi tiết cần lưu vào bộ nhớ Hermes.',
        },
      },
      required: ['topic', 'content'],
    },
    enabled: true,
    source: 'builtin',
  },
  {
    name: 'hermes_get_system_status',
    uri: 'hermes://telemetry/cluster_health',
    description: 'Kiểm tra trạng thái máy chủ Hermes MCP, tải CPU, bộ nhớ RAM và thời gian hoạt động.',
    inputSchema: {
      type: 'object',
      properties: {
        detailLevel: {
          type: 'string',
          description: 'Mức chi tiết: summary hoặc full.',
        },
      },
    },
    enabled: true,
    source: 'builtin',
  },
  {
    name: 'hermes_execute_workflow',
    uri: 'hermes://workflows/trigger',
    description: 'Kích hoạt quy trình tự động hóa trên Hermes (ví dụ: daily_sync_pipeline, health_audit, context_backup).',
    inputSchema: {
      type: 'object',
      properties: {
        workflowName: {
          type: 'string',
          description: 'Tên quy trình Hermes cần chạy.',
        },
      },
      required: ['workflowName'],
    },
    enabled: true,
    source: 'builtin',
  },
  {
    name: 'hermes_fetch_docs',
    uri: 'hermes://resources/knowledge_base',
    description: 'Tra cứu tài liệu kỹ thuật, giao thức MCP và hướng dẫn tích hợp Hermes.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Chủ đề tài liệu cần tra cứu.',
        },
      },
    },
    enabled: true,
    source: 'builtin',
  },
];

export function handleLocalHermesRpc(body: {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
}) {
  const id = body.id ?? `rpc-${Date.now()}`;
  const method = body.method ?? '';
  const params = body.params ?? {};

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: {
          name: 'Hermes-MCP-Core',
          version: '2.4.0',
        },
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: false },
        },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return { jsonrpc: '2.0', id, result: { ok: true } };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: BUILTIN_HERMES_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    };
  }

  if (method === 'tools/call') {
    const toolName = String(params.name ?? '');
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const toolResult = executeBuiltinTool(toolName, args);

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(toolResult) }],
        structuredContent: toolResult,
        isError: false,
      },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

function executeBuiltinTool(toolName: string, args: Record<string, unknown>) {
  const now = new Date().toLocaleString('vi-VN');

  switch (toolName) {
    case 'hermes_search_memory': {
      const query = String(args.query ?? '').toLowerCase().trim();
      const keywords = query.split(/\s+/).filter((w) => w.length > 1);
      const matches = memoryStore.filter((entry) => {
        if (!query) return true;
        const haystack = `${entry.topic} ${entry.content}`.toLowerCase();
        return haystack.includes(query) || keywords.some((kw) => haystack.includes(kw));
      });
      return {
        query: args.query ?? '',
        totalMemories: memoryStore.length,
        matches: matches.length > 0 ? matches : memoryStore.slice(0, 2),
      };
    }

    case 'hermes_save_memory': {
      const topic = String(args.topic ?? 'Ghi chú nhanh').trim();
      const content = String(args.content ?? '').trim();
      const entry: MemoryEntry = {
        id: `mem_${Math.floor(1000 + Math.random() * 9000)}`,
        topic,
        content,
        createdAt: new Date().toISOString(),
      };
      memoryStore.unshift(entry);
      return {
        saved: true,
        entry,
        totalMemories: memoryStore.length,
      };
    }

    case 'hermes_get_system_status': {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const load = os.loadavg()[0] ?? 0;
      const cpus = os.cpus().length || 1;
      const uptimeSec = Math.floor(process.uptime());
      const mins = Math.floor(uptimeSec / 60);
      const secs = uptimeSec % 60;

      return {
        cluster: os.hostname() || 'hermes-core-01',
        status: 'HEALTHY',
        uptime: `${mins}m ${secs}s`,
        cpuLoad: `${((load / cpus) * 100).toFixed(1)}% (${cpus} vCPU)`,
        memoryUsage: `${(usedMem / 1073741824).toFixed(2)} GB / ${(totalMem / 1073741824).toFixed(2)} GB`,
        savedMemories: memoryStore.length,
        recentWorkflows: workflowHistory.length,
        timestamp: now,
      };
    }

    case 'hermes_execute_workflow': {
      const workflowName = String(args.workflowName ?? 'daily_sync_pipeline');
      const run: WorkflowRun = {
        executionId: `wf_${Math.floor(100000 + Math.random() * 900000)}`,
        workflowName,
        status: 'COMPLETED',
        triggeredAt: new Date().toISOString(),
        durationMs: 240 + Math.floor(Math.random() * 180),
      };
      workflowHistory.unshift(run);
      return run;
    }

    case 'hermes_fetch_docs': {
      const topic = String(args.topic ?? 'mcp-protocol');
      return {
        resource: 'hermes://docs/mcp-spec-v1',
        topic,
        title: 'Đặc tả giao thức Hermes MCP & Gemini Live Bridge',
        excerpt:
          'Hermes MCP tuân thủ JSON-RPC 2.0 (2025-03-26), hỗ trợ Streamable HTTP và SSE với các phương thức initialize, tools/list, tools/call và resources/read.',
        supportedMethods: ['initialize', 'tools/list', 'tools/call'],
      };
    }

    default:
      return {
        note: `Executed tool ${toolName}`,
        args,
        timestamp: now,
      };
  }
}

async function postJsonRpc(
  endpoint: string,
  token: string | undefined,
  rpcPayload: Record<string, unknown>,
  timeoutMs = 3500
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (token && token.trim()) {
      headers['Authorization'] = `Bearer ${token.trim()}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcPayload),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();

    if (contentType.includes('text/event-stream') || rawText.startsWith('event:') || rawText.startsWith('data:')) {
      const lines = rawText.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('data:')) {
          const jsonPart = line.slice(5).trim();
          if (jsonPart && jsonPart !== '[DONE]') {
            return JSON.parse(jsonPart) as Record<string, unknown>;
          }
        }
      }
      throw new Error('Empty SSE payload from remote MCP server');
    }

    return JSON.parse(rawText) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function makeLog(
  direction: McpLogEntry['direction'],
  endpoint: string,
  payload: unknown
): McpLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    direction,
    endpoint,
    payload,
  };
}

export async function discoverHermesTools(options: {
  endpoint?: string;
  token?: string;
  mode?: 'auto' | 'remote' | 'local';
}): Promise<{
  connectedMode: 'remote' | 'local-bridge';
  endpointUsed: string;
  tools: McpToolDefinition[];
  logs: McpLogEntry[];
  error?: string;
}> {
  const logs: McpLogEntry[] = [];
  const mode = options.mode ?? 'auto';
  const endpoint = (options.endpoint ?? '').trim();

  if (mode !== 'local' && endpoint && !endpoint.startsWith('/api/hermes/mcp')) {
    const initReq = {
      jsonrpc: '2.0',
      id: `init-${Date.now()}`,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'Gemini-Live-Hermes-Bridge', version: '1.0.0' },
      },
    };
    logs.push(makeLog('REQ →', endpoint, initReq));

    try {
      const initRes = await postJsonRpc(endpoint, options.token, initReq, 3000);
      logs.push(makeLog('RES ←', endpoint, initRes));

      const listReq = {
        jsonrpc: '2.0',
        id: `list-${Date.now()}`,
        method: 'tools/list',
        params: {},
      };
      logs.push(makeLog('REQ →', endpoint, listReq));

      const listRes = await postJsonRpc(endpoint, options.token, listReq, 3000);
      logs.push(makeLog('RES ←', endpoint, listRes));

      const rawTools = (listRes.result as { tools?: Array<Record<string, unknown>> } | undefined)?.tools;
      if (Array.isArray(rawTools)) {
        const mappedTools: McpToolDefinition[] = rawTools.map((t) => ({
          name: String(t.name ?? 'unnamed_tool'),
          uri: `hermes://remote/${String(t.name ?? 'tool')}`,
          description: String(t.description ?? 'Remote Hermes MCP tool'),
          inputSchema: (t.inputSchema as McpToolDefinition['inputSchema']) ?? {
            type: 'object',
            properties: {},
          },
          enabled: true,
          source: 'remote',
        }));

        return {
          connectedMode: 'remote',
          endpointUsed: endpoint,
          tools: mappedTools,
          logs,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Remote MCP connection failed';
      logs.push(makeLog('ERR !', endpoint, { error: message }));

      if (mode === 'remote') {
        return {
          connectedMode: 'remote',
          endpointUsed: endpoint,
          tools: [],
          logs,
          error: `Không kết nối được Hermes MCP tại ${endpoint}: ${message}`,
        };
      }
    }
  }

  // Fallback or explicit local Hermes MCP Core
  const localEndpoint = '/api/hermes/mcp';
  const localListReq = {
    jsonrpc: '2.0',
    id: `list-${Date.now()}`,
    method: 'tools/list',
    params: {},
  };
  logs.push(makeLog('REQ →', localEndpoint, localListReq));
  const localListRes = handleLocalHermesRpc(localListReq);
  logs.push(makeLog('RES ←', localEndpoint, localListRes));

  return {
    connectedMode: 'local-bridge',
    endpointUsed: localEndpoint,
    tools: BUILTIN_HERMES_TOOLS,
    logs,
  };
}

export async function invokeHermesTool(options: {
  toolName: string;
  args: Record<string, unknown>;
  endpoint?: string;
  token?: string;
  mode?: 'auto' | 'remote' | 'local';
}): Promise<{
  mode: 'remote' | 'local-bridge';
  uri: string;
  result: unknown;
  logs: McpLogEntry[];
}> {
  const logs: McpLogEntry[] = [];
  const mode = options.mode ?? 'auto';
  const endpoint = (options.endpoint ?? '').trim();

  const rpcRequest = {
    jsonrpc: '2.0',
    id: `call-${Date.now()}`,
    method: 'tools/call',
    params: {
      name: options.toolName,
      arguments: options.args,
    },
  };

  if (mode !== 'local' && endpoint && !endpoint.startsWith('/api/hermes/mcp')) {
    logs.push(makeLog('REQ →', endpoint, rpcRequest));
    try {
      const remoteRes = await postJsonRpc(endpoint, options.token, rpcRequest, 4500);
      logs.push(makeLog('RES ←', endpoint, remoteRes));

      const resultObj = remoteRes.result as
        | { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }
        | undefined;
      let parsedResult: unknown = resultObj;
      if (resultObj?.structuredContent !== undefined) {
        parsedResult = resultObj.structuredContent;
      } else if (Array.isArray(resultObj?.content) && resultObj.content[0]?.text) {
        try {
          parsedResult = JSON.parse(resultObj.content[0].text);
        } catch {
          parsedResult = resultObj.content[0].text;
        }
      }

      return {
        mode: 'remote',
        uri: `hermes://remote/${options.toolName}`,
        result: parsedResult,
        logs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remote call error';
      logs.push(makeLog('ERR !', endpoint, { error: msg, fallback: mode === 'auto' }));
      if (mode === 'remote') {
        return {
          mode: 'remote',
          uri: `hermes://remote/${options.toolName}`,
          result: { error: msg },
          logs,
        };
      }
    }
  }

  const localEndpoint = '/api/hermes/mcp';
  logs.push(makeLog('REQ →', localEndpoint, rpcRequest));
  const localRes = handleLocalHermesRpc(rpcRequest);
  logs.push(makeLog('RES ←', localEndpoint, localRes));

  const builtinTool = BUILTIN_HERMES_TOOLS.find((t) => t.name === options.toolName);
  const structured =
    (localRes as { result?: { structuredContent?: unknown } }).result?.structuredContent ?? localRes;

  return {
    mode: 'local-bridge',
    uri: builtinTool?.uri ?? `hermes://tools/${options.toolName}`,
    result: structured,
    logs,
  };
}
