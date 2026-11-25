import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  FunctionCallingConfigMode,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
  type Content,
} from '@google/genai';
import {
  ai,
  GEMINI_HERMES_ROUTER_INSTRUCTION,
  GEMINI_HERMES_TRANSLATOR_INSTRUCTION,
  GEMINI_LIVE_SYSTEM_INSTRUCTION,
  toGeminiFunctionDeclarations,
} from './server/geminiClient.ts';
import {
  BUILTIN_HERMES_TOOLS,
  discoverHermesTools,
  handleLocalHermesRpc,
  invokeHermesTool,
  pickFallbackHermesTool,
} from './server/hermesMcp.ts';
import { authorizeBackendRequest } from './server/firebaseAuth.ts';
import { evaluateAccountAccess, hasPermission } from './src/lib/rbac.ts';
import type { GeminiVoiceName, McpCallMeta, McpLogEntry, McpToolDefinition } from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_VOICES: GeminiVoiceName[] = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'];

function extractBearerToken(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Built-in Hermes MCP Streamable HTTP JSON-RPC 2.0 endpoint
  app.post('/api/hermes/mcp', (req, res) => {
    const rpcResponse = handleLocalHermesRpc(req.body ?? {});
    res.json(rpcResponse);
  });

  // Verify authenticated user's account role, permissions & expiration on backend
  app.get('/api/account/me', async (req, res) => {
    const token = extractBearerToken(req);
    const authCheck = await authorizeBackendRequest(token);
    if (!authCheck.ok || !authCheck.account) {
      res.status(authCheck.statusCode).json({
        error: authCheck.error || 'Chưa xác thực',
        account: authCheck.account ?? null,
      });
      return;
    }
    res.json({
      account: authCheck.account,
      access: evaluateAccountAccess(authCheck.account),
    });
  });

  // Check server-side Gemini API connection status (never exposes key)
  app.get('/api/gemini/status', async (req, res) => {
    const availableModels = [
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
      'gemini-3.8-live',
      'gemini-3.8-flash-lite-tts',
    ];
    const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
    if (!hasKey) {
      res.json({
        configured: false,
        connected: false,
        models: availableModels,
        message: 'Chưa phát hiện GEMINI_API_KEY trong Settings > Secrets.',
      });
      return;
    }

    const shouldVerify = req.query.verify === 'true';
    const requestedModel =
      typeof req.query.model === 'string' && availableModels.includes(req.query.model)
        ? req.query.model
        : 'gemini-4-hydrogen';

    if (!shouldVerify) {
      res.json({
        configured: true,
        connected: true,
        models: availableModels,
        message: 'Đã kết nối qua GEMINI_API_KEY máy chủ.',
      });
      return;
    }

    try {
      const verifyPromise = (async () => {
        if (requestedModel === 'gemini-3.8-live') {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            ai.live
              .connect({
                model: 'gemini-3.8-live',
                config: { responseModalities: [Modality.AUDIO] },
                callbacks: {
                  onopen: () => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  },
                  onmessage: () => {},
                  onerror: (err: unknown) => {
                    if (!settled) {
                      settled = true;
                      reject(err instanceof Error ? err : new Error('Lỗi kết nối Gemini Live'));
                    }
                  },
                  onclose: () => {
                    if (!settled) {
                      settled = true;
                      reject(new Error('Phiên Gemini Live đã đóng trước khi mở'));
                    }
                  },
                },
              })
              .then((liveSession) => {
                try {
                  liveSession.close();
                } catch {
                  // Ignore close error
                }
              })
              .catch((err) => {
                if (!settled) {
                  settled = true;
                  reject(err);
                }
              });
          });
          return true;
        }

        if (requestedModel === 'gemini-3.8-flash-lite-tts') {
          const ttsRes = await ai.models.generateContent({
            model: 'gemini-3.8-flash-lite-tts',
            contents: [{ role: 'user', parts: [{ text: 'Xin chào' }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
              },
            },
          });
          return Boolean(ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data);
        }

        const check = await ai.models.generateContent({
          model: requestedModel,
          contents: 'OK',
          config:
            requestedModel === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : undefined,
        });
        return Boolean(check.text !== undefined);
      })();

      const ok = await Promise.race([
        verifyPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Quá thời gian phản hồi từ Gemini API (15s).')), 15000)
        ),
      ]);

      res.json({
        configured: true,
        connected: ok,
        models: availableModels,
        message: `Model ${requestedModel} kết nối hoạt động bình thường.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể xác thực Gemini API.';
      res.status(502).json({
        configured: true,
        connected: false,
        models: availableModels,
        message: msg,
      });
    }
  });

  // Discover tools & ping external or built-in Hermes MCP server
  app.post('/api/hermes/ping', async (req, res) => {
    try {
      const { endpoint, token, mode } = req.body as {
        endpoint?: string;
        token?: string;
        mode?: 'auto' | 'remote' | 'local';
      };
      const discovery = await discoverHermesTools({ endpoint, token, mode });
      res.json(discovery);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to ping Hermes MCP';
      res.status(500).json({ error: message });
    }
  });

  // Google Gemini Neural Text-to-Speech (Vietnamese & multilingual)
  app.post('/api/tts', async (req, res) => {
    try {
      const authCheck = await authorizeBackendRequest(extractBearerToken(req), 'tts_preview');
      if (!authCheck.ok) {
        res.status(authCheck.statusCode).json({ error: authCheck.error });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: 'GEMINI_API_KEY chưa được cấu hình.' });
        return;
      }

      const { text, voiceName = 'Kore' } = req.body as {
        text?: string;
        voiceName?: GeminiVoiceName;
      };

      const cleanText = (text || '')
        .replace(/[*_`#>-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanText) {
        res.status(400).json({ error: 'Thiếu nội dung văn bản để đọc.' });
        return;
      }

      const selectedVoice: GeminiVoiceName = ALLOWED_VOICES.includes(voiceName)
        ? voiceName
        : 'Kore';

      const callTtsModel = async (model: 'gemini-3.8-flash-lite-tts' | 'gemini-3.8-flash-tts') =>
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanText,
                  speechMetadata: {
                    style:
                      'Giọng trợ lý AI Google thân thiện, phát âm tiếng Việt chuẩn, ngắt nghỉ tự nhiên, rõ ràng',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
          },
        });

      let response;
      try {
        response = await callTtsModel('gemini-3.8-flash-lite-tts');
      } catch (firstErr) {
        try {
          response = await callTtsModel('gemini-3.8-flash-tts');
        } catch (secondErr) {
          const rawMsg =
            secondErr instanceof Error
              ? secondErr.message
              : firstErr instanceof Error
                ? firstErr.message
                : '';
          const isQuota =
            rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('quota');
          if (isQuota) {
            res.status(429).json({
              error:
                'Đã vượt giới hạn lượt gọi Gemini TTS (429). Vui lòng kiểm tra hạn mức GEMINI_API_KEY trong Settings > Secrets.',
            });
            return;
          }
          res.status(502).json({
            error: rawMsg || 'Lỗi tổng hợp giọng nói Gemini TTS.',
          });
          return;
        }
      }

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        res.status(502).json({ error: 'Không nhận được dữ liệu âm thanh từ Gemini TTS.' });
        return;
      }

      res.json({
        audio: base64Audio,
        mimeType: 'audio/wav',
        voiceName: selectedVoice,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi tổng hợp giọng nói Gemini TTS';
      res.status(500).json({ error: message });
    }
  });

  // Text-mode Gemini chat endpoint (for keyboard messages when Live voice isn't streaming)
  app.post('/api/chat', async (req, res) => {
    try {
      const authCheck = await authorizeBackendRequest(extractBearerToken(req), 'text_chat');
      if (!authCheck.ok || !authCheck.account) {
        res.status(authCheck.statusCode).json({ error: authCheck.error });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({
          error: 'GEMINI_API_KEY chưa được cấu hình trong Settings > Secrets.',
        });
        return;
      }

      const {
        history = [],
        message,
        mcpConfig = {},
        tools = BUILTIN_HERMES_TOOLS,
      } = req.body as {
        history: Array<{ role: 'user' | 'gemini'; text: string }>;
        message: string;
        mcpConfig: { endpoint?: string; token?: string; mode?: 'auto' | 'remote' | 'local' };
        tools: McpToolDefinition[];
      };

      if (!message || !message.trim()) {
        res.status(400).json({ error: 'Nội dung tin nhắn không được để trống.' });
        return;
      }

      const canUseMcp = hasPermission(authCheck.account, 'hermes_mcp');
      if (!canUseMcp) {
        res.status(403).json({
          error:
            'Cuộc trò chuyện kết nối trực tiếp tới Hermes MCP. Tài khoản của bạn chưa được Admin cấp quyền "Hermes MCP Tools".',
        });
        return;
      }

      let activeTools: McpToolDefinition[] =
        Array.isArray(tools) && tools.length > 0 ? tools : BUILTIN_HERMES_TOOLS;

      // Ensure remote tools are discovered if a remote endpoint is set without remote tools loaded
      if (
        mcpConfig.mode !== 'local' &&
        mcpConfig.endpoint?.trim() &&
        !activeTools.some((t) => t.source === 'remote')
      ) {
        const discovery = await discoverHermesTools(mcpConfig);
        if (discovery.tools.length > 0) {
          activeTools = discovery.tools;
        }
      }

      const functionDeclarations = toGeminiFunctionDeclarations(activeTools);
      const geminiTools =
        functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;

      const contents: Content[] = [
        ...history.slice(-8).map((item) => ({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.text }],
        })),
        {
          role: 'user',
          parts: [{ text: message.trim() }],
        },
      ];

      // Step 1: Force routing directly to a Hermes MCP tool
      let selectedCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> = [];
      if (geminiTools) {
        try {
          const routeResponse = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents,
            config: {
              systemInstruction: GEMINI_HERMES_ROUTER_INSTRUCTION,
              tools: geminiTools,
              toolConfig: {
                functionCallingConfig: {
                  mode: FunctionCallingConfigMode.ANY,
                },
              },
            },
          });
          if (routeResponse.functionCalls && routeResponse.functionCalls.length > 0) {
            selectedCalls = routeResponse.functionCalls.map((fc) => ({
              id: fc.id,
              name: fc.name,
              args: (fc.args ?? {}) as Record<string, unknown>,
            }));
          }
        } catch {
          // Fall through to deterministic Hermes MCP tool fallback
        }
      }

      if (selectedCalls.length === 0) {
        const fallback = pickFallbackHermesTool(activeTools, message.trim());
        selectedCalls = [
          {
            id: `direct-${Date.now()}`,
            name: fallback.toolName,
            args: fallback.args,
          },
        ];
      }

      // Execute directly on Hermes MCP Server (Remote or Local Bridge)
      const mcpCalls: McpCallMeta[] = [];
      const allLogs: McpLogEntry[] = [];

      for (const call of selectedCalls) {
        const toolName = call.name || 'hermes_chat';
        const args = call.args ?? {};
        const exec = await invokeHermesTool({
          toolName,
          args,
          endpoint: mcpConfig.endpoint,
          token: mcpConfig.token,
          mode: mcpConfig.mode,
        });

        allLogs.push(...exec.logs);
        mcpCalls.push({
          toolName,
          uri: exec.uri,
          args,
          result: exec.result,
          mode: exec.mode,
        });
      }

      // Step 2: Gemini ONLY translates and formats Hermes MCP's exact response for reading aloud
      const hermesPayloadText = JSON.stringify(
        mcpCalls.map((c) => ({
          tool: c.toolName,
          uri: c.uri,
          mode: c.mode,
          hermesResponse: c.result,
        })),
        null,
        2
      );

      const translateResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  `Câu hỏi gốc của người dùng (chỉ dùng để hiểu ngữ cảnh xưng hô): "${message.trim()}"\n\n` +
                  `Dữ liệu phản hồi nguyên văn từ Hermes MCP:\n${hermesPayloadText}\n\n` +
                  `Hãy dịch và diễn đạt lại nguyên văn nội dung trả lời từ Hermes MCP sang tiếng Việt rõ ràng để đọc lại cho người dùng. Không thêm thông tin ngoài dữ liệu Hermes.`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: GEMINI_HERMES_TRANSLATOR_INSTRUCTION,
        },
      });

      res.json({
        text:
          translateResponse.text?.trim() ||
          'Hermes MCP đã phản hồi nhưng không có nội dung văn bản để dịch.',
        mcpCalls,
        mcpLogs: allLogs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi kết nối Gemini / Hermes MCP';
      res.status(500).json({ error: message });
    }
  });

  const server = http.createServer(app);

  // Vite dev middleware or static production assets
  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Gemini Live + Hermes MCP server listening on http://0.0.0.0:${PORT}`);
  });

  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on('connection', async (clientWs, req) => {
    const reqUrl = new URL(req.url || '/live', 'http://localhost');
    const idToken = reqUrl.searchParams.get('idToken') || undefined;
    const authCheck = await authorizeBackendRequest(idToken, 'voice_live');
    if (!authCheck.ok || !authCheck.account) {
      safeSend(clientWs, {
        type: 'error',
        message: authCheck.error || 'Bạn chưa có quyền sử dụng Gemini Live.',
      });
      clientWs.close();
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      safeSend(clientWs, {
        type: 'error',
        message: 'GEMINI_API_KEY chưa được thiết lập trên máy chủ.',
      });
      clientWs.close();
      return;
    }

    const requestedVoice = reqUrl.searchParams.get('voice') as GeminiVoiceName | null;
    const voiceName: GeminiVoiceName =
      requestedVoice && ALLOWED_VOICES.includes(requestedVoice) ? requestedVoice : 'Zephyr';

    let activeMcpConfig = {
      endpoint: reqUrl.searchParams.get('endpoint') || '',
      token: reqUrl.searchParams.get('token') || '',
      mode: (reqUrl.searchParams.get('mode') as 'auto' | 'remote' | 'local') || 'auto',
    };

    const canUseMcp = hasPermission(authCheck.account, 'hermes_mcp');
    if (!canUseMcp) {
      safeSend(clientWs, {
        type: 'error',
        message:
          'Cuộc trò chuyện kết nối trực tiếp tới Hermes MCP. Tài khoản của bạn chưa được Admin cấp quyền "Hermes MCP Tools".',
      });
      clientWs.close();
      return;
    }

    let activeTools: McpToolDefinition[] = BUILTIN_HERMES_TOOLS.map((t) => ({
      ...t,
      enabled: true,
    }));
    try {
      const discovery = await discoverHermesTools(activeMcpConfig);
      if (discovery.tools.length > 0) {
        activeTools = discovery.tools.map((t) => ({ ...t, enabled: true }));
      }
      if (discovery.logs.length > 0) {
        safeSend(clientWs, { type: 'mcpLog', logs: discovery.logs });
      }
    } catch {
      // Proceed with built-in tools
    }

    const functionDeclarations = toGeminiFunctionDeclarations(activeTools);
    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let isClosing = false;

    const liveCallbacks = {
      onopen: () => {
        safeSend(clientWs, { type: 'ready', voiceName });
      },
      onmessage: async (message: LiveServerMessage) => {
        const content = message.serverContent;

        if (content?.inputTranscription?.text) {
          safeSend(clientWs, {
            type: 'inputTranscript',
            text: content.inputTranscription.text,
          });
        }

        if (content?.outputTranscription?.text) {
          safeSend(clientWs, {
            type: 'outputTranscript',
            text: content.outputTranscription.text,
          });
        }

        for (const part of content?.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) {
            safeSend(clientWs, {
              type: 'audio',
              data: part.inlineData.data,
            });
          }
        }

        if (content?.interrupted) {
          safeSend(clientWs, { type: 'interrupted' });
        }

        if (content?.turnComplete) {
          safeSend(clientWs, { type: 'turnComplete' });
        }

        const calls = message.toolCall?.functionCalls;
        if (calls && calls.length > 0 && session) {
          safeSend(clientWs, {
            type: 'status',
            status: 'thinking',
            label: 'Hermes MCP...',
          });

          const functionResponses = [];
          for (const call of calls) {
            const toolName = call.name || 'hermes_search_memory';
            const args = (call.args ?? {}) as Record<string, unknown>;
            const exec = await invokeHermesTool({
              toolName,
              args,
              endpoint: activeMcpConfig.endpoint,
              token: activeMcpConfig.token,
              mode: activeMcpConfig.mode,
            });

            safeSend(clientWs, { type: 'mcpLog', logs: exec.logs });
            safeSend(clientWs, {
              type: 'mcpCall',
              mcpCall: {
                toolName,
                uri: exec.uri,
                args,
                result: exec.result,
                mode: exec.mode,
              } satisfies McpCallMeta,
            });

            functionResponses.push({
              id: call.id,
              name: toolName,
              response: {
                result: exec.result,
                instruction:
                  'Chỉ dịch nội dung kết quả từ Hermes MCP này sang tiếng Việt tự nhiên và đọc lại cho người dùng, không tự thêm thông tin ngoài.',
              },
            });
          }

          session.sendToolResponse({ functionResponses });
        }
      },
      onerror: (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : 'Lỗi kết nối Gemini Live';
        safeSend(clientWs, { type: 'error', message: errMsg });
      },
      onclose: () => {
        if (!isClosing) {
          safeSend(clientWs, { type: 'closed' });
        }
      },
    };

    try {
      try {
        session = await ai.live.connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              languageCode: 'vi',
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
            inputAudioTranscription: {
              languageCodes: ['vi-VN', 'en-US'],
            },
            outputAudioTranscription: {},
            tools:
              functionDeclarations.length > 0
                ? [{ functionDeclarations }]
                : undefined,
            systemInstruction: GEMINI_LIVE_SYSTEM_INSTRUCTION,
          },
          callbacks: liveCallbacks,
        });
      } catch {
        session = await ai.live.connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools:
              functionDeclarations.length > 0
                ? [{ functionDeclarations }]
                : undefined,
            systemInstruction: GEMINI_LIVE_SYSTEM_INSTRUCTION,
          },
          callbacks: liveCallbacks,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể khởi tạo phiên Gemini Live';
      safeSend(clientWs, { type: 'error', message: msg });
      clientWs.close();
      return;
    }

    clientWs.on('message', (raw) => {
      if (!session) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          data?: string;
          text?: string;
          mcpConfig?: { endpoint?: string; token?: string; mode?: 'auto' | 'remote' | 'local' };
        };

        if (msg.type === 'audio' && msg.data) {
          session.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && msg.text) {
          session.sendRealtimeInput({ text: msg.text });
        } else if (msg.type === 'config' && msg.mcpConfig) {
          activeMcpConfig = {
            endpoint: msg.mcpConfig.endpoint ?? activeMcpConfig.endpoint,
            token: msg.mcpConfig.token ?? activeMcpConfig.token,
            mode: msg.mcpConfig.mode ?? activeMcpConfig.mode,
          };
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      try {
        session?.close();
      } catch {
        // Ignore close errors
      }
    });
  });
}

startServer();
