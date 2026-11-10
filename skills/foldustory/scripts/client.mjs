export const PRODUCTION_ORIGIN = 'https://foldustory.com';
const prefix = '/api/creator-agent';
const identifier = /^[a-zA-Z0-9_-]{1,120}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);
export class SpaceAgentError extends Error { constructor(code) { super(code); this.code = code; } }

/** No filesystem, engine, account credentials, custom hosts, or persistent tokens. */
export function createSpaceClient({ fetchImpl = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = 1000, waitMs = 45000 } = {}) {
  let device, accessToken, grant, connecting, exchanging, epoch = 0;
  const secrets = new Set(), jobs = new Map();
  function safe(value) {
    if (typeof value === 'string') { for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]'); return value; }
    if (Array.isArray(value)) return value.map(safe);
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|authorization|devicecode|cookie|password/i.test(key) ? '[REDACTED]' : safe(item)]));
    return value;
  }
  const publicDevice = () => ({ state: 'pending', userCode: device.userCode, verificationUri: device.verificationUri, expiresAt: device.expiresAt, instruction: '在此授权页面登录 Creator，选择本人作品并批准；保持该浏览器页面打开。随后调用 foldustory_space_status。' });
  async function request(route, { method = 'GET', body, auth = true, timeoutMs = 12000 } = {}) {
    const generation = epoch;
    if (!/^\/[a-z0-9_/-]+$/i.test(route)) throw new SpaceAgentError('INVALID_ROUTE');
    if (auth && !accessToken) throw new SpaceAgentError('NOT_AUTHORIZED');
    const headers = { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: 'Bearer ' + accessToken } : {}) };
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded && Buffer.byteLength(encoded) > 1024 * 1024) throw new SpaceAgentError('COMMAND_TOO_LARGE');
    let response;
    try { response = await fetchImpl(PRODUCTION_ORIGIN + prefix + route, { method, headers, body: encoded, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(12000, timeoutMs))) }); }
    catch { throw new SpaceAgentError('NETWORK_RESULT_UNKNOWN'); }
    if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new SpaceAgentError('RESPONSE_TOO_LARGE');
    let bytes = 0, chunks = [];
    try { for await (const chunk of response.body ?? []) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new SpaceAgentError('RESPONSE_TOO_LARGE'); chunks.push(chunk); } }
    catch (error) { throw error instanceof SpaceAgentError ? error : new SpaceAgentError('NETWORK_RESULT_UNKNOWN'); }
    let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SpaceAgentError('INVALID_SERVER_RESPONSE'); }
    if (generation !== epoch) throw new SpaceAgentError('CONNECTION_CANCELLED');
    if (!response.ok) {
      const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
      throw new SpaceAgentError(typeof code === 'string' && /^[a-z0-9_-]{1,100}$/i.test(code) ? code : `HTTP_${response.status}`);
    }
    return { status: response.status, data };
  }
  async function connect() {
    if (accessToken) return status();
    if (device && now() < device.expiresAt) return safe(publicDevice());
    if (connecting) return connecting;
    const generation = epoch;
    connecting = (async () => {
      const { data } = await request('/device', { method: 'POST', body: { clientName: 'Codex · FoldUStory 个人空间' }, auth: false });
      if (generation !== epoch) throw new SpaceAgentError('CONNECTION_CANCELLED');
      if (!plain(data) || !identifier.test(data.deviceId ?? '') || typeof data.deviceCode !== 'string' || data.deviceCode.length < 16 || typeof data.userCode !== 'string' || !Number.isFinite(data.expiresAt)) throw new SpaceAgentError('INVALID_DEVICE_RESPONSE');
      secrets.add(data.deviceCode);
      let url; try { url = new URL(data.verificationUri); } catch { throw new SpaceAgentError('INVALID_VERIFICATION_URL'); }
      if (url.origin !== PRODUCTION_ORIGIN || url.pathname !== '/agent' || url.username || url.password) throw new SpaceAgentError('INVALID_VERIFICATION_URL');
      device = { ...data, verificationUri: url.href };
      return safe(publicDevice());
    })().finally(() => { connecting = undefined; });
    return connecting;
  }
  async function exchange() {
    if (accessToken || !device) return;
    if (now() >= device.expiresAt) throw new SpaceAgentError('DEVICE_EXPIRED');
    if (exchanging) return exchanging;
    const generation = epoch;
    exchanging = (async () => {
      const { status: code, data } = await request('/token', { method: 'POST', body: { deviceId: device.deviceId, deviceCode: device.deviceCode }, auth: false });
      if (generation !== epoch) throw new SpaceAgentError('CONNECTION_CANCELLED');
      if (code === 202) return;
      if (typeof data?.accessToken !== 'string' || data.accessToken.length < 16 || typeof data.grantId !== 'string') throw new SpaceAgentError('INVALID_TOKEN_RESPONSE');
      accessToken = data.accessToken; secrets.add(accessToken); grant = data.grantId; device = undefined;
    })().finally(() => { exchanging = undefined; });
    return exchanging;
  }
  function jobView(data, record) {
    if (!identifier.test(data?.jobId ?? '') || !['queued', 'claimed', ...terminal].includes(data?.state)) throw new SpaceAgentError('INVALID_JOB_RESPONSE');
    record.jobId = data.jobId; record.state = data.state;
    const unknown = data.state === 'expired';
    return safe({ ...data, requestId: record.requestId, projectId: record.projectId, ...(unknown ? { outcome: 'unknown', instruction: '执行结果未知。先检查当前作品和保存版本；不要换一个 requestId 自动重放。' } : {}) });
  }
  async function inspect(record, timeoutMs) { return jobView((await request('/commands/' + record.jobId, { timeoutMs })).data, record); }
  async function status() {
    await exchange();
    if (!accessToken) return device ? safe(publicDevice()) : { state: 'disconnected', origin: PRODUCTION_ORIGIN };
    const { data } = await request('/status');
    const operations = [];
    for (const record of jobs.values()) if (!terminal.has(record.state)) {
      if (!record.jobId) operations.push({ requestId: record.requestId, projectId: record.projectId, state: 'unknown', instruction: '提交响应丢失。仅使用原 requestId 和完全相同的参数再次调用来对账；不要生成新 requestId。' });
      else { try { operations.push(await inspect(record)); } catch { operations.push({ requestId: record.requestId, jobId: record.jobId, state: 'unknown' }); } }
    }
    return safe({ state: 'authorized', origin: PRODUCTION_ORIGIN, grant: data.grant, owner: data.owner, projects: data.projects, operations });
  }
  async function projects() { await exchange(); return safe((await request('/projects')).data); }
  async function command({ requestId, projectId, command }) {
    if (!identifier.test(requestId ?? '') || !identifier.test(projectId ?? '') || !plain(command) || typeof command.op !== 'string') throw new SpaceAgentError('INVALID_COMMAND_ARGUMENTS');
    await exchange();
    const payload = { requestId, projectId, command }, fingerprint = JSON.stringify(canonical(payload));
    let record = jobs.get(requestId);
    if (record && record.fingerprint !== fingerprint) throw new SpaceAgentError('REQUEST_ID_PAYLOAD_CONFLICT');
    if (record?.running) return record.running;
    if (!record) {
      if (jobs.size >= 128) { const finished = [...jobs.values()].find(item => terminal.has(item.state)); if (finished) jobs.delete(finished.requestId); else throw new SpaceAgentError('TOO_MANY_PENDING_COMMANDS'); }
      record = { requestId, projectId, fingerprint, state: 'unknown' }; jobs.set(requestId, record);
    }
    record.running = (async () => {
      let result;
      const deadline = now() + waitMs;
      try {
        result = record.jobId ? await inspect(record, deadline - now()) : jobView((await request('/commands', { method: 'POST', body: payload, timeoutMs: deadline - now() })).data, record);
        while (!terminal.has(record.state) && now() < deadline) {
          await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
          if (now() >= deadline) break;
          result = await inspect(record, deadline - now());
        }
        return terminal.has(record.state) ? result : safe({ ...result, outcome: 'unknown', instruction: '等待确认超时。调用 foldustory_space_status 对账，保持原 requestId；不要自动重放。' });
      } catch (error) {
        if (error.code === 'NETWORK_RESULT_UNKNOWN') return safe({ state: 'unknown', outcome: 'unknown', requestId, projectId, jobId: record.jobId, error: error.code, instruction: '响应中断，操作可能已经执行。先调用 status；如提交未返回 jobId，仅能用原 requestId 与完全相同参数对账。' });
        throw error;
      }
    })().finally(() => { record.running = undefined; });
    return record.running;
  }
  async function disconnect() {
    let revoked = false;
    const hadGrant = !!accessToken;
    try { if (accessToken) { await request('/revoke', { method: 'POST', body: {} }); revoked = true; } }
    catch { /* Clearing local memory is not a successful server revocation. */ }
    finally { epoch++; accessToken = undefined; device = undefined; grant = undefined; jobs.clear(); secrets.clear(); }
    return { state: 'disconnected', revoked, instruction: hadGrant && !revoked ? '本地已断开。请在个人空间撤销该授权。' : revoked ? '当前授权已在服务器撤销。' : '本地连接已清除；尚未取得授权。' };
  }
  function forget() { epoch++; accessToken = undefined; device = undefined; grant = undefined; jobs.clear(); secrets.clear(); }
  return { connect, status, projects, command, disconnect, forget, safe };
}
