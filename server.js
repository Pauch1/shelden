const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createServer(database = path.join(__dirname, 'tasks.sqlite')) {
  const db = new DatabaseSync(database);
  db.exec('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0)');
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/sw.js': ['sw.js', 'text/javascript'], '/manifest.json': ['manifest.json', 'application/manifest+json'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'] };
  const select = db.prepare('SELECT id, text, completed FROM tasks WHERE id = ?');
  const convert = row => row && ({ ...row, completed: Boolean(row.completed) });
  const server = http.createServer(async (req, res) => {
    try {
      const match = /^\/api\/tasks\/([^/]+)$/.exec(req.url);
      let id;
      try { id = match && decodeURIComponent(match[1]); } catch { res.writeHead(400); return res.end('Invalid ID'); }
      if (req.url === '/api/tasks' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(db.prepare('SELECT id, text, completed FROM tasks ORDER BY rowid DESC').all().map(convert)));
      }
      if (id && req.method === 'GET') {
        const task = convert(select.get(id));
        if (!task) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(task));
      }
      if (id && req.method === 'DELETE') {
        const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        res.writeHead(result.changes ? 200 : 404); return res.end(result.changes ? 'Deleted' : 'Not found');
      }
      if ((req.url === '/api/tasks' && req.method === 'POST') || (id && ['PATCH', 'PUT'].includes(req.method))) {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 10000) { res.writeHead(413); return res.end(); } }
        let task;
        try { task = JSON.parse(body); } catch { res.writeHead(400); return res.end('Invalid JSON'); }
        if (!task || typeof task !== 'object' || Array.isArray(task)) { res.writeHead(400); return res.end('Invalid task'); }
        const existing = id && select.get(id);
        if (id && !existing) { res.writeHead(404); return res.end('Not found'); }
        if ((!id && (typeof task.id !== 'string' || !task.id.trim() || task.id.length > 100)) ||
            ((req.method !== 'PATCH' || 'text' in task) && (typeof task.text !== 'string' || !task.text.trim() || task.text.length > 1000)) ||
            (('completed' in task) && typeof task.completed !== 'boolean') ||
            (req.method === 'PUT' && typeof task.completed !== 'boolean') ||
            (req.method === 'PATCH' && !('text' in task) && !('completed' in task))) {
          res.writeHead(400); return res.end('Invalid task');
        }
        if (id) {
          db.prepare('UPDATE tasks SET text = ?, completed = ? WHERE id = ?').run(task.text ?? existing.text, task.completed === undefined ? existing.completed : Number(task.completed), id);
        } else {
          db.prepare('INSERT INTO tasks (id, text, completed) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING').run(task.id, task.text, Number(task.completed ?? false));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ saved: true }));
      }
      if (req.method === 'GET' && files[req.url]) {
        const [file, type] = files[req.url];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(path.join(__dirname, file)));
      }
      res.writeHead(404); res.end('Not found');
    } catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500); res.end('Server error'); }
  });
  server.on('close', () => db.close());
  return server;
}
if (require.main === module) createServer().listen(3001, () => console.log('Open http://localhost:3001'));
module.exports = { createServer };
