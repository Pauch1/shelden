const statusElement = document.querySelector("#status");
const list = document.querySelector("#entries");
const form = document.querySelector("#form");
const input = document.querySelector("#text");
let syncing = false;
let database;
let revision = 0;

const ready = new Promise((resolve, reject) => {
  const request = indexedDB.open("offline-tasks", 1);
  request.onupgradeneeded = (event) => {
    const db = request.result;
    const tasks = db.createObjectStore("tasks", { keyPath: "id" });
    const queue = db.createObjectStore("queue", {
keyPath: "key",
      autoIncrement: true,
    });


  };
  request.onsuccess = () => {
    database = request.result;
    resolve();
  };
  request.onerror = () => reject(request.error);
});

function transaction(stores, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    const result = action(tx);
    tx.oncomplete = () => resolve(result && result.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Storage transaction failed"));
  });
}

async function queueChange(method, entry) {
  await transaction(["tasks", "queue"], "readwrite", (tx) => {
    const tasks = tx.objectStore("tasks");
    if (method === "DELETE") tasks.delete(entry.id);
    else tasks.put(entry);
    tx.objectStore("queue").add({ method, entry });
  });
  revision++;
}

async function refresh() {
  const startedAt = revision;
  try {
    const response = await fetch("/api/tasks", { cache: "no-store" });
    if (!response.ok) throw new Error("API unavailable");
    const saved = await response.json();
    if (startedAt === revision)
      await transaction(["tasks", "queue"], "readwrite", (tx) => {
        const tasks = tx.objectStore("tasks");
        const request = tx.objectStore("queue").getAll();
        request.onsuccess = () => {
          const pendingIds = new Set(
            request.result.map((item) => item.entry.id),
          );
          const existing = tasks.getAll();
          existing.onsuccess = () => {
            for (const task of existing.result)
              if (!pendingIds.has(task.id)) tasks.delete(task.id);
            for (const task of saved)
              if (!pendingIds.has(task.id)) tasks.put(task);
          };
        };
      });
  } catch {
    /* Keep the local copy when the server cannot be reached. */
  }

  const tasks = await transaction(["tasks"], "readonly", (tx) =>
    tx.objectStore("tasks").getAll(),
  );

  const pending = await transaction(["queue"], "readonly", (tx) =>
    tx.objectStore("queue").getAll(),
  );

  const pendingIds = new Set(pending.map((item) => item.entry.id));
  list.replaceChildren();

  for (const task of tasks) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = task.text + (pendingIds.has(task.id) ? " (waiting to sync) " : " (saved) ");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", "Completed: " + task.text);
    checkbox.addEventListener("change", async () => {
      try { await queueChange("PATCH", { ...task, completed: checkbox.checked }); await sync(); }
      catch (error) { checkbox.checked = task.completed; statusElement.textContent = "Could not save locally: " + error.message; }
    });
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.addEventListener("click", async () => {
      const text = prompt("Edit task:", task.text);
      if (text === null || !text.trim()) return;
      if (text.trim().length > 1000) {
        statusElement.textContent = "A task must be at most 1000 characters.";
        return;
      }
      try {
        await queueChange("PATCH", { ...task, text: text.trim() });
        await sync();
      } catch (error) {
        statusElement.textContent = "Could not save locally: " + error.message;
      }
    });

    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      try {
        await queueChange("DELETE", { id: task.id });
        await sync();
      } catch (error) {
        statusElement.textContent = "Could not save locally: " + error.message;
      }
    });
    item.append(checkbox, label, edit, remove);
    list.append(item);
  }
  statusElement.textContent =
    (navigator.onLine ? "" : "Offline: ") +
    `${pending.length} change(s) waiting to sync`;
}

async function sync() {
  if (syncing) {
    await refresh();
    return;
  }
  syncing = true;
  try {
    while (true) {
      const pending = await transaction(["queue"], "readonly", (tx) =>
        tx.objectStore("queue").getAll(),
      );
      if (!pending.length) break;
      const change = pending[0];
      const url ="/api/tasks" + (change.method === "POST" ? "" : "/" + encodeURIComponent(change.entry.id));
      const response = await fetch(url, { 
        method: change.method,
        headers: { "Content-Type": "application/json" },
        ...(change.method === "DELETE"
          ? {}
          : { body: JSON.stringify(change.entry) }),
      });
      if (
        !response.ok &&
        !(change.method === "DELETE" && response.status === 404)
      )
        break;
      revision++;
      await transaction(["queue"], "readwrite", (tx) =>
        tx.objectStore("queue").delete(change.key),
      );
    }
  } catch (error) {
    console.error("Sync failed:", error);
  } finally {
    syncing = false;
    await refresh();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  try {
    await ready;
    await queueChange("POST", { id: crypto.randomUUID(), text, completed: false });
    input.value = "";
    await sync();
  } catch (error) {
    statusElement.textContent = "Could not save locally: " + error.message;
  }
});

window.addEventListener("online", () => ready.then(sync).catch(console.error));
window.addEventListener("offline", () =>
  ready.then(refresh).catch(console.error),
);

ready.then(sync).catch((error) => {
  statusElement.textContent = "Storage unavailable: " + error.message;
});

setInterval(() => {
  if (navigator.onLine) ready.then(sync).catch(console.error);
}, 30000);

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(console.error);
