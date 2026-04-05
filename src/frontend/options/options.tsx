import { type JSX, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "../styles/tailwind.css";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  DELETION_DISABLED_VALUE,
  getSettings,
  type Settings,
  saveSettings as saveSettingsToStorage,
  validateSettings,
} from "../../common/chrome_storage";
import {
  CONTENT_EXTRACTOR_PROVIDER_DESCRIPTIONS,
  CONTENT_EXTRACTOR_PROVIDER_LABELS,
  CONTENT_EXTRACTOR_PROVIDERS,
  type ContentExtractorProvider,
  DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
} from "../../common/constants";
import {
  deriveLlmEndpointName,
  getLlmModelsForEndpoint,
  getSelectedLlmEndpoint,
  getSelectedLlmModel,
  type LlmEndpointConfig,
  type LlmModelConfig,
  normalizeLlmSettings,
} from "../../common/llm_settings";
import type { ManualExecuteResult } from "../../types/messages";
import { ContentExtractorTest } from "./ContentExtractorTest";

type SaveStatus = "idle" | "success" | "error";

function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isManualExecuteResponse(
  response: unknown,
): response is ManualExecuteResult {
  return (
    typeof response === "object" &&
    response !== null &&
    "success" in response &&
    typeof response.success === "boolean"
  );
}

function updateItemById<T extends { id: string }>(
  items: T[],
  id: string,
  updater: (item: T) => T,
): T[] {
  return items.map((item) => {
    if (item.id !== id) {
      return item;
    }

    return updater(item);
  });
}

function formatEndpointLabel(
  endpoint: LlmEndpointConfig,
  index: number,
): string {
  if (endpoint.name.trim()) {
    return endpoint.name;
  }

  return deriveLlmEndpointName(endpoint.endpoint, `Endpoint ${index + 1}`);
}

function getModelOptionLabel(model: LlmModelConfig, index: number): string {
  if (model.modelName) {
    return model.modelName;
  }

  return `Model ${index + 1}`;
}

function getSelectedProvider(settings: Settings): ContentExtractorProvider {
  return (
    settings.contentExtractorProvider || DEFAULT_CONTENT_EXTRACTOR_PROVIDER
  );
}

function sanitizeEditableSettings(settings: Settings): Settings {
  return {
    ...settings,
    slackWebhookUrl: settings.slackWebhookUrl?.trim() || "",
    tavilyApiKey: settings.tavilyApiKey?.trim() || "",
  };
}

function getValidationErrorMessage(errors: string[]): string {
  return errors[0] || "バリデーションエラーが発生しました";
}

function clearSaveMessageAfterDelay(
  setSaveStatus: (value: SaveStatus) => void,
  setSaveMessage: (value: string) => void,
): void {
  setTimeout(() => {
    setSaveStatus("idle");
    setSaveMessage("");
  }, 3000);
}

function clearManualMessageAfterDelay(
  setManualMessage: (value: string | null) => void,
): void {
  setTimeout(() => setManualMessage(null), 3000);
}

function getSaveStatusClassName(saveStatus: SaveStatus): string {
  return saveStatus === "success" ? "text-green-600" : "text-red-600";
}

function toNumber(value: string): number {
  return Number(value);
}

export function formatSettingsForUi(settings: Settings): Settings {
  return normalizeLlmSettings({
    ...DEFAULT_SETTINGS,
    ...settings,
    llmEndpoints: settings.llmEndpoints.map((endpoint, index) => {
      const trimmedName = endpoint.name.trim();

      return {
        ...endpoint,
        name: trimmedName || formatEndpointLabel(endpoint, index),
      };
    }),
    llmModels: settings.llmModels,
    selectedLlmEndpointId: settings.selectedLlmEndpointId,
    selectedLlmModelId: settings.selectedLlmModelId,
    slackWebhookUrl: settings.slackWebhookUrl || "",
    contentExtractorProvider:
      settings.contentExtractorProvider || DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
    tavilyApiKey: settings.tavilyApiKey || "",
    systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
  });
}

export function addLlmEndpoint(settings: Settings): Settings {
  const newEndpoint: LlmEndpointConfig = {
    id: createId("endpoint"),
    name: `Endpoint ${settings.llmEndpoints.length + 1}`,
    endpoint: "",
    apiKey: "",
  };

  return normalizeLlmSettings({
    ...settings,
    llmEndpoints: [...settings.llmEndpoints, newEndpoint],
    selectedLlmEndpointId: newEndpoint.id,
    selectedLlmModelId: null,
  });
}

export function selectLlmEndpoint(
  settings: Settings,
  endpointId: string,
): Settings {
  const models = getLlmModelsForEndpoint(settings, endpointId);

  return normalizeLlmSettings({
    ...settings,
    selectedLlmEndpointId: endpointId,
    selectedLlmModelId: models[0]?.id ?? null,
  });
}

export function updateSelectedLlmEndpoint(
  settings: Settings,
  field: "name" | "endpoint" | "apiKey",
  value: string,
): Settings {
  const selectedEndpoint = getSelectedLlmEndpoint(settings);
  if (!selectedEndpoint) {
    return settings;
  }

  return {
    ...settings,
    llmEndpoints: updateItemById(
      settings.llmEndpoints,
      selectedEndpoint.id,
      (endpoint) => ({
        ...endpoint,
        [field]: value,
      }),
    ),
  };
}

export function removeSelectedLlmEndpoint(settings: Settings): Settings {
  const selectedEndpoint = getSelectedLlmEndpoint(settings);
  if (!selectedEndpoint) {
    return settings;
  }

  const llmEndpoints = settings.llmEndpoints.filter(
    (endpoint) => endpoint.id !== selectedEndpoint.id,
  );
  const llmModels = settings.llmModels.filter(
    (model) => model.endpointId !== selectedEndpoint.id,
  );
  const nextEndpointId = llmEndpoints[0]?.id ?? null;
  const nextModelId =
    llmModels.find((model) => model.endpointId === nextEndpointId)?.id ?? null;

  return normalizeLlmSettings({
    ...settings,
    llmEndpoints,
    llmModels,
    selectedLlmEndpointId: nextEndpointId,
    selectedLlmModelId: nextModelId,
  });
}

export function addLlmModel(settings: Settings): Settings {
  const selectedEndpoint = getSelectedLlmEndpoint(settings);
  if (!selectedEndpoint) {
    return settings;
  }

  const newModel: LlmModelConfig = {
    id: createId("model"),
    endpointId: selectedEndpoint.id,
    modelName: "",
  };

  return normalizeLlmSettings({
    ...settings,
    llmModels: [...settings.llmModels, newModel],
    selectedLlmModelId: newModel.id,
  });
}

export function selectLlmModel(settings: Settings, modelId: string): Settings {
  return normalizeLlmSettings({
    ...settings,
    selectedLlmModelId: modelId,
  });
}

export function updateSelectedLlmModel(
  settings: Settings,
  value: string,
): Settings {
  const selectedModel = getSelectedLlmModel(settings);
  if (!selectedModel) {
    return settings;
  }

  return {
    ...settings,
    llmModels: updateItemById(
      settings.llmModels,
      selectedModel.id,
      (model) => ({
        ...model,
        modelName: value,
      }),
    ),
  };
}

export function removeSelectedLlmModel(settings: Settings): Settings {
  const selectedEndpoint = getSelectedLlmEndpoint(settings);
  const selectedModel = getSelectedLlmModel(settings);
  if (!selectedEndpoint || !selectedModel) {
    return settings;
  }

  const llmModels = settings.llmModels.filter(
    (model) => model.id !== selectedModel.id,
  );
  const nextModelId =
    llmModels.find((model) => model.endpointId === selectedEndpoint.id)?.id ??
    null;

  return normalizeLlmSettings({
    ...settings,
    llmModels,
    selectedLlmModelId: nextModelId,
  });
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings>(
    formatSettingsForUi(DEFAULT_SETTINGS),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [isManualRunning, setIsManualRunning] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);

  async function loadSettings(): Promise<void> {
    try {
      const loadedSettings = await getSettings();
      setSettings(formatSettingsForUi(loadedSettings));
    } catch (error) {
      console.error("設定読み込みエラー:", error);
      setSaveStatus("error");
      setSaveMessage("設定の読み込みに失敗しました。");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveSettings(): Promise<void> {
    setIsSaving(true);
    setSaveStatus("idle");
    setSaveMessage("");

    const { errors: validationErrors, validatedSettings } = validateSettings(
      sanitizeEditableSettings(settings),
    );
    if (validationErrors.length > 0) {
      setSaveStatus("error");
      setSaveMessage(getValidationErrorMessage(validationErrors));
      setIsSaving(false);
      return;
    }

    if (!validatedSettings) {
      setSaveStatus("error");
      setSaveMessage("設定の検証に失敗しました");
      setIsSaving(false);
      return;
    }

    try {
      await saveSettingsToStorage(validatedSettings);
      setSettings(formatSettingsForUi(validatedSettings));
      setSaveStatus("success");
      setSaveMessage("設定を保存しました。");
      clearSaveMessageAfterDelay(setSaveStatus, setSaveMessage);
    } catch (error) {
      console.error("設定保存エラー:", error);
      setSaveStatus("error");
      setSaveMessage("設定の保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function handleInputChange(
    field: keyof Settings,
    value: string | number,
  ): void {
    setSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleResetToDefault(): void {
    setSettings((prev) => ({
      ...prev,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    }));
  }

  async function handleManualExecute(): Promise<void> {
    setIsManualRunning(true);
    setManualMessage(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "MANUAL_EXECUTE",
      });

      if (!isManualExecuteResponse(response)) {
        setManualMessage("不正なレスポンス形式です");
        return;
      }

      if (response.success) {
        setManualMessage("実行が完了しました");
      } else {
        setManualMessage(
          `実行に失敗しました: ${response.error || "不明なエラー"}`,
        );
      }
    } catch (error) {
      setManualMessage(`実行エラー: ${getErrorMessage(error)}`);
    } finally {
      setIsManualRunning(false);
      clearManualMessageAfterDelay(setManualMessage);
    }
  }

  if (isLoading) {
    return (
      <main class="p-4">
        <div class="text-center">設定を読み込み中...</div>
      </main>
    );
  }

  const selectedProvider = getSelectedProvider(settings);
  const isTavilyOnly = selectedProvider === "tavily";
  const selectedEndpoint = getSelectedLlmEndpoint(settings);
  const modelsForSelectedEndpoint = getLlmModelsForEndpoint(
    settings,
    selectedEndpoint?.id ?? null,
  );
  const selectedModel = getSelectedLlmModel(settings);

  return (
    <main class="p-6 max-w-3xl mx-auto">
      <h1 class="text-2xl font-bold mb-6">Reading List Auto Summary 設定</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveSettings();
        }}
        class="space-y-6"
      >
        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">自動処理設定</h2>

          <div class="grid gap-4">
            <div>
              <label
                for="alarmIntervalMinutes"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                実行間隔（分）
              </label>
              <input
                id="alarmIntervalMinutes"
                type="number"
                min="1"
                value={
                  settings.alarmIntervalMinutes ??
                  DEFAULT_SETTINGS.alarmIntervalMinutes
                }
                onInput={(e) =>
                  handleInputChange(
                    "alarmIntervalMinutes",
                    toNumber((e.target as HTMLInputElement).value),
                  )
                }
                class="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p class="text-xs text-gray-500 mt-1">
                バックグラウンドの自動処理を起動する間隔（分）。最小1分。
              </p>
            </div>

            <div>
              <label
                for="daysUntilRead"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                既読化までの日数
              </label>
              <input
                id="daysUntilRead"
                type="number"
                min="1"
                max="365"
                value={settings.daysUntilRead}
                onInput={(e) =>
                  handleInputChange(
                    "daysUntilRead",
                    toNumber((e.target as HTMLInputElement).value),
                  )
                }
                class="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p class="text-xs text-gray-500 mt-1">
                未読エントリをこの日数経過後に自動で既読にします
              </p>
            </div>

            <div>
              <label
                for="daysUntilDelete"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                削除までの日数
              </label>
              <input
                id="daysUntilDelete"
                type="number"
                min={DELETION_DISABLED_VALUE}
                max="365"
                value={settings.daysUntilDelete}
                onInput={(e) =>
                  handleInputChange(
                    "daysUntilDelete",
                    toNumber((e.target as HTMLInputElement).value),
                  )
                }
                class="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p class="text-xs text-gray-500 mt-1">
                既読にしてからこの日数経過後に自動で削除します（
                {DELETION_DISABLED_VALUE}を入力すると無効になります）
              </p>
            </div>

            <div>
              <label
                for="maxEntriesPerRun"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                1回の実行で既読にする最大エントリ数
              </label>
              <input
                id="maxEntriesPerRun"
                type="number"
                min="1"
                max="100"
                value={settings.maxEntriesPerRun ?? 3}
                onInput={(e) =>
                  handleInputChange(
                    "maxEntriesPerRun",
                    toNumber((e.target as HTMLInputElement).value),
                  )
                }
                class="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p class="text-xs text-gray-500 mt-1">
                アラーム実行時に一度に処理するエントリ数の上限
              </p>
            </div>
          </div>

          <div class="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleManualExecute}
              disabled={isManualRunning}
              class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isManualRunning ? "実行中..." : "今すぐ実行"}
            </button>
            {manualMessage && (
              <span class="text-sm text-gray-700">{manualMessage}</span>
            )}
          </div>
        </section>

        <section class="bg-gray-50 p-4 rounded-lg">
          <div class="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 class="text-lg font-semibold">AI要約設定</h2>
              <p class="text-xs text-gray-500 mt-1">
                エンドポイントを削除すると、その配下のモデルもまとめて削除されます。
              </p>
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                onClick={() => setSettings((prev) => addLlmEndpoint(prev))}
                class="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                エンドポイントを追加
              </button>
              <button
                type="button"
                onClick={() =>
                  setSettings((prev) => removeSelectedLlmEndpoint(prev))
                }
                disabled={!selectedEndpoint}
                class="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                選択中を削除
              </button>
            </div>
          </div>

          <div class="grid gap-4">
            <div>
              <label
                for="selectedLlmEndpointId"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                使用するエンドポイント
              </label>
              <select
                id="selectedLlmEndpointId"
                value={selectedEndpoint?.id ?? ""}
                onChange={(e) =>
                  setSettings((prev) =>
                    selectLlmEndpoint(
                      prev,
                      (e.target as HTMLSelectElement).value,
                    ),
                  )
                }
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {settings.llmEndpoints.length === 0 ? (
                  <option value="">エンドポイントがありません</option>
                ) : (
                  settings.llmEndpoints.map((endpoint, index) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {formatEndpointLabel(endpoint, index)}
                    </option>
                  ))
                )}
              </select>
            </div>

            {selectedEndpoint ? (
              <div class="grid gap-4 border border-gray-200 rounded-md p-4 bg-white">
                <div>
                  <label
                    for="llmEndpointName"
                    class="block text-sm font-medium text-gray-700 mb-1"
                  >
                    エンドポイント表示名
                  </label>
                  <input
                    id="llmEndpointName"
                    type="text"
                    value={selectedEndpoint.name}
                    onInput={(e) =>
                      setSettings((prev) =>
                        updateSelectedLlmEndpoint(
                          prev,
                          "name",
                          (e.target as HTMLInputElement).value,
                        ),
                      )
                    }
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    for="llmEndpointUrl"
                    class="block text-sm font-medium text-gray-700 mb-1"
                  >
                    LLM API エンドポイント
                  </label>
                  <input
                    id="llmEndpointUrl"
                    type="url"
                    placeholder="https://api.openai.com/v1"
                    value={selectedEndpoint.endpoint}
                    onInput={(e) =>
                      setSettings((prev) =>
                        updateSelectedLlmEndpoint(
                          prev,
                          "endpoint",
                          (e.target as HTMLInputElement).value,
                        ),
                      )
                    }
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    for="llmEndpointApiKey"
                    class="block text-sm font-medium text-gray-700 mb-1"
                  >
                    API キー
                  </label>
                  <input
                    id="llmEndpointApiKey"
                    type="password"
                    placeholder="sk-..."
                    value={selectedEndpoint.apiKey}
                    onInput={(e) =>
                      setSettings((prev) =>
                        updateSelectedLlmEndpoint(
                          prev,
                          "apiKey",
                          (e.target as HTMLInputElement).value,
                        ),
                      )
                    }
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p class="mt-1 text-xs text-gray-500">
                    ローカルLLMなどAPIキー不要のエンドポイントでは空欄でも利用できます
                  </p>
                </div>
              </div>
            ) : (
              <p class="text-sm text-gray-500">
                エンドポイントを追加すると、ここで接続先と API
                キーを管理できます。
              </p>
            )}

            <div class="border-t border-gray-200 pt-4">
              <div class="flex items-center justify-between mb-4 gap-3">
                <div>
                  <h3 class="text-md font-semibold">モデル管理</h3>
                  <p class="text-xs text-gray-500 mt-1">
                    選択中のエンドポイントに紐づくモデルのみ表示されます。
                  </p>
                </div>
                <div class="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSettings((prev) => addLlmModel(prev))}
                    disabled={!selectedEndpoint}
                    class="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    モデルを追加
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((prev) => removeSelectedLlmModel(prev))
                    }
                    disabled={!selectedModel}
                    class="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    選択中を削除
                  </button>
                </div>
              </div>

              <div class="grid gap-4">
                <div>
                  <label
                    for="selectedLlmModelId"
                    class="block text-sm font-medium text-gray-700 mb-1"
                  >
                    使用するモデル
                  </label>
                  <select
                    id="selectedLlmModelId"
                    value={selectedModel?.id ?? ""}
                    onChange={(e) =>
                      setSettings((prev) =>
                        selectLlmModel(
                          prev,
                          (e.target as HTMLSelectElement).value,
                        ),
                      )
                    }
                    disabled={!selectedEndpoint}
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  >
                    {modelsForSelectedEndpoint.length === 0 ? (
                      <option value="">モデルがありません</option>
                    ) : (
                      modelsForSelectedEndpoint.map((model, index) => (
                        <option key={model.id} value={model.id}>
                          {getModelOptionLabel(model, index)}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {selectedModel ? (
                  <div class="grid gap-4 border border-gray-200 rounded-md p-4 bg-white">
                    <div>
                      <label
                        for="llmModelName"
                        class="block text-sm font-medium text-gray-700 mb-1"
                      >
                        モデル名
                      </label>
                      <input
                        id="llmModelName"
                        type="text"
                        placeholder="gpt-4o-mini"
                        value={selectedModel.modelName}
                        onInput={(e) =>
                          setSettings((prev) =>
                            updateSelectedLlmModel(
                              prev,
                              (e.target as HTMLInputElement).value,
                            ),
                          )
                        }
                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                ) : (
                  <p class="text-sm text-gray-500">
                    モデルを追加すると、選択中エンドポイント用のモデル名を保存できます。
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">要約設定</h2>

          <div>
            <label
              for="systemPrompt"
              class="block text-sm font-medium text-gray-700 mb-2"
            >
              システムプロンプト
            </label>
            <textarea
              id="systemPrompt"
              rows={8}
              placeholder="LLMへの要約指示を記述..."
              value={settings.systemPrompt || ""}
              onInput={(e) =>
                handleInputChange(
                  "systemPrompt",
                  (e.target as HTMLTextAreaElement).value,
                )
              }
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleResetToDefault}
                class="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
              >
                デフォルトに戻す
              </button>
            </div>
            <p class="text-xs text-gray-600 mt-2">
              💡 プロンプトを変更すると要約のスタイル・内容が変わります
            </p>
          </div>
        </section>

        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">コンテンツ抽出設定</h2>

          <div class="grid gap-4">
            <div>
              <label
                for="contentExtractorProvider"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                本文抽出モード
              </label>
              <select
                id="contentExtractorProvider"
                value={selectedProvider}
                onChange={(e) =>
                  handleInputChange(
                    "contentExtractorProvider",
                    (e.target as HTMLSelectElement)
                      .value as ContentExtractorProvider,
                  )
                }
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {CONTENT_EXTRACTOR_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {CONTENT_EXTRACTOR_PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
              <p class="text-xs text-gray-500 mt-1">
                {CONTENT_EXTRACTOR_PROVIDER_DESCRIPTIONS[selectedProvider]}
              </p>
            </div>

            <div>
              <label
                for="tavilyApiKey"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                {isTavilyOnly
                  ? "Tavily API キー（必須）"
                  : "Tavily API キー（任意）"}
              </label>
              <input
                id="tavilyApiKey"
                type="password"
                placeholder="tvly-..."
                value={settings.tavilyApiKey || ""}
                onInput={(e) =>
                  handleInputChange(
                    "tavilyApiKey",
                    (e.target as HTMLInputElement).value,
                  )
                }
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p class="text-xs text-gray-500 mt-1">
                {isTavilyOnly
                  ? "Tavily Extract API だけで本文抽出を行います"
                  : "ローカル抽出失敗時のフォールバックに使用します"}
              </p>
            </div>
          </div>
        </section>

        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">Slack通知設定</h2>

          <div>
            <label
              for="slackWebhookUrl"
              class="block text-sm font-medium text-gray-700 mb-1"
            >
              Slack Webhook URL
            </label>
            <input
              id="slackWebhookUrl"
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value={settings.slackWebhookUrl || ""}
              onInput={(e) =>
                handleInputChange(
                  "slackWebhookUrl",
                  (e.target as HTMLInputElement).value,
                )
              }
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </section>

        <div class="flex items-center gap-4">
          <button
            type="submit"
            disabled={isSaving}
            class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "保存中..." : "設定を保存"}
          </button>

          {saveStatus !== "idle" && (
            <span class={`text-sm ${getSaveStatusClassName(saveStatus)}`}>
              {saveMessage}
            </span>
          )}
        </div>

        <ContentExtractorTest provider={selectedProvider} />
      </form>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  render(<App />, rootElement);
}
