import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';
import type { McpToolDefinition } from '../src/types.ts';

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    apiVersion: 'v1beta',
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export const GEMINI_LIVE_SYSTEM_INSTRUCTION =
  'Bạn là trợ lý thoại thông minh Gemini Live của Google, kết nối trực tiếp với hệ thống Hermes MCP (Model Context Protocol). ' +
  'QUY TẮC NGÔN NGỮ: Luôn giao tiếp và trả lời bằng tiếng Việt tự nhiên, chuẩn xác, truyền cảm như giọng nói trợ lý Google (trừ khi người dùng yêu cầu nói ngôn ngữ khác). ' +
  'Văn phong ngắn gọn, tự nhiên như hội thoại trực tiếp (2-4 câu súc tích), KHÔNG dùng ký tự markdown (*, **, #, `) hay ký hiệu code khi nói. ' +
  'Khi gặp thuật ngữ tiếng Anh như Hermes MCP, API, server, hãy diễn đạt trôi chảy trong câu tiếng Việt. ' +
  'Khi người dùng hỏi về ghi chú, bộ nhớ, lịch trình, trạng thái hệ thống/server, quy trình tự động hóa hoặc tài liệu Hermes, hãy gọi công cụ Hermes MCP phù hợp và tóm tắt kết quả rõ ràng bằng tiếng Việt.';

function mapJsonSchemaType(typeStr?: string): Type {
  switch ((typeStr || '').toLowerCase()) {
    case 'number':
      return Type.NUMBER;
    case 'integer':
      return Type.INTEGER;
    case 'boolean':
      return Type.BOOLEAN;
    case 'array':
      return Type.ARRAY;
    case 'object':
      return Type.OBJECT;
    default:
      return Type.STRING;
  }
}

export function toGeminiFunctionDeclarations(tools: McpToolDefinition[]): FunctionDeclaration[] {
  return tools
    .filter((t) => t.enabled)
    .map((tool) => {
      const rawProps = tool.inputSchema?.properties ?? {};
      const mappedProps: Record<string, { type: Type; description?: string }> = {};

      for (const [key, prop] of Object.entries(rawProps)) {
        mappedProps[key] = {
          type: mapJsonSchemaType(prop.type),
          description: prop.description || key,
        };
      }

      // Gemini Schema requires Type.OBJECT to have at least one property if properties are defined
      if (Object.keys(mappedProps).length === 0) {
        mappedProps.query = {
          type: Type.STRING,
          description: 'Optional context or query string',
        };
      }

      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: Type.OBJECT,
          properties: mappedProps,
          required: tool.inputSchema?.required?.filter((r) => Boolean(mappedProps[r])) ?? [],
        },
      };
    });
}
