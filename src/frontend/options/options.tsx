import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

interface Settings {
  daysUntilRead: number;
  daysUntilDelete: number;
  openaiEndpoint?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  slackWebhookUrl?: string;
}

const DEFAULT_SETTINGS: Settings = {
  daysUntilRead: 30,
  daysUntilDelete: 60,
};

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // 設定を読み込み
  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get([
        "daysUntilRead",
        "daysUntilDelete",
        "openaiEndpoint",
        "openaiApiKey",
        "openaiModel",
        "slackWebhookUrl",
      ]);

      setSettings({
        daysUntilRead: result.daysUntilRead ?? DEFAULT_SETTINGS.daysUntilRead,
        daysUntilDelete:
          result.daysUntilDelete ?? DEFAULT_SETTINGS.daysUntilDelete,
        openaiEndpoint: result.openaiEndpoint || "",
        openaiApiKey: result.openaiApiKey || "",
        openaiModel: result.openaiModel || "",
        slackWebhookUrl: result.slackWebhookUrl || "",
      });
    } catch (error) {
      console.error("設定読み込みエラー:", error);
      setSaveMessage("設定の読み込みに失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  // 設定を保存
  const saveSettings = async () => {
    setIsSaving(true);
    setSaveMessage("");

    try {
      await chrome.storage.local.set({
        daysUntilRead: settings.daysUntilRead,
        daysUntilDelete: settings.daysUntilDelete,
        ...(settings.openaiEndpoint && {
          openaiEndpoint: settings.openaiEndpoint,
        }),
        ...(settings.openaiApiKey && { openaiApiKey: settings.openaiApiKey }),
        ...(settings.openaiModel && { openaiModel: settings.openaiModel }),
        ...(settings.slackWebhookUrl && {
          slackWebhookUrl: settings.slackWebhookUrl,
        }),
      });

      setSaveMessage("設定を保存しました。");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (error) {
      console.error("設定保存エラー:", error);
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

  if (isLoading) {
    return (
      <main class="p-4">
        <div class="text-center">設定を読み込み中...</div>
      </main>
    );
  }

  return (
    <main class="p-6 max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-6">Reading List Auto Summary 設定</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveSettings();
        }}
        class="space-y-6"
      >
        {/* 自動処理設定 */}
        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">自動処理設定</h2>

          <div class="grid gap-4">
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
                min="1"
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
                既読エントリをこの日数経過後に自動で削除します
              </p>
            </div>
          </div>
        </section>

        {/* AI要約設定 */}
        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">AI要約設定（今後実装予定）</h2>

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

        {/* Slack通知設定 */}
        <section class="bg-gray-50 p-4 rounded-lg">
          <h2 class="text-lg font-semibold mb-4">
            Slack通知設定（今後実装予定）
          </h2>

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
              class={`text-sm ${saveMessage.includes("失敗") ? "text-red-600" : "text-green-600"}`}
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
