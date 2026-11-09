import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createSpaceClient } from './client.mjs';
const empty = { type: 'object', properties: {}, additionalProperties: false };
const ref = { type: 'object', required: ['projectId', 'requestId'], additionalProperties: false, properties: { projectId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,120}$' }, requestId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,120}$', description: '唯一操作 ID；结果不确定时保持相同 ID 和完全相同参数对账。' } } };
const annotation = (readOnlyHint, idempotentHint = true) => ({ readOnlyHint, idempotentHint, destructiveHint: !readOnlyHint, openWorldHint: false });
export const tools = [
  { name: 'foldustory_space_connect', description: '创建一次浏览器授权请求，返回授权页面和用户码；Creator 在网页明确选择本人作品。重复调用复用待批准请求。', inputSchema: empty, annotations: annotation(false) },
  { name: 'foldustory_space_status', description: '尝试一次授权兑换并读取账号、作品范围、待确认操作；不返回访问凭证。', inputSchema: empty, annotations: annotation(true) },
  { name: 'foldustory_space_projects', description: '仅列出当前账号明确授权给此连接的云作品。', inputSchema: empty, annotations: annotation(true) },
  { name: 'foldustory_space_open', description: '在批准授权的浏览器打开指定云作品。先读取 projects 并明确选择作品；不自动选择第一份。', inputSchema: ref, annotations: annotation(false) },
  { name: 'foldustory_space_command', description: '调用服务端允许的作品函数。先 describe-tools/get-context 获取种类、实际 ID 和 revision；修改携带 expectedRevision。草稿只支持 get-context/rename-project。冲突或结果未知停止自动重放。', inputSchema: { ...ref, required: [...ref.required, 'command'], properties: { ...ref.properties, command: { type: 'object', required: ['op'], properties: { op: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 } } } } }, annotations: annotation(false) },
  { name: 'foldustory_space_save', description: '在批准授权的浏览器保存指定作品到网站账号。只有服务端确认云版本才算已保存；失败保留原件，不能称为备份成功。', inputSchema: ref, annotations: annotation(false) },
  { name: 'foldustory_space_disconnect', description: '撤销当前服务器授权并清除进程内凭证；撤销失败会明确提示网页手动撤销。', inputSchema: empty, annotations: annotation(false) },
];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function createRpcHandler(client) {
  let negotiated = false, initialized = false;
  const active = new Set();
  return async message => {
    if (!plain(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (Object.hasOwn(message, 'id') && !['string', 'number'].includes(typeof message.id))) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
    if (!Object.hasOwn(message, 'id')) { if (message.method === 'notifications/initialized' && negotiated) initialized = true; return; }
    const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
    const fail = (code, text) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });
    if (message.method === 'initialize') {
      if (negotiated) return fail(-32600, 'Already initialized');
      if (typeof message.params?.protocolVersion !== 'string') return fail(-32602, 'protocolVersion required');
      negotiated = true;
      const versions = ['2025-06-18', '2025-03-26', '2024-11-05'];
      return reply({ protocolVersion: versions.includes(message.params.protocolVersion) ? message.params.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'foldustory', version: '1.0.0' }, instructions: '仅 Creator 明确授权的个人空间作品。先选择作品并读取上下文；云保存需服务端确认。授权过期、冲突或结果未知时停止自动重放。' });
    }
    if (message.method === 'ping') return reply({});
    if (!initialized) return fail(-32002, 'Initialize and send notifications/initialized first');
    if (message.method === 'tools/list') return reply({ tools });
    if (message.method !== 'tools/call') return fail(-32601, 'Method not found');
    const name = message.params?.name, args = message.params?.arguments ?? {};
    const tool = tools.find(item => item.name === name);
    if (!tool || !plain(args) || Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key)) || (tool.inputSchema.required ?? []).some(key => !Object.hasOwn(args, key))) return fail(-32602, 'Invalid tool arguments');
    if (active.has(message.id)) return fail(-32600, 'Request already in progress');
    active.add(message.id);
    try {
      const result = name === 'foldustory_space_connect' ? await client.connect() : name === 'foldustory_space_status' ? await client.status() : name === 'foldustory_space_projects' ? await client.projects() : name === 'foldustory_space_disconnect' ? await client.disconnect() : await client.command({ ...args, command: name === 'foldustory_space_open' ? { op: 'open-project' } : name === 'foldustory_space_save' ? { op: 'save-project' } : args.command });
      return reply({ content: [{ type: 'text', text: JSON.stringify(client.safe(result)) }], isError: ['failed', 'unknown', 'cancelled', 'expired'].includes(result?.state) || result?.outcome === 'unknown' || result?.result?.ok === false });
    } catch (error) {
      const code = typeof error.code === 'string' && /^[a-z0-9_-]{1,100}$/i.test(error.code) ? error.code : 'CONNECTOR_ERROR';
      return reply({ content: [{ type: 'text', text: JSON.stringify(client.safe({ ok: false, error: code })) }], isError: true });
    } finally { active.delete(message.id); }
  };
}
export function runStdio() {
  const client = createSpaceClient(), handle = createRpcHandler(client);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const output = result => { if (result) process.stdout.write(JSON.stringify(result) + '\n'); };
  lines.on('line', line => {
    if (Buffer.byteLength(line) > 1024 * 1024) { output({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }); return; }
    let message; try { message = JSON.parse(line); } catch { output({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    void handle(message).then(output).catch(() => output({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'Internal error' } }));
  });
  lines.on('close', () => client.forget());
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { client.forget(); lines.close(); process.exit(0); });
  return { client, lines };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runStdio();
