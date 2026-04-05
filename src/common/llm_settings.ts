export interface LlmEndpointConfig {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
}

export interface LlmModelConfig {
  id: string;
  endpointId: string;
  modelName: string;
}

export interface LlmSettingsState {
  llmEndpoints: LlmEndpointConfig[];
  llmModels: LlmModelConfig[];
  selectedLlmEndpointId: string | null;
  selectedLlmModelId: string | null;
}

export interface ResolvedLlmConfig {
  endpointId: string;
  endpointName: string;
  endpoint: string;
  apiKey: string;
  modelId: string;
  modelName: string;
}

const INCOMPLETE_LLM_CONFIG_ERROR =
  "LLM設定（選択中のエンドポイント、APIキー、モデル名）が不完全です。設定を保存してからお試しください。";

export function deriveLlmEndpointName(
  endpoint: string,
  fallback: string,
): string {
  const trimmedEndpoint = endpoint.trim();

  if (!trimmedEndpoint) {
    return fallback;
  }

  try {
    const url = new URL(trimmedEndpoint);
    return url.hostname || fallback;
  } catch {
    return trimmedEndpoint;
  }
}

export function getLlmModelsForEndpoint(
  state: LlmSettingsState,
  endpointId: string | null,
): LlmModelConfig[] {
  if (!endpointId) {
    return [];
  }

  return state.llmModels.filter((model) => model.endpointId === endpointId);
}

export function getSelectedLlmEndpoint(
  state: LlmSettingsState,
): LlmEndpointConfig | null {
  if (state.llmEndpoints.length === 0) {
    return null;
  }

  return (
    state.llmEndpoints.find(
      (endpoint) => endpoint.id === state.selectedLlmEndpointId,
    ) ||
    state.llmEndpoints[0] ||
    null
  );
}

export function getSelectedLlmModel(
  state: LlmSettingsState,
): LlmModelConfig | null {
  const selectedEndpoint = getSelectedLlmEndpoint(state);

  if (!selectedEndpoint) {
    return null;
  }

  const models = getLlmModelsForEndpoint(state, selectedEndpoint.id);
  if (models.length === 0) {
    return null;
  }

  return (
    models.find((model) => model.id === state.selectedLlmModelId) ||
    models[0] ||
    null
  );
}

export function normalizeLlmSettings<T extends LlmSettingsState>(
  settings: T,
): T {
  const selectedEndpoint = getSelectedLlmEndpoint(settings);
  const selectedModel = getSelectedLlmModel(settings);

  return {
    ...settings,
    selectedLlmEndpointId: selectedEndpoint?.id ?? null,
    selectedLlmModelId: selectedModel?.id ?? null,
  };
}

export function sanitizeLlmSettings<T extends LlmSettingsState>(
  settings: T,
): T {
  const llmEndpoints = settings.llmEndpoints.map((endpoint, index) => ({
    id: endpoint.id.trim() || `endpoint-${index + 1}`,
    name:
      endpoint.name.trim() ||
      deriveLlmEndpointName(endpoint.endpoint, `Endpoint ${index + 1}`),
    endpoint: endpoint.endpoint.trim(),
    apiKey: endpoint.apiKey.trim(),
  }));

  const llmEndpointIds = new Set(llmEndpoints.map((endpoint) => endpoint.id));
  const llmModels = settings.llmModels
    .filter((model) => llmEndpointIds.has(model.endpointId))
    .map((model, index) => ({
      id: model.id.trim() || `model-${index + 1}`,
      endpointId: model.endpointId,
      modelName: model.modelName.trim(),
    }));

  return normalizeLlmSettings({
    ...settings,
    llmEndpoints,
    llmModels,
  });
}

export function resolveSelectedLlmConfig(settings: LlmSettingsState): {
  config?: ResolvedLlmConfig;
  error?: string;
} {
  const selectedEndpoint = getSelectedLlmEndpoint(settings);
  const selectedModel = getSelectedLlmModel(settings);

  if (!selectedEndpoint || !selectedModel) {
    return {
      error: INCOMPLETE_LLM_CONFIG_ERROR,
    };
  }

  const endpoint = selectedEndpoint.endpoint.trim();
  const apiKey = selectedEndpoint.apiKey.trim();
  const modelName = selectedModel.modelName.trim();

  if (!endpoint || !apiKey || !modelName) {
    return {
      error: INCOMPLETE_LLM_CONFIG_ERROR,
    };
  }

  return {
    config: {
      endpointId: selectedEndpoint.id,
      endpointName: selectedEndpoint.name,
      endpoint,
      apiKey,
      modelId: selectedModel.id,
      modelName,
    },
  };
}
