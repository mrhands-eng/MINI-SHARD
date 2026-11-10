import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  CreateAgentRequest,
  CreateAgentResponse,
  CreateRunRequest,
  CreateRunResponse,
  CursorApiError,
  CursorMe,
  CursorModel,
  CursorModelsResponse,
  StreamEvent,
} from "./types";

/** Native APK → api.cursor.com. Local web → Vite proxy (no CORS). */
function apiBase(): string {
  if (Capacitor.isNativePlatform()) return "https://api.cursor.com";
  if (
    typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ) {
    return "";
  }
  return "https://api.cursor.com";
}

function authHeader(apiKey: string): string {
  const basic = btoa(`${apiKey}:`);
  return `Basic ${basic}`;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function parseErrorPayload(
  status: number,
  body: unknown,
): Promise<CursorApiError> {
  let message = `HTTP ${status}`;
  let code: string | undefined;
  let payload: unknown = body;
  if (typeof payload === "string") {
    const raw = payload;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return new CursorApiError(raw || message, status);
    }
  }
  if (payload && typeof payload === "object") {
    const obj = payload as {
      error?: { message?: string; code?: string } | string;
      message?: string;
      code?: string;
    };
    if (typeof obj.error === "string") message = obj.error;
    else if (obj.error && typeof obj.error === "object" && obj.error.message) {
      message = obj.error.message;
    } else if (obj.message) message = obj.message;
    code =
      (obj.error && typeof obj.error === "object" ? obj.error.code : undefined) ||
      obj.code;
  }
  return new CursorApiError(message, status, code);
}

async function parseError(res: Response): Promise<CursorApiError> {
  try {
    const body = await res.json();
    return parseErrorPayload(res.status, body);
  } catch {
    try {
      return parseErrorPayload(res.status, await res.text());
    } catch {
      return new CursorApiError(`HTTP ${res.status}`, res.status);
    }
  }
}

async function apiFetch<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader(apiKey));
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = (init.method ?? "GET").toUpperCase();
  const url = `${apiBase()}${path}`;

  // Native: CapacitorHttp bypasses WebView CORS (no streaming here).
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url,
      method,
      headers: headersToObject(headers),
      data: init.body ? JSON.parse(String(init.body)) : undefined,
      connectTimeout: 60_000,
      readTimeout: 120_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw await parseErrorPayload(response.status, response.data);
    }
    if (response.status === 204) return undefined as T;
    return response.data as T;
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function getMe(apiKey: string): Promise<CursorMe> {
  return apiFetch<CursorMe>(apiKey, "/v1/me");
}

export async function listModels(apiKey: string): Promise<CursorModel[]> {
  const data = await apiFetch<CursorModelsResponse>(apiKey, "/v1/models");
  return data.recommendedModels ?? data.models ?? [];
}

export async function createAgent(
  apiKey: string,
  body: CreateAgentRequest,
): Promise<{ agentId: string; runId: string }> {
  const data = await apiFetch<CreateAgentResponse>(apiKey, "/v1/agents", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const agentId = data.agent?.id ?? data.id;
  const runId = data.run?.id;
  if (!agentId || !runId) {
    throw new CursorApiError(
      "Create agent response missing agent/run id",
      500,
      "bad_response",
    );
  }
  return { agentId, runId };
}

export async function createRun(
  apiKey: string,
  agentId: string,
  body: CreateRunRequest,
): Promise<{ runId: string }> {
  const data = await apiFetch<CreateRunResponse>(
    apiKey,
    `/v1/agents/${encodeURIComponent(agentId)}/runs`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  const runId = data.run?.id ?? data.id;
  if (!runId) {
    throw new CursorApiError(
      "Create run response missing run id",
      500,
      "bad_response",
    );
  }
  return { runId };
}

export async function getRun(
  apiKey: string,
  agentId: string,
  runId: string,
): Promise<{ status?: string; result?: unknown }> {
  return apiFetch(
    apiKey,
    `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
  );
}

export async function cancelRun(
  apiKey: string,
  agentId: string,
  runId: string,
): Promise<void> {
  await apiFetch(
    apiKey,
    `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );
}

function extractAssistantText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.result === "string") return obj.result;
  const message = obj.message as
    | { content?: Array<{ type?: string; text?: string }> }
    | undefined;
  if (message?.content?.length) {
    return message.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
  }
  if (typeof obj.delta === "string") return obj.delta;
  return "";
}

function normalizeSseEvent(eventName: string, data: unknown): StreamEvent {
  const name = eventName || "message";
  if (name === "heartbeat" || name === "ping") return { type: "heartbeat" };
  if (name === "done") return { type: "done" };
  if (name === "error") {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : String(data ?? "Stream error");
    return { type: "error", message: msg };
  }
  if (name === "assistant" || name === "message") {
    const text = extractAssistantText(data);
    return { type: "assistant", text };
  }
  if (name === "thinking") {
    return {
      type: "thinking",
      text: extractAssistantText(data) || undefined,
    };
  }
  if (name === "status") {
    const obj = (data ?? {}) as { status?: string; message?: string };
    return { type: "status", status: obj.status, message: obj.message };
  }
  if (name === "tool_call" || name === "tool") {
    const obj = (data ?? {}) as { name?: string; status?: string };
    return { type: "tool_call", name: obj.name, status: obj.status };
  }
  if (name === "result") {
    return { type: "result", text: extractAssistantText(data) || undefined };
  }
  return { type: "unknown", raw: { name, data } };
}

function parseSseChunk(
  buffer: string,
  onEvent: (ev: StreamEvent) => void,
): string {
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    if (!block.trim() || block.startsWith(":")) continue;
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    const raw = dataLines.join("\n");
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* keep string */
    }
    onEvent(normalizeSseEvent(eventName, data));
  }
  return rest;
}

export type StreamHandle = {
  abort: () => void;
  done: Promise<void>;
};

async function pollUntilDone(
  apiKey: string,
  agentId: string,
  runId: string,
  onEvent: (ev: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const started = Date.now();
  let lastText = "";
  while (!signal.aborted && Date.now() - started < 10 * 60_000) {
    const run = await getRun(apiKey, agentId, runId);
    const status = (run.status ?? "").toLowerCase();
    onEvent({ type: "status", status });
    const text =
      typeof run.result === "string"
        ? run.result
        : extractAssistantText(run.result);
    if (text && text !== lastText) {
      // Emit only the delta when possible
      const delta = text.startsWith(lastText) ? text.slice(lastText.length) : text;
      lastText = text;
      onEvent({ type: "assistant", text: delta });
    }
    if (
      status === "finished" ||
      status === "completed" ||
      status === "done" ||
      status === "success"
    ) {
      if (text && text !== lastText) onEvent({ type: "assistant", text });
      onEvent({ type: "done" });
      return;
    }
    if (
      status === "failed" ||
      status === "error" ||
      status === "cancelled" ||
      status === "canceled"
    ) {
      onEvent({ type: "error", message: `Run ${status}` });
      onEvent({ type: "done" });
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!signal.aborted) {
    onEvent({ type: "error", message: "Timed out waiting for run" });
    onEvent({ type: "done" });
  }
}

export function streamRun(
  apiKey: string,
  agentId: string,
  runId: string,
  onEvent: (ev: StreamEvent) => void,
): StreamHandle {
  const controller = new AbortController();

  // Native WebView: skip SSE (CapacitorHttp has no stream); poll run status.
  if (Capacitor.isNativePlatform()) {
    const done = pollUntilDone(
      apiKey,
      agentId,
      runId,
      onEvent,
      controller.signal,
    );
    return {
      abort: () => controller.abort(),
      done,
    };
  }

  const done = (async () => {
    const url = `${apiBase()}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authHeader(apiKey),
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
      if (!res.ok) throw await parseError(res);
      if (!res.body) {
        await pollUntilDone(apiKey, agentId, runId, onEvent, controller.signal);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, (ev) => {
          if (ev.type === "done") sawDone = true;
          onEvent(ev);
        });
      }
      if (buffer.trim()) {
        parseSseChunk(buffer + "\n\n", (ev) => {
          if (ev.type === "done") sawDone = true;
          onEvent(ev);
        });
      }
      if (!sawDone && !controller.signal.aborted) {
        await pollUntilDone(apiKey, agentId, runId, onEvent, controller.signal);
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      await pollUntilDone(apiKey, agentId, runId, onEvent, controller.signal);
    }
  })();

  return {
    abort: () => controller.abort(),
    done,
  };
}

export const STANDING_STYLE = [
  "You are MINI-SHARD — a compact mobile aide powered by Cursor.",
  "Reply briefly and naturally, like a sharp human assistant.",
  "Prefer short answers. No tools. No markdown fences unless asked.",
  "Language: match the user (Russian or English).",
].join(" ");
