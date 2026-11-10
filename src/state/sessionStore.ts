import { storage } from "../platform/storage";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
};

export type ChatSession = {
  id: string;
  title: string;
  agentId: string | null;
  bootstrapped: boolean;
  messages: ChatMessage[];
  updatedAt: number;
};

const KEY_SESSIONS = "mini_shard_sessions_v1";
const KEY_ACTIVE = "mini_shard_active_session";

let sessions: ChatSession[] = [];
let activeId: string | null = null;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function persist(): Promise<void> {
  await storage.setItem(KEY_SESSIONS, JSON.stringify(sessions));
  if (activeId) await storage.setItem(KEY_ACTIVE, activeId);
  else await storage.removeItem(KEY_ACTIVE);
}

export async function loadSessions(): Promise<void> {
  const raw = await storage.getItem(KEY_SESSIONS);
  const active = await storage.getItem(KEY_ACTIVE);
  if (raw) {
    try {
      sessions = JSON.parse(raw) as ChatSession[];
    } catch {
      sessions = [];
    }
  }
  activeId = active;
  if (!sessions.length) {
    const s = createEmptySession();
    sessions = [s];
    activeId = s.id;
    await persist();
  } else if (!activeId || !sessions.some((s) => s.id === activeId)) {
    activeId = sessions[0].id;
    await persist();
  }
}

function createEmptySession(): ChatSession {
  return {
    id: uid("chat"),
    title: "Новый чат",
    agentId: null,
    bootstrapped: false,
    messages: [],
    updatedAt: Date.now(),
  };
}

export function listSessions(): ChatSession[] {
  return sessions
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({ ...s, messages: s.messages.slice() }));
}

export function getActiveSession(): ChatSession {
  const s = sessions.find((x) => x.id === activeId) ?? sessions[0];
  return {
    ...s,
    messages: s.messages.slice(),
  };
}

export async function setActiveSession(id: string): Promise<void> {
  if (!sessions.some((s) => s.id === id)) return;
  activeId = id;
  await persist();
}

export async function newSession(): Promise<ChatSession> {
  const s = createEmptySession();
  sessions.unshift(s);
  activeId = s.id;
  await persist();
  return getActiveSession();
}

export async function deleteSession(id: string): Promise<void> {
  sessions = sessions.filter((s) => s.id !== id);
  if (!sessions.length) {
    const s = createEmptySession();
    sessions = [s];
    activeId = s.id;
  } else if (activeId === id) {
    activeId = sessions[0].id;
  }
  await persist();
}

function mutateActive(mutator: (s: ChatSession) => void): ChatSession {
  const idx = sessions.findIndex((s) => s.id === activeId);
  if (idx < 0) throw new Error("No active session");
  mutator(sessions[idx]);
  sessions[idx].updatedAt = Date.now();
  return sessions[idx];
}

export async function addMessage(
  role: ChatRole,
  text: string,
): Promise<ChatMessage> {
  const msg: ChatMessage = {
    id: uid("msg"),
    role,
    text,
    createdAt: Date.now(),
  };
  mutateActive((s) => {
    s.messages.push(msg);
    if (role === "user" && s.title === "Новый чат") {
      s.title = text.trim().slice(0, 42) || s.title;
    }
  });
  await persist();
  return msg;
}

export async function appendAssistantDelta(
  messageId: string,
  delta: string,
): Promise<void> {
  mutateActive((s) => {
    const m = s.messages.find((x) => x.id === messageId);
    if (m) m.text += delta;
  });
  await persist();
}

export async function setAssistantText(
  messageId: string,
  text: string,
): Promise<void> {
  mutateActive((s) => {
    const m = s.messages.find((x) => x.id === messageId);
    if (m) m.text = text;
  });
  await persist();
}

export async function setAgentId(agentId: string): Promise<void> {
  mutateActive((s) => {
    s.agentId = agentId;
  });
  await persist();
}

export async function markBootstrapped(): Promise<void> {
  mutateActive((s) => {
    s.bootstrapped = true;
  });
  await persist();
}
