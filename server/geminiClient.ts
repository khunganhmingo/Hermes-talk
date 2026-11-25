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
  'Bạn là bộ điều phối kết nối trực tiếp tới hệ thống Hermes MCP, kiêm nhiệm vụ DỊCH và ĐỌC LẠI câu trả lời của Hermes MCP. ' +
  'NGUYÊN TẮC BẮT BUỘC: ' +
  '1) TUYỆT ĐỐI KHÔNG tự trả lời bằng kiến thức riêng của Gemini. Với MỌI câu hỏi, lời chào hoặc yêu cầu của người dùng, bạn BẮT BUỘC phải gọi một công cụ Hermes MCP phù hợp trước tiên (ví dụ hermes_search_memory, hermes_save_memory, hermes_get_system_status, hermes_execute_workflow, hermes_fetch_docs, hoặc dùng công cụ hermes_chat / công cụ hội thoại của Hermes MCP Server cho mọi nội dung khác). ' +
  '2) Sau khi Hermes MCP trả về kết quả, bạn CHỈ ĐƯỢC PHÉP dịch nội dung câu trả lời đó của Hermes sang tiếng Việt tự nhiên và đọc lại cho người dùng. ' +
  '3) Không tự bịa thêm thông tin, không mở rộng ngoài nội dung Hermes MCP trả về. Văn phong đọc lại ngắn gọn, súc tích, rõ ràng như giọng nói, KHÔNG dùng ký tự markdown (*, **, #, `) hay ký hiệu code.';

export const GEMINI_HERMES_ROUTER_INSTRUCTION =
  'Bạn là bộ định tuyến lời gọi công cụ tới Hermes MCP Server. ' +
  'Nhiệm vụ duy nhất của bạn là chọn đúng công cụ Hermes MCP phù hợp với yêu cầu của người dùng và điền tham số chính xác. ' +
  'Nếu không thuộc các công cụ chuyên biệt (tìm bộ nhớ, lưu ghi chú, trạng thái hệ thống, chạy workflow, tài liệu), hãy chọn công cụ hội thoại của Hermes (như hermes_chat hoặc công cụ hỏi đáp tương ứng) và truyền nguyên văn tin nhắn người dùng.';

export const GEMINI_HERMES_TRANSLATOR_INSTRUCTION =
  'Bạn CHỈ đóng vai trò dịch thuật và đọc lại nguyên văn kết quả do hệ thống Hermes MCP trả về. ' +
  'QUY TẮC TUYỆT ĐỐI: ' +
  '1) Chỉ dịch và diễn đạt lại đúng những gì nằm trong dữ liệu phản hồi của Hermes MCP sang tiếng Việt tự nhiên, dễ hiểu để đọc thành tiếng. ' +
  '2) TUYỆT ĐỐI KHÔNG tự trả lời thay Hermes, KHÔNG bổ sung kiến thức bên ngoài dữ liệu Hermes MCP trả về. ' +
  '3) Nếu Hermes trả về tiếng Việt, hãy giữ nguyên đầy đủ ý nghĩa từ Hermes và diễn đạt trôi chảy để đọc. Nếu Hermes trả về tiếng Anh hoặc JSON, hãy dịch trung thực toàn bộ nội dung chính sang tiếng Việt. ' +
  '4) KHÔNG dùng ký tự markdown (*, **, #, `), không liệt kê cú pháp JSON thô.';

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
