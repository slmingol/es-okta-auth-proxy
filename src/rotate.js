import { request } from 'https';
import { URL } from 'url';
import { getGroupMap, setGroupMap, writeGroupMap } from './group-map.js';

function esRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.ES_URL + path);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method,
      headers: {
        'Authorization': `ApiKey ${process.env.ES_ROTATION_KEY}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      rejectUnauthorized: process.env.ES_TLS_VERIFY !== 'false',
    };
    const req = request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Non-JSON response (${res.statusCode}): ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function rotateKeys() {
  console.log('[rotate] Starting key rotation');
  const map = getGroupMap();
  if (!map) { console.warn('[rotate] No group map loaded -- skipping'); return; }

  const roles = map._roles;
  if (!roles) { console.warn('[rotate] No _roles block in group-map -- skipping'); return; }

  const newMap = { ...map };
  const oldIds = [];

  for (const group of (map._priority ?? [])) {
    if (!roles[group]) { console.warn(`[rotate] No role descriptor for ${group} -- skipping`); continue; }
    if (!map[group]) { console.warn(`[rotate] No current key for ${group} -- skipping`); continue; }

    try {
      // extract old key id from base64 id:api_key
      const oldId = Buffer.from(map[group], 'base64').toString('utf8').split(':')[0];

      const res = await esRequest('POST', '/_security/api_key', {
        name: `${group}-${new Date().toISOString().slice(0, 10)}`,
        role_descriptors: { [group]: roles[group] },
      });

      if (!res.id || !res.api_key) throw new Error(`Unexpected ES response: ${JSON.stringify(res)}`);

      newMap[group] = Buffer.from(`${res.id}:${res.api_key}`).toString('base64');
      oldIds.push(oldId);
      console.log(`[rotate] ${group}: new id=${res.id} old id=${oldId}`);
    } catch (err) {
      console.error(`[rotate] Failed to rotate ${group}:`, err.message);
    }
  }

  // write + swap in-memory before invalidating so requests never gap
  writeGroupMap(newMap);
  setGroupMap(newMap);

  if (oldIds.length) {
    try {
      await esRequest('DELETE', '/_security/api_key', { ids: oldIds });
      console.log(`[rotate] Invalidated ${oldIds.length} old key(s)`);
    } catch (err) {
      console.error('[rotate] Failed to invalidate old keys (non-fatal):', err.message);
    }
  }

  console.log('[rotate] Rotation complete');
}

export function startRotation() {
  const hours = parseFloat(process.env.KEY_ROTATION_HOURS || '0');
  if (!hours) return;

  if (!process.env.ES_ROTATION_KEY) {
    console.warn('[rotate] KEY_ROTATION_HOURS set but ES_ROTATION_KEY missing -- rotation disabled');
    return;
  }

  const ms = hours * 60 * 60 * 1000;
  console.log(`[rotate] Key rotation every ${hours}h`);
  setInterval(rotateKeys, ms).unref();
}
