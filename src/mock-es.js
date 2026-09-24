// Mock ES middleware -- activated when ES_URL=mock
// Returns plausible ES 8.x responses for common endpoints

export function mockEsRouter(app) {
  app.get('/', (req, res) => {
    res.json({
      name: 'mock-node',
      cluster_name: 'mock-cluster',
      version: { number: '8.14.0', lucene_version: '9.10.0' },
      tagline: 'You Know, for Search (mock)',
    });
  });

  app.get('/_cluster/health', (req, res) => {
    res.json({
      cluster_name: 'mock-cluster',
      status: 'green',
      number_of_nodes: 3,
      number_of_data_nodes: 3,
      active_primary_shards: 10,
      active_shards: 20,
      relocating_shards: 0,
      unassigned_shards: 0,
    });
  });

  app.get('/_cat/indices', (req, res) => {
    res.json([
      { health: 'green', status: 'open', index: 'mock-logs-000001', 'docs.count': '42000', 'store.size': '18mb' },
      { health: 'green', status: 'open', index: 'mock-metrics-000001', 'docs.count': '8200', 'store.size': '4mb' },
    ]);
  });

  app.all('/_search', mockSearch);
  app.all('/:index/_search', mockSearch);

  // Catch-all for unmapped ES paths
  app.all('/_*wildcard', (req, res) => {
    res.json({ acknowledged: true, mock: true, path: req.path, method: req.method });
  });
}

function mockSearch(req, res) {
  res.json({
    took: 2,
    timed_out: false,
    _shards: { total: 5, successful: 5, failed: 0 },
    hits: {
      total: { value: 3, relation: 'eq' },
      hits: [
        { _index: 'mock-logs-000001', _id: '1', _score: 1.0, _source: { '@timestamp': new Date().toISOString(), message: 'mock log entry 1', level: 'info' } },
        { _index: 'mock-logs-000001', _id: '2', _score: 0.9, _source: { '@timestamp': new Date().toISOString(), message: 'mock log entry 2', level: 'warn' } },
        { _index: 'mock-logs-000001', _id: '3', _score: 0.8, _source: { '@timestamp': new Date().toISOString(), message: 'mock log entry 3', level: 'error' } },
      ],
    },
  });
}
