import {
  STANDING_STYLE,
  cancelRun,
  createAgent,
  createRun,
  getMe,
  listModels,
  streamRun,
  type StreamHandle,
} from "../api/cursorClient";
import { CursorApiError } from "../api/types";
import {
  addMessage,
  appendAssistantDelta,
  deleteSession,
  getActiveSession,
  listSessions,
  loadSessions,
  markBootstrapped,
  newSession,
  setActiveSession,
  setAgentId,
  setAssistantText,
} from "../state/sessionStore";
import {
  clearApiKey,
  getSettings,
  loadSettings,
  saveApiKey,
  saveModelId,
  saveUserLabel,
} from "../state/settingsStore";

type StatusKind = "idle" | "thinking" | "error";

let statusEl: HTMLElement;
let activityEl: HTMLElement;
let logEl: HTMLElement;
let inputEl: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;
let stopBtn: HTMLButtonElement;
let gateEl: HTMLElement;
let sheetEl: HTMLElement;
let busy = false;
let activeStream: StreamHandle | null = null;
let activeRun: { agentId: string; runId: string } | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(kind: StatusKind, detail: string): void {
  statusEl.textContent =
    kind === "idle" ? "ONLINE" : kind === "thinking" ? "THINKING" : "ERROR";
  statusEl.classList.toggle("thinking", kind === "thinking");
  statusEl.classList.toggle("error", kind === "error");
  activityEl.textContent = detail;
}

function autoGrow(): void {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 120)}px`;
}

function renderMessages(): void {
  const session = getActiveSession();
  if (!session.messages.length) {
    logEl.innerHTML = `
      <div class="empty-hint">
        <strong>MINI-SHARD</strong>
        Спроси что угодно. Работает через Cursor Cloud Agents — без локальных моделей.
      </div>`;
    return;
  }
  logEl.innerHTML = session.messages
    .map((m) => {
      const role =
        m.role === "user" ? "YOU" : m.role === "assistant" ? "SHARD" : "SYS";
      return `<article class="msg ${m.role}" data-id="${m.id}">
        <div class="msg-role">${role}</div>
        <div class="msg-body">${escapeHtml(m.text) || "…"}</div>
      </article>`;
    })
    .join("");
  logEl.scrollTop = logEl.scrollHeight;
}

function markStreaming(messageId: string, on: boolean): void {
  const el = logEl.querySelector(`[data-id="${messageId}"]`);
  if (el) el.classList.toggle("streaming", on);
}

function updateComposer(): void {
  sendBtn.disabled = busy || !inputEl.value.trim() || !getSettings().apiKey;
  stopBtn.disabled = !busy;
}

function showGate(show: boolean, error = ""): void {
  gateEl.hidden = !show;
  const err = gateEl.querySelector(".error-banner") as HTMLElement | null;
  if (err) {
    err.hidden = !error;
    err.textContent = error;
  }
}

function showSheet(show: boolean): void {
  sheetEl.hidden = !show;
  if (show) renderSheet();
}

function renderSheet(): void {
  const settings = getSettings();
  const sessions = listSessions();
  const active = getActiveSession();
  const modelSelect = sheetEl.querySelector(
    "#modelSelect",
  ) as HTMLSelectElement | null;
  const keyInput = sheetEl.querySelector("#settingsKey") as HTMLInputElement | null;
  const userLabel = sheetEl.querySelector("#userLabel") as HTMLElement | null;
  const list = sheetEl.querySelector("#sessionList") as HTMLElement | null;

  if (keyInput) keyInput.value = settings.apiKey;
  if (userLabel) {
    userLabel.textContent = settings.userLabel
      ? `Аккаунт: ${settings.userLabel}`
      : "Ключ не проверен";
  }
  if (modelSelect) {
    const has = [...modelSelect.options].some((o) => o.value === settings.modelId);
    if (!has && settings.modelId) {
      const opt = document.createElement("option");
      opt.value = settings.modelId;
      opt.textContent = settings.modelId;
      modelSelect.appendChild(opt);
    }
    modelSelect.value = settings.modelId;
  }
  if (list) {
    list.innerHTML = sessions
      .map((s) => {
        const when = new Date(s.updatedAt).toLocaleString();
        return `<div class="session-item ${s.id === active.id ? "active" : ""}" data-id="${s.id}">
          <div>
            <div class="title">${escapeHtml(s.title)}</div>
            <div class="meta">${when}${s.agentId ? " · agent" : ""}</div>
          </div>
          <button type="button" class="ghost-btn" data-del="${s.id}">DEL</button>
        </div>`;
      })
      .join("");
  }
}

async function refreshModels(): Promise<void> {
  const { apiKey } = getSettings();
  if (!apiKey) return;
  const select = sheetEl.querySelector("#modelSelect") as HTMLSelectElement | null;
  if (!select) return;
  try {
    const models = await listModels(apiKey);
    const current = getSettings().modelId;
    select.innerHTML = "";
    const ids = models.map((m) => m.id);
    if (!ids.length) ids.push(current || "composer-2");
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      const meta = models.find((m) => m.id === id);
      opt.textContent = meta?.displayName ? `${meta.displayName} (${id})` : id;
      select.appendChild(opt);
    }
    select.value = ids.includes(current) ? current : ids[0];
    await saveModelId(select.value);
  } catch {
    /* keep existing */
  }
}

async function connectWithKey(apiKey: string): Promise<void> {
  const me = await getMe(apiKey);
  await saveApiKey(apiKey);
  await saveUserLabel(me.userEmail || me.apiKeyName || "Cursor");
  showGate(false);
  setStatus("idle", me.userEmail || "Cursor online");
  updateComposer();
  await refreshModels();
}

function humanError(err: unknown): string {
  if (err instanceof CursorApiError) {
    if (err.status === 401 || err.status === 403) {
      return "Неверный API key или нет доступа. Проверь ключ в Cursor Dashboard.";
    }
    if (err.status === 400) {
      return `${err.message} — возможно, для ключа недоступны no-repo agents.`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function sendMessage(): Promise<void> {
  const text = inputEl.value.trim();
  const { apiKey, modelId } = getSettings();
  if (!text || !apiKey || busy) return;

  busy = true;
  updateComposer();
  inputEl.value = "";
  autoGrow();
  setStatus("thinking", "Sending…");

  await addMessage("user", text);
  const assistant = await addMessage("assistant", "");
  renderMessages();
  markStreaming(assistant.id, true);

  let assembled = "";
  try {
    const session = getActiveSession();
    let agentId = session.agentId;
    let runId: string;

    if (!agentId) {
      setStatus("thinking", "Creating agent…");
      const promptText = session.bootstrapped
        ? text
        : `${STANDING_STYLE}\n\nUser: ${text}`;
      const created = await createAgent(apiKey, {
        prompt: { text: promptText },
        name: `MINI-SHARD ${new Date().toLocaleString()}`,
        model: modelId ? { id: modelId } : undefined,
        mode: "agent",
      });
      agentId = created.agentId;
      runId = created.runId;
      await setAgentId(agentId);
      await markBootstrapped();
    } else {
      setStatus("thinking", "Follow-up…");
      const created = await createRun(apiKey, agentId, {
        prompt: { text },
      });
      runId = created.runId;
    }

    activeRun = { agentId, runId };
    setStatus("thinking", "Streaming…");

    activeStream = streamRun(apiKey, agentId, runId, (ev) => {
      if (ev.type === "assistant" && ev.text) {
        assembled += ev.text;
        void setAssistantText(assistant.id, assembled).then(() => {
          const body = logEl.querySelector(
            `[data-id="${assistant.id}"] .msg-body`,
          );
          if (body) body.textContent = assembled || "…";
          logEl.scrollTop = logEl.scrollHeight;
        });
      } else if (ev.type === "status") {
        setStatus("thinking", ev.message || ev.status || "Working…");
      } else if (ev.type === "tool_call") {
        setStatus("thinking", ev.name ? `tool · ${ev.name}` : "tool");
      } else if (ev.type === "thinking" && ev.text) {
        setStatus("thinking", "Thinking…");
      } else if (ev.type === "error") {
        setStatus("error", ev.message);
      } else if (ev.type === "result" && ev.text && !assembled) {
        assembled = ev.text;
        void setAssistantText(assistant.id, assembled);
      }
    });

    await activeStream.done;

    if (!assembled) {
      assembled = "Готово, но ответ пустой.";
      await setAssistantText(assistant.id, assembled);
    }
    setStatus("idle", "ожидание");
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      if (!assembled) await setAssistantText(assistant.id, "Остановлено.");
      setStatus("idle", "stopped");
    } else {
      const msg = humanError(err);
      await appendAssistantDelta(assistant.id, assembled ? `\n\n[${msg}]` : msg);
      setStatus("error", msg);
    }
  } finally {
    markStreaming(assistant.id, false);
    renderMessages();
    busy = false;
    activeStream = null;
    activeRun = null;
    updateComposer();
  }
}

async function stopActive(): Promise<void> {
  const { apiKey } = getSettings();
  if (activeStream) activeStream.abort();
  if (apiKey && activeRun) {
    try {
      await cancelRun(apiKey, activeRun.agentId, activeRun.runId);
    } catch {
      /* ignore */
    }
  }
  setStatus("idle", "stopped");
}

function mountShell(host: HTMLElement): void {
  host.innerHTML = `
    <div class="hud">
      <div class="atmosphere" aria-hidden="true">
        <div class="atmosphere-grid"></div>
        <div class="atmosphere-glow"></div>
        <div class="scanlines"></div>
      </div>

      <header class="chrome">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <span class="brand-glyph">M</span>
            <span class="boot-line"></span>
          </div>
          <div class="brand-copy">
            <h1 class="hero-title">MINI-SHARD</h1>
            <div class="brand-meta">
              <span id="status" class="status">STANDBY</span>
              <span class="meta-sep">·</span>
              <span id="activity" class="activity">boot</span>
            </div>
          </div>
        </div>
        <div class="chrome-actions">
          <button id="btnNew" class="icon-btn" type="button" title="Новый чат" aria-label="Новый чат">+</button>
          <button id="btnSettings" class="icon-btn" type="button" title="Настройки" aria-label="Настройки">⚙</button>
        </div>
      </header>

      <main class="stage">
        <div id="log" class="log"></div>
        <div class="composer-bar">
          <textarea id="input" rows="1" placeholder="Ask MINI-SHARD…" enterkeyhint="send"></textarea>
          <button id="btnStop" class="action-btn danger" type="button" disabled>STOP</button>
          <button id="btnSend" class="primary-btn" type="button" disabled>SEND</button>
        </div>
      </main>

      <section id="gate" class="gate" hidden>
        <div class="gate-card">
          <h2>CURSOR UPLINK</h2>
          <p>Вставь API key из Cursor Dashboard → API Keys. Локальных моделей нет — только Cursor Cloud.</p>
          <div class="field">
            <label for="apiKey">API Key</label>
            <input id="apiKey" type="password" autocomplete="off" placeholder="key_…" />
          </div>
          <div class="row-actions">
            <button id="btnConnect" class="primary-btn" type="button">CONNECT</button>
          </div>
          <div class="error-banner" hidden></div>
        </div>
      </section>

      <section id="sheet" class="sheet" hidden>
        <div class="sheet-card">
          <h2>SETTINGS</h2>
          <p id="userLabel" class="field-hint">—</p>
          <div class="field">
            <label for="settingsKey">API Key</label>
            <input id="settingsKey" type="password" autocomplete="off" />
          </div>
          <div class="field">
            <label for="modelSelect">Model</label>
            <select id="modelSelect"></select>
          </div>
          <div class="row-actions">
            <button id="btnSaveSettings" class="primary-btn" type="button">SAVE</button>
            <button id="btnClearKey" class="action-btn danger" type="button">CLEAR KEY</button>
            <button id="btnCloseSheet" class="ghost-btn" type="button">CLOSE</button>
          </div>
          <h2 style="margin-top:18px">SESSIONS</h2>
          <div id="sessionList" class="session-list"></div>
        </div>
      </section>
    </div>
  `;

  statusEl = host.querySelector("#status")!;
  activityEl = host.querySelector("#activity")!;
  logEl = host.querySelector("#log")!;
  inputEl = host.querySelector("#input")!;
  sendBtn = host.querySelector("#btnSend")!;
  stopBtn = host.querySelector("#btnStop")!;
  gateEl = host.querySelector("#gate")!;
  sheetEl = host.querySelector("#sheet")!;

  host.querySelector("#btnSend")!.addEventListener("click", () => void sendMessage());
  host.querySelector("#btnStop")!.addEventListener("click", () => void stopActive());
  host.querySelector("#btnNew")!.addEventListener("click", () => {
    void (async () => {
      await newSession();
      renderMessages();
      setStatus("idle", "новый чат");
    })();
  });
  host.querySelector("#btnSettings")!.addEventListener("click", () => {
    showSheet(true);
    void refreshModels();
  });
  host.querySelector("#btnCloseSheet")!.addEventListener("click", () => showSheet(false));
  host.querySelector("#btnConnect")!.addEventListener("click", () => {
    const key = (host.querySelector("#apiKey") as HTMLInputElement).value.trim();
    void connectWithKey(key).catch((err) => showGate(true, humanError(err)));
  });
  host.querySelector("#btnSaveSettings")!.addEventListener("click", () => {
    void (async () => {
      const key = (host.querySelector("#settingsKey") as HTMLInputElement).value.trim();
      const model = (host.querySelector("#modelSelect") as HTMLSelectElement).value;
      try {
        if (key && key !== getSettings().apiKey) await connectWithKey(key);
        await saveModelId(model);
        showSheet(false);
        setStatus("idle", "settings saved");
      } catch (err) {
        setStatus("error", humanError(err));
      }
    })();
  });
  host.querySelector("#btnClearKey")!.addEventListener("click", () => {
    void (async () => {
      await clearApiKey();
      showSheet(false);
      showGate(true);
      updateComposer();
      setStatus("idle", "ключ очищен");
    })();
  });

  sheetEl.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const del = t.closest("[data-del]") as HTMLElement | null;
    const item = t.closest(".session-item") as HTMLElement | null;
    if (del) {
      ev.preventDefault();
      void (async () => {
        await deleteSession(del.getAttribute("data-del")!);
        renderSheet();
        renderMessages();
      })();
      return;
    }
    if (item?.dataset.id) {
      void (async () => {
        await setActiveSession(item.dataset.id!);
        showSheet(false);
        renderMessages();
      })();
    }
  });

  inputEl.addEventListener("input", () => {
    autoGrow();
    updateComposer();
  });
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void sendMessage();
    }
  });
}

export async function startApp(host: HTMLElement): Promise<void> {
  mountShell(host);
  await loadSettings();
  await loadSessions();
  renderMessages();
  updateComposer();

  if (!getSettings().apiKey) {
    showGate(true);
    setStatus("idle", "нужен API key");
  } else {
    try {
      await connectWithKey(getSettings().apiKey);
    } catch (err) {
      showGate(true, humanError(err));
      setStatus("error", "auth failed");
    }
  }
}
