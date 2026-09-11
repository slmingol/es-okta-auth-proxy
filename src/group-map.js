import { readFileSync, existsSync } from 'fs';

const MAP_PATH = process.env.GROUP_MAP_PATH || './config/group-map.json';

let groupMap = null;
let priority = [];

export function loadGroupMap() {
  if (!existsSync(MAP_PATH)) {
    console.warn(`group-map: ${MAP_PATH} not found -- all users use ES_API_KEY fallback`);
    return;
  }
  try {
    groupMap = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
    priority = groupMap._priority ?? Object.keys(groupMap).filter(k => !k.startsWith('_'));
    console.log(`group-map: loaded ${priority.length} group mappings from ${MAP_PATH}`);
  } catch (err) {
    console.error('group-map: failed to parse', MAP_PATH, err.message);
  }
}

// Returns the API key for the first matching group (by priority order).
// Falls back to _default in map, then ES_API_KEY env var.
export function resolveApiKey(groups = []) {
  if (!groupMap) return process.env.ES_API_KEY;

  for (const g of priority) {
    if (groups.includes(g) && groupMap[g]) return groupMap[g];
  }

  return groupMap._default ?? process.env.ES_API_KEY;
}
