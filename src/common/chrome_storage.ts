import {
  CONTENT_EXTRACTOR_PROVIDERS,
  type ContentExtractorProvider,
  DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
  DEFAULT_FIRECRAWL_BASE_URL,
} from "./constants";
import {
  type LlmEndpointConfig,
  type LlmModelConfig,
  normalizeLlmSettings,
  sanitizeLlmSettings,
} from "./llm_settings";

export interface Settings {
  daysUntilRead: number;
  daysUntilDelete: number;
  maxEntriesPerRun?: number;
  alarmIntervalMinutes?: number;
  llmEndpoints: LlmEndpointConfig[];
  llmModels: LlmModelConfig[];
  selectedLlmEndpointId: string | null;
  selectedLlmModelId: string | null;
  slackWebhookUrl?: string;
  contentExtractorProvider?: ContentExtractorProvider;
  tavilyApiKey?: string;
  firecrawlApiKey?: string;
  firecrawlBaseUrl?: string;
  systemPrompt?: string;
}

export type ValidatedSettings = Settings & { readonly validated: true };

type StoredLlmSettings = Pick<
  Settings,
  "llmEndpoints" | "llmModels" | "selectedLlmEndpointId" | "selectedLlmModelId"
>;

interface StoredSettings extends Record<string, unknown> {
  daysUntilRead?: unknown;
  daysUntilDelete?: unknown;
  maxEntriesPerRun?: unknown;
  alarmIntervalMinutes?: unknown;
  llmEndpoints?: unknown;
  llmModels?: unknown;
  selectedLlmEndpointId?: unknown;
  selectedLlmModelId?: unknown;
  openaiEndpoint?: unknown;
  openaiApiKey?: unknown;
  openaiModel?: unknown;
  slackWebhookUrl?: unknown;
  contentExtractorProvider?: unknown;
  tavilyApiKey?: unknown;
  firecrawlApiKey?: unknown;
  firecrawlBaseUrl?: unknown;
  systemPrompt?: unknown;
}

const SETTINGS_STORAGE_KEYS = [
  "daysUntilRead",
  "daysUntilDelete",
  "maxEntriesPerRun",
  "alarmIntervalMinutes",
  "llmEndpoints",
  "llmModels",
  "selectedLlmEndpointId",
  "selectedLlmModelId",
  "openaiEndpoint",
  "openaiApiKey",
  "openaiModel",
  "slackWebhookUrl",
  "contentExtractorProvider",
  "tavilyApiKey",
  "firecrawlApiKey",
  "firecrawlBaseUrl",
  "systemPrompt",
] as const;

const LEGACY_LLM_STORAGE_KEYS = [
  "openaiEndpoint",
  "openaiApiKey",
  "openaiModel",
] as const;

const LEGACY_ENDPOINT_ID = "legacy-endpoint";
const LEGACY_MODEL_ID = "legacy-model";
const EMPTY_LLM_SETTINGS: StoredLlmSettings = {
  llmEndpoints: [],
  llmModels: [],
  selectedLlmEndpointId: null,
  selectedLlmModelId: null,
};

// 実行間隔（分）のデフォルト値
export const DEFAULT_INTERVAL_MINUTES = 720;

// デフォルトのシステムプロンプト
export const DEFAULT_SYSTEM_PROMPT =
  "テキストから本文を抜き出し、日本語で要約してください。\n" +
  "要約は技術的な内容に焦点を当て、 **3文に分けて** 600文字程度にしてください。\n\n" +
  "<format>\n" +
  "section1\n\n" +
  "section2\n\n" +
  "section3\n" +
  "</format>\n\n" +
  "<example>\n" +
  "macOSのコマンドラインツールが設定ファイルを~/Library/Application Supportに配置するのは不適切であり、ユーザーの期待やXDG Base Directory Specificationに反していると筆者は主張しています。\n\n" +
  "多くのCLIツールやdotfileマネージャーも~/.configをデフォルトとしており、~/Library/Application SupportはGUIアプリケーションがユーザーに代わって設定を管理する場合にのみ適していると結論付けています。\n" +
  "</example>";

// 削除機能を無効にする値
export const DELETION_DISABLED_VALUE = -1;

// デフォルト設定
export const DEFAULT_SETTINGS: Settings = {
  daysUntilRead: 30,
  daysUntilDelete: DELETION_DISABLED_VALUE,
  maxEntriesPerRun: 3,
  alarmIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
  llmEndpoints: [],
  llmModels: [],
  selectedLlmEndpointId: null,
  selectedLlmModelId: null,
  contentExtractorProvider: DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
  firecrawlBaseUrl: DEFAULT_FIRECRAWL_BASE_URL,
};

const DEFAULT_MAX_ENTRIES_PER_RUN = DEFAULT_SETTINGS.maxEntriesPerRun ?? 3;
const DEFAULT_ALARM_INTERVAL_MINUTES =
  DEFAULT_SETTINGS.alarmIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES;

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStoredArray<T>(
  value: unknown,
  parseEntry: (entry: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const parsedEntry = parseEntry(entry);
    return parsedEntry ? [parsedEntry] : [];
  });
}

function parseLlmEndpoint(entry: unknown): LlmEndpointConfig | null {
  if (!isRecord(entry)) {
    return null;
  }

  const id = getStringValue(entry.id);
  const name = getStringValue(entry.name);
  const endpoint = getStringValue(entry.endpoint);
  const apiKey = getStringValue(entry.apiKey);

  if (
    !id ||
    name === undefined ||
    endpoint === undefined ||
    apiKey === undefined
  ) {
    return null;
  }

  return {
    id,
    name,
    endpoint,
    apiKey,
  };
}

function parseLlmEndpoints(value: unknown): LlmEndpointConfig[] {
  return parseStoredArray(value, parseLlmEndpoint);
}

function parseLlmModel(entry: unknown): LlmModelConfig | null {
  if (!isRecord(entry)) {
    return null;
  }

  const id = getStringValue(entry.id);
  const endpointId = getStringValue(entry.endpointId);
  const modelName = getStringValue(entry.modelName);

  if (!id || !endpointId || modelName === undefined) {
    return null;
  }

  return {
    id,
    endpointId,
    modelName,
  };
}

function parseLlmModels(value: unknown): LlmModelConfig[] {
  return parseStoredArray(value, parseLlmModel);
}

function getTrimmedStringValue(value: unknown): string {
  return getStringValue(value)?.trim() || "";
}

function migrateLegacyLlmSettings(result: StoredSettings): StoredLlmSettings {
  const legacyEndpoint = getTrimmedStringValue(result.openaiEndpoint);
  const legacyApiKey = getTrimmedStringValue(result.openaiApiKey);
  const legacyModel = getTrimmedStringValue(result.openaiModel);

  if (!legacyEndpoint && !legacyApiKey && !legacyModel) {
    return EMPTY_LLM_SETTINGS;
  }

  const llmEndpoints: LlmEndpointConfig[] = [
    {
      id: LEGACY_ENDPOINT_ID,
      name: "Migrated endpoint",
      endpoint: legacyEndpoint,
      apiKey: legacyApiKey,
    },
  ];

  const llmModels: LlmModelConfig[] = legacyModel
    ? [
        {
          id: LEGACY_MODEL_ID,
          endpointId: LEGACY_ENDPOINT_ID,
          modelName: legacyModel,
        },
      ]
    : [];

  return {
    llmEndpoints,
    llmModels,
    selectedLlmEndpointId: LEGACY_ENDPOINT_ID,
    selectedLlmModelId: llmModels[0]?.id ?? null,
  };
}

function resolveStoredLlmSettings(result: StoredSettings): StoredLlmSettings {
  const llmEndpoints = parseLlmEndpoints(result.llmEndpoints);
  const llmModels = parseLlmModels(result.llmModels);

  if (llmEndpoints.length === 0 && llmModels.length === 0) {
    return migrateLegacyLlmSettings(result);
  }

  return {
    llmEndpoints,
    llmModels,
    selectedLlmEndpointId: getStringValue(result.selectedLlmEndpointId) ?? null,
    selectedLlmModelId: getStringValue(result.selectedLlmModelId) ?? null,
  };
}

type SettingsToSave = Record<
  string,
  string | number | LlmEndpointConfig[] | LlmModelConfig[] | null
>;
const REMOVABLE_OPTIONAL_KEYS = [
  "slackWebhookUrl",
  "tavilyApiKey",
  "firecrawlApiKey",
  "systemPrompt",
] as const;

function addOptionalSetting(
  settingsToSave: SettingsToSave,
  key: keyof Settings,
  value: string | ContentExtractorProvider | undefined,
): void {
  if (value !== undefined) {
    settingsToSave[key] = value;
  }
}

function getOptionalKeysToRemove(settings: Settings): string[] {
  const keysToRemove = [...LEGACY_LLM_STORAGE_KEYS] as string[];

  for (const key of REMOVABLE_OPTIONAL_KEYS) {
    const value = settings[key];
    if (typeof value === "string" && value === "") {
      keysToRemove.push(key);
    }
  }

  return keysToRemove;
}

function createSettingsToSave(settings: Settings): SettingsToSave {
  const settingsToSave: SettingsToSave = {
    daysUntilRead: settings.daysUntilRead,
    daysUntilDelete: settings.daysUntilDelete,
    maxEntriesPerRun: settings.maxEntriesPerRun ?? DEFAULT_MAX_ENTRIES_PER_RUN,
    alarmIntervalMinutes:
      settings.alarmIntervalMinutes ?? DEFAULT_ALARM_INTERVAL_MINUTES,
    llmEndpoints: settings.llmEndpoints,
    llmModels: settings.llmModels,
    selectedLlmEndpointId: settings.selectedLlmEndpointId,
    selectedLlmModelId: settings.selectedLlmModelId,
  };

  addOptionalSetting(
    settingsToSave,
    "slackWebhookUrl",
    settings.slackWebhookUrl,
  );
  addOptionalSetting(
    settingsToSave,
    "contentExtractorProvider",
    settings.contentExtractorProvider,
  );
  addOptionalSetting(settingsToSave, "tavilyApiKey", settings.tavilyApiKey);
  addOptionalSetting(
    settingsToSave,
    "firecrawlApiKey",
    settings.firecrawlApiKey,
  );
  addOptionalSetting(
    settingsToSave,
    "firecrawlBaseUrl",
    settings.firecrawlBaseUrl,
  );
  if (settings.systemPrompt !== undefined) {
    settingsToSave.systemPrompt = settings.systemPrompt;
  }

  return settingsToSave;
}

function parseContentExtractorProvider(
  value: unknown,
  firecrawlApiKey: string | undefined,
  firecrawlBaseUrl: string | undefined,
): ContentExtractorProvider {
  if (
    typeof value === "string" &&
    CONTENT_EXTRACTOR_PROVIDERS.includes(value as ContentExtractorProvider)
  ) {
    return value as ContentExtractorProvider;
  }

  const hasFirecrawlConfig = Boolean(
    firecrawlApiKey?.trim() || firecrawlBaseUrl?.trim(),
  );

  return hasFirecrawlConfig ? "firecrawl" : DEFAULT_CONTENT_EXTRACTOR_PROVIDER;
}

/**
 * chrome.storage.localから設定を取得
 */
export async function getSettings(): Promise<Settings> {
  try {
    const result = (await chrome.storage.local.get([
      ...SETTINGS_STORAGE_KEYS,
    ])) as StoredSettings;

    const firecrawlApiKey = getStringValue(result.firecrawlApiKey);
    const firecrawlBaseUrl = getStringValue(result.firecrawlBaseUrl);
    const llmSettings = resolveStoredLlmSettings(result);
    const slackWebhookUrl = getStringValue(result.slackWebhookUrl);
    const tavilyApiKey = getStringValue(result.tavilyApiKey);
    const systemPrompt = getStringValue(result.systemPrompt);

    return normalizeLlmSettings({
      daysUntilRead:
        getNumberValue(result.daysUntilRead) ?? DEFAULT_SETTINGS.daysUntilRead,
      daysUntilDelete:
        getNumberValue(result.daysUntilDelete) ??
        DEFAULT_SETTINGS.daysUntilDelete,
      maxEntriesPerRun:
        getNumberValue(result.maxEntriesPerRun) ?? DEFAULT_MAX_ENTRIES_PER_RUN,
      alarmIntervalMinutes:
        getNumberValue(result.alarmIntervalMinutes) ??
        DEFAULT_ALARM_INTERVAL_MINUTES,
      contentExtractorProvider: parseContentExtractorProvider(
        result.contentExtractorProvider,
        firecrawlApiKey,
        firecrawlBaseUrl,
      ),
      firecrawlBaseUrl: firecrawlBaseUrl || DEFAULT_FIRECRAWL_BASE_URL,
      ...llmSettings,
      ...(slackWebhookUrl !== undefined ? { slackWebhookUrl } : {}),
      ...(tavilyApiKey !== undefined ? { tavilyApiKey } : {}),
      ...(firecrawlApiKey !== undefined ? { firecrawlApiKey } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    });
  } catch (error) {
    console.error("設定取得エラー:", error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * chrome.storage.localに設定を保存
 */
export async function saveSettings(settings: ValidatedSettings): Promise<void> {
  try {
    const sanitizedSettings = sanitizeLlmSettings(settings);
    const settingsToSave = createSettingsToSave(sanitizedSettings);
    await chrome.storage.local.remove(
      getOptionalKeysToRemove(sanitizedSettings),
    );
    await chrome.storage.local.set(settingsToSave);
  } catch (error) {
    console.error("設定保存エラー:", error);
    throw error;
  }
}

function validateLlmSettings(
  settings: Settings,
  errors: string[],
  selectedState: {
    selectedLlmEndpointId: string | null;
    selectedLlmModelId: string | null;
  },
): void {
  const endpointIds = new Set(
    settings.llmEndpoints.map((endpoint) => endpoint.id),
  );

  for (const endpoint of settings.llmEndpoints) {
    if (!endpoint.id.trim()) {
      errors.push("LLMエンドポイントIDが不正です");
      continue;
    }

    if (endpoint.endpoint.trim() !== "") {
      try {
        new URL(endpoint.endpoint);
      } catch {
        errors.push("LLM APIエンドポイントは有効なURLで入力してください");
      }
    }
  }

  for (const model of settings.llmModels) {
    if (!model.id.trim()) {
      errors.push("LLMモデルIDが不正です");
      continue;
    }

    if (!endpointIds.has(model.endpointId)) {
      errors.push("LLMモデルの紐付け先エンドポイントが不正です");
    }
  }

  if (
    selectedState.selectedLlmEndpointId &&
    !endpointIds.has(selectedState.selectedLlmEndpointId)
  ) {
    errors.push("選択中のLLMエンドポイントが存在しません");
  }

  const selectedModel = settings.llmModels.find(
    (model) => model.id === selectedState.selectedLlmModelId,
  );
  if (selectedState.selectedLlmModelId && !selectedModel) {
    errors.push("選択中のLLMモデルが存在しません");
  }

  if (
    selectedState.selectedLlmEndpointId &&
    selectedModel &&
    selectedModel.endpointId !== selectedState.selectedLlmEndpointId
  ) {
    errors.push("選択中のLLMモデルが選択中のエンドポイントに紐付いていません");
  }
}

/**
 * 設定の妥当性チェック
 */
export function validateSettings(settings: Partial<Settings>): {
  errors: string[];
  validatedSettings?: ValidatedSettings;
} {
  const errors: string[] = [];
  const selectedState = {
    selectedLlmEndpointId:
      settings.selectedLlmEndpointId ?? DEFAULT_SETTINGS.selectedLlmEndpointId,
    selectedLlmModelId:
      settings.selectedLlmModelId ?? DEFAULT_SETTINGS.selectedLlmModelId,
  };
  const normalizedSettings = sanitizeLlmSettings({
    ...DEFAULT_SETTINGS,
    ...settings,
    llmEndpoints: settings.llmEndpoints ?? DEFAULT_SETTINGS.llmEndpoints,
    llmModels: settings.llmModels ?? DEFAULT_SETTINGS.llmModels,
    ...selectedState,
  });
  const maxEntriesPerRun =
    normalizedSettings.maxEntriesPerRun ?? DEFAULT_MAX_ENTRIES_PER_RUN;
  const alarmIntervalMinutes =
    normalizedSettings.alarmIntervalMinutes ?? DEFAULT_ALARM_INTERVAL_MINUTES;

  if (
    !Number.isInteger(normalizedSettings.daysUntilRead) ||
    normalizedSettings.daysUntilRead < 1 ||
    normalizedSettings.daysUntilRead > 365
  ) {
    errors.push("既読化までの日数は1-365の整数で入力してください");
  }

  if (
    !Number.isInteger(normalizedSettings.daysUntilDelete) ||
    (normalizedSettings.daysUntilDelete !== DELETION_DISABLED_VALUE &&
      (normalizedSettings.daysUntilDelete < 1 ||
        normalizedSettings.daysUntilDelete > 365))
  ) {
    errors.push("削除までの日数は-1または1-365の整数で入力してください");
  }

  if (
    !Number.isInteger(maxEntriesPerRun) ||
    maxEntriesPerRun < 1 ||
    maxEntriesPerRun > 100
  ) {
    errors.push(
      "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
    );
  }

  if (!Number.isInteger(alarmIntervalMinutes) || alarmIntervalMinutes < 1) {
    errors.push("実行間隔（分）は1以上の整数で入力してください");
  }

  if (
    normalizedSettings.slackWebhookUrl !== undefined &&
    normalizedSettings.slackWebhookUrl.trim() !== ""
  ) {
    try {
      const url = new URL(normalizedSettings.slackWebhookUrl);
      if (!url.hostname.includes("hooks.slack.com")) {
        errors.push("Slack Webhook URLはSlackの正しいURLで入力してください");
      }
    } catch {
      errors.push("Slack Webhook URLは有効なURLで入力してください");
    }
  }

  const provider = normalizedSettings.contentExtractorProvider;
  if (
    provider !== undefined &&
    !CONTENT_EXTRACTOR_PROVIDERS.includes(provider)
  ) {
    errors.push("コンテンツ抽出プロバイダーの選択が不正です");
  }

  const effectiveProvider = provider || DEFAULT_CONTENT_EXTRACTOR_PROVIDER;

  if (
    effectiveProvider === "tavily" &&
    !normalizedSettings.tavilyApiKey?.trim()
  ) {
    errors.push("Tavily APIキーを入力してください");
  }

  if (
    effectiveProvider === "firecrawl" &&
    !normalizedSettings.firecrawlApiKey?.trim()
  ) {
    errors.push("Firecrawl APIキーを入力してください");
  }

  if (
    normalizedSettings.firecrawlBaseUrl !== undefined &&
    normalizedSettings.firecrawlBaseUrl.trim() !== ""
  ) {
    try {
      const url = new URL(normalizedSettings.firecrawlBaseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.push("Firecrawl Base URLはhttpまたはhttpsで指定してください");
      }
    } catch {
      errors.push("Firecrawl Base URLは有効なURLで入力してください");
    }
  }

  validateLlmSettings(normalizedSettings, errors, selectedState);

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors: [],
    validatedSettings: {
      ...normalizedSettings,
      maxEntriesPerRun,
      alarmIntervalMinutes,
      validated: true,
    },
  };
}
