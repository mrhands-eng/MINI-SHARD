import { storage } from "../platform/storage";

const KEY_API = "mini_shard_api_key";
const KEY_MODEL = "mini_shard_model_id";
const KEY_USER = "mini_shard_user_label";

export type Settings = {
  apiKey: string;
  modelId: string;
  userLabel: string;
};

const DEFAULT_MODEL = "composer-2";

let cache: Settings = {
  apiKey: "",
  modelId: DEFAULT_MODEL,
  userLabel: "",
};

export async function loadSettings(): Promise<Settings> {
  const [apiKey, modelId, userLabel] = await Promise.all([
    storage.getItem(KEY_API),
    storage.getItem(KEY_MODEL),
    storage.getItem(KEY_USER),
  ]);
  cache = {
    apiKey: apiKey ?? "",
    modelId: modelId || DEFAULT_MODEL,
    userLabel: userLabel ?? "",
  };
  return { ...cache };
}

export function getSettings(): Settings {
  return { ...cache };
}

export async function saveApiKey(apiKey: string): Promise<void> {
  cache.apiKey = apiKey.trim();
  if (cache.apiKey) await storage.setItem(KEY_API, cache.apiKey);
  else await storage.removeItem(KEY_API);
}

export async function saveModelId(modelId: string): Promise<void> {
  cache.modelId = modelId || DEFAULT_MODEL;
  await storage.setItem(KEY_MODEL, cache.modelId);
}

export async function saveUserLabel(label: string): Promise<void> {
  cache.userLabel = label;
  if (label) await storage.setItem(KEY_USER, label);
  else await storage.removeItem(KEY_USER);
}

export async function clearApiKey(): Promise<void> {
  cache.apiKey = "";
  cache.userLabel = "";
  await storage.removeItem(KEY_API);
  await storage.removeItem(KEY_USER);
}

export { DEFAULT_MODEL };
