import { render } from "preact";
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
  CONTENT_EXTRACTOR_PROVIDERS,
  type ContentExtractorProvider,
  DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
  DEFAULT_FIRECRAWL_BASE_URL,
} from "../../common/constants";
import { ContentExtractorTest } from "./ContentExtractorTest";

type SaveStatus = "idle" | "success" | "error";

function formatSettingsForUi(settings: Settings): Settings {
  return {
    ...settings,
    openaiEndpoint: settings.openaiEndpoint || "",
    openaiApiKey: settings.openaiApiKey || "",
    openaiModel: settings.openaiModel || "",
    slackWebhookUrl: settings.slackWebhookUrl || "",
    contentExtractorProvider:
      settings.contentExtractorProvider || DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
    tavilyApiKey: settings.tavilyApiKey || "",
    firecrawlApiKey: settings.firecrawlApiKey || "",
    firecrawlBaseUrl: settings.firecrawlBaseUrl || DEFAULT_FIRECRAWL_BASE_URL,
    systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
  };
}

function App() {
  const [settings, setSettings] = useState<Settings>(
    formatSettingsForUi(DEFAULT_SETTINGS),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [isManualRunning, setIsManualRunning] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);

  // 設定を読み込み
  const loadSettings = async () => {
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
  };

  // 設定を保存
  const handleSaveSettings = async () => {
    setIsSaving(true);
    setSaveStatus("idle");
    setSaveMessage("");

    const sanitizedSettings: Settings = { ...settings };

    const trimmedTavilyApiKey = settings.tavilyApiKey?.trim();
    if (trimmedTavilyApiKey) {
      sanitizedSettings.tavilyApiKey = trimmedTavilyApiKey;
    } else {
      delete sanitizedSettings.tavilyApiKey;
    }

    const trimmedFirecrawlApiKey = settings.firecrawlApiKey?.trim();
    if (trimmedFirecrawlApiKey) {
      sanitizedSettings.firecrawlApiKey = trimmedFirecrawlApiKey;
    } else {
      delete sanitizedSettings.firecrawlApiKey;
    }

    sanitizedSettings.firecrawlBaseUrl =
      settings.firecrawlBaseUrl?.trim() || DEFAULT_FIRECRAWL_BASE_URL;

    // バリデーション
    const { errors: validationErrors, validatedSettings } =
      validateSettings(sanitizedSettings);
    if (validationErrors.length > 0) {
      setSaveStatus("error");
      setSaveMessage(
        validationErrors[0] || "バリデーションエラーが発生しました",
      ); // 最初のエラーメッセージを表示
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
      setSettings(formatSettingsForUi(sanitizedSettings));
      setSaveStatus("success");
      setSaveMessage("設定を保存しました。");
      setTimeout(() => {
        setSaveStatus("idle");
        setSaveMessage("");
      }, 3000);
    } catch (error) {
      console.error("設定保存エラー:", error);
      setSaveStatus("error");
      setSaveMessage("設定の保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  // 初回読み込み
  useEffect(() => {
    loadSettings();
  }, []);

  const handleInputChange = (field: keyof Settings, value: string | number) => {
    setSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleResetToDefault = () => {
    setSettings((prev) => ({
      ...prev,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    }));
  };

  const handleManualExecute = async () => {
    setIsManualRunning(true);
    setManualMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "MANUAL_EXECUTE",
      });
      if (response && typeof response === "object" && "success" in response) {
        setManualMessage(
          response.success
            ? "実行が完了しました"
            : `実行に失敗しました: ${response.error || "不明なエラー"}`,
        );
      } else {
        setManualMessage("不正なレスポンス形式です");
      }
    } catch (error) {
      setManualMessage(
        error instanceof Error
          ? `実行エラー: ${error.message}`
          : `実行エラー: ${String(error)}`,
      );
    } finally {
      setIsManualRunning(false);
      setTimeout(() => setManualMessage(null), 3000);
    }
  };

  if (isLoading) {
    return (
      <main class="p-4">
        <div class="text-center">設定を読み込み中...</div>
      </main>
    );
  }

  const selectedProvider: ContentExtractorProvider =
    settings.contentExtractorProvider || DEFAULT_CONTENT_EXTRACTOR_PROVIDER;

  return (
    <main class="p-6 max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-6">Reading List Auto Summary 設定</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSaveSettings();
        }}
        class="space-y-6"
      >
        {/* 自動処理設定 */}
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
                    Number((e.target as HTMLInputElement).value),
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
                    Number((e.target as HTMLInputElement).value),
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
                    Number((e.target as HTMLInputElement).value),
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
                    Number((e.target as HTMLInputElement).value),
                  )
                }
                class="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p class="text-xs text-gray-500 mt-1">
                アラーム実行時に一度に処理するエントリ数の上限
              </p>
            </div>
          </div>

          {/* 手動実行ボタン（このセクションの末尾） */}
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

        {/* AI要約設定 */}
        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">AI要約設定</h2>

          <div class="grid gap-4">
            <div>
              <label
                for="openaiEndpoint"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                OpenAI API エンドポイント
              </label>
              <input
                id="openaiEndpoint"
                type="url"
                placeholder="https://api.openai.com/v1"
                value={settings.openaiEndpoint}
                onInput={(e) =>
                  handleInputChange(
                    "openaiEndpoint",
                    (e.target as HTMLInputElement).value,
                  )
                }
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label
                for="openaiApiKey"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                OpenAI API キー
              </label>
              <input
                id="openaiApiKey"
                type="password"
                placeholder="sk-..."
                value={settings.openaiApiKey}
                onInput={(e) =>
                  handleInputChange(
                    "openaiApiKey",
                    (e.target as HTMLInputElement).value,
                  )
                }
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label
                for="openaiModel"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                OpenAI モデル
              </label>
              <input
                id="openaiModel"
                type="text"
                placeholder="gpt-4o-mini"
                value={settings.openaiModel}
                onInput={(e) =>
                  handleInputChange(
                    "openaiModel",
                    (e.target as HTMLInputElement).value,
                  )
                }
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </section>

        {/* 要約設定 */}
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

        {/* コンテンツ抽出設定 */}
        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">コンテンツ抽出設定</h2>

          <div class="grid gap-4">
            <div>
              <label
                for="contentExtractorProvider"
                class="block text-sm font-medium text-gray-700 mb-1"
              >
                コンテンツ抽出プロバイダー
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
                    {provider === "tavily" ? "Tavily" : "Firecrawl"}
                  </option>
                ))}
              </select>
            </div>

            {selectedProvider === "tavily" ? (
              <div>
                <label
                  for="tavilyApiKey"
                  class="block text-sm font-medium text-gray-700 mb-1"
                >
                  Tavily API キー
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
                  Tavily Extract APIで本文抽出を行います
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label
                    for="firecrawlApiKey"
                    class="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Firecrawl API キー
                  </label>
                  <input
                    id="firecrawlApiKey"
                    type="password"
                    placeholder="fc-..."
                    value={settings.firecrawlApiKey || ""}
                    onInput={(e) =>
                      handleInputChange(
                        "firecrawlApiKey",
                        (e.target as HTMLInputElement).value,
                      )
                    }
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p class="text-xs text-gray-500 mt-1">
                    Webページからのテキスト抽出に使用します
                  </p>
                </div>

                <div>
                  <label
                    for="firecrawlBaseUrl"
                    class="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Firecrawl Base URL
                  </label>
                  <input
                    id="firecrawlBaseUrl"
                    type="url"
                    placeholder="https://api.firecrawl.dev"
                    value={settings.firecrawlBaseUrl}
                    onInput={(e) =>
                      handleInputChange(
                        "firecrawlBaseUrl",
                        (e.target as HTMLInputElement).value,
                      )
                    }
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p class="text-xs text-gray-500 mt-1">
                    セルフホスト環境では `http://localhost:3002`
                    などに変更できます
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* コンテンツ抽出テスト */}
        <ContentExtractorTest provider={selectedProvider} />

        {/* Slack通知設定 */}
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
              value={settings.slackWebhookUrl}
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

        {/* 保存ボタン */}
        <div class="flex items-center gap-4">
          <button
            type="submit"
            disabled={isSaving}
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "保存中..." : "設定を保存"}
          </button>

          {saveMessage && (
            <span
              class={`text-sm ${saveStatus === "error" ? "text-red-600" : "text-green-600"}`}
            >
              {saveMessage}
            </span>
          )}
        </div>
      </form>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  render(<App />, root);
}
