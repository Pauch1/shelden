# Offline Tasks

A simple task list with an installable PWA, a Node.js API, SQLite, and an IndexedDB queue. Create, edit, complete, and delete tasks online or offline.

## Start

Requires Node.js 22.13 or newer (Node 24 recommended). From this folder:

```powershell
npm run dev
```

Open http://localhost:3001. Open the page once while online to cache the app; then install it from the browser's install option if desired. In browser developer tools, choose Network > Offline to test. Create or update tasks and reconnect while the page and server are running to sync them. The app retries when it opens, on reconnection, and every 30 seconds while open. The local server stores data in `tasks.sqlite`; browser data is separate from the notes app.

## API

- `GET /api/tasks` lists tasks; `GET /api/tasks/:id` gets one.
- `POST /api/tasks` creates a task with JSON, for example `{ "id": "task-1", "text": "Study", "completed": false }`. Omit `completed` to default to false. Use a unique ID; retrying an existing ID does not add a duplicate.
- `PATCH /api/tasks/:id` changes `text` or `completed`, for example `{ "completed": true }`.
- `PUT /api/tasks/:id` replaces both editable fields, for example `{ "text": "Study", "completed": true }`.
- `DELETE /api/tasks/:id` deletes a task.

The PWA queues creates, changes, and deletions in IndexedDB and sends them in order. A deleted task already absent from the API is considered synced. This demo does not sync after the page is closed and has no account system or conflict resolution for multiple devices.

Run the API test with `node --test server.test.js`.
