export type CursorMe = {
  apiKeyName?: string;
  userEmail?: string;
  createdAt?: string;
};

export type CursorModel = {
  id: string;
  displayName?: string;
  params?: Array<{ id: string; values?: string[] }>;
};

export type CursorModelsResponse = {
  models?: CursorModel[];
  recommendedModels?: CursorModel[];
};

export type AgentPrompt = {
  text: string;
};

export type CreateAgentRequest = {
  prompt: AgentPrompt;
  name?: string;
  model?: { id: string; params?: Array<{ id: string; value: string }> };
  mode?: "agent" | "plan";
};

export type CreateRunRequest = {
  prompt: AgentPrompt;
};

export type CursorAgent = {
  id: string;
  name?: string;
  status?: string;
  createdAt?: string;
};

export type CursorRun = {
  id: string;
  status?: string;
  createdAt?: string;
};

export type CreateAgentResponse = {
  agent?: CursorAgent;
  id?: string;
  run?: CursorRun;
};

export type CreateRunResponse = {
  id?: string;
  run?: CursorRun;
  status?: string;
};

export type StreamEvent =
  | { type: "status"; status?: string; message?: string }
  | { type: "assistant"; text: string }
  | { type: "thinking"; text?: string }
  | { type: "tool_call"; name?: string; status?: string }
  | { type: "result"; text?: string }
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "heartbeat" }
  | { type: "unknown"; raw: unknown };

export class CursorApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CursorApiError";
    this.status = status;
    this.code = code;
  }
}
