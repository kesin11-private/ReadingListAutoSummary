import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  getSettings,
  type Settings,
  saveSettings,
  type ValidatedSettings,
  validateSettings,
} from "../../src/common/chrome_storage";
import { DEFAULT_FIRECRAWL_BASE_URL } from "../../src/common/constants";

const mockChromeStorage = {
  local: {
    get: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
  },
};

Object.defineProperty(globalThis, "chrome", {
  value: {
    storage: mockChromeStorage,
  },
  writable: true,
});

const validLlmSettings = {
  llmEndpoints: [
    {
      id: "endpoint-1",
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1",
      apiKey: "sk-test123",
    },
  ],
  llmModels: [
    {
      id: "model-1",
      endpointId: "endpoint-1",
      modelName: "gpt-4o-mini",
    },
  ],
  selectedLlmEndpointId: "endpoint-1",
  selectedLlmModelId: "model-1",
} satisfies Pick<
  Settings,
  "llmEndpoints" | "llmModels" | "selectedLlmEndpointId" | "selectedLlmModelId"
>;

describe("chrome_storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSettings", () => {
    it("設定が存在しない場合はデフォルト設定を返す", async () => {
      mockChromeStorage.local.get.mockResolvedValue({});

      const result = await getSettings();

      expect(result).toEqual(DEFAULT_SETTINGS);
      expect(mockChromeStorage.local.get).toHaveBeenCalledWith([
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
      ]);
    });

    it("保存された複数LLM設定がある場合はそのまま返す", async () => {
      const storedSettings = {
        daysUntilRead: 45,
        daysUntilDelete: 90,
        maxEntriesPerRun: 5,
        alarmIntervalMinutes: 120,
        ...validLlmSettings,
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "firecrawl",
        firecrawlApiKey: "fc-test123",
        firecrawlBaseUrl: "http://localhost:3002",
      };
      mockChromeStorage.local.get.mockResolvedValue(storedSettings);

      const result = await getSettings();

      expect(result).toEqual(storedSettings);
    });

    it("旧単一LLM設定を新構造へ移行する", async () => {
      mockChromeStorage.local.get.mockResolvedValue({
        openaiEndpoint: "https://api.openai.com/v1",
        openaiApiKey: "sk-legacy",
        openaiModel: "gpt-4o",
      });

      const result = await getSettings();

      expect(result.llmEndpoints).toEqual([
        {
          id: "legacy-endpoint",
          name: "Migrated endpoint",
          endpoint: "https://api.openai.com/v1",
          apiKey: "sk-legacy",
        },
      ]);
      expect(result.llmModels).toEqual([
        {
          id: "legacy-model",
          endpointId: "legacy-endpoint",
          modelName: "gpt-4o",
        },
      ]);
      expect(result.selectedLlmEndpointId).toBe("legacy-endpoint");
      expect(result.selectedLlmModelId).toBe("legacy-model");
    });

    it("Firecrawl Base URLが存在しない場合は既定値を返す", async () => {
      mockChromeStorage.local.get.mockResolvedValue(validLlmSettings);

      const result = await getSettings();

      expect(result.firecrawlBaseUrl).toBe(DEFAULT_FIRECRAWL_BASE_URL);
    });
  });

  describe("saveSettings", () => {
    it("新しいLLM構造を保存して旧キーを削除する", async () => {
      const settings: ValidatedSettings = {
        ...DEFAULT_SETTINGS,
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 7,
        alarmIntervalMinutes: 15,
        ...validLlmSettings,
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "tavily",
        tavilyApiKey: "tv-test123",
        firecrawlApiKey: "fc-test123",
        firecrawlBaseUrl: "http://localhost:3002",
        systemPrompt: "カスタムプロンプト",
        validated: true,
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.remove).toHaveBeenCalledWith([
        "openaiEndpoint",
        "openaiApiKey",
        "openaiModel",
      ]);
      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 7,
        alarmIntervalMinutes: 15,
        ...validLlmSettings,
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "tavily",
        tavilyApiKey: "tv-test123",
        firecrawlApiKey: "fc-test123",
        firecrawlBaseUrl: "http://localhost:3002",
        systemPrompt: "カスタムプロンプト",
      });
    });
  });

  describe("validateSettings", () => {
    const baseSettings: Settings = {
      ...DEFAULT_SETTINGS,
      daysUntilRead: 30,
      daysUntilDelete: 60,
      maxEntriesPerRun: 5,
      alarmIntervalMinutes: 720,
      contentExtractorProvider: "firecrawl",
      firecrawlApiKey: "fc-test",
      firecrawlBaseUrl: "https://api.firecrawl.dev",
      ...validLlmSettings,
    };

    it("有効な設定の場合はvalidatedSettingsを返す", () => {
      const result = validateSettings(baseSettings);

      expect(result.errors).toEqual([]);
      expect(result.validatedSettings?.validated).toBe(true);
    });

    it("不正なLLMエンドポイントURLの場合はエラーを返す", () => {
      const selectedEndpoint = baseSettings.llmEndpoints[0];
      if (!selectedEndpoint) {
        throw new Error("テスト用エンドポイントがありません");
      }

      const { errors } = validateSettings({
        ...baseSettings,
        llmEndpoints: [
          {
            ...selectedEndpoint,
            endpoint: "invalid-url",
          },
        ],
      });

      expect(errors).toContain(
        "LLM APIエンドポイントは有効なURLで入力してください",
      );
    });

    it("不正なコンテンツ抽出プロバイダー値の場合はエラーを返す", () => {
      const { errors } = validateSettings({
        ...baseSettings,
        // @ts-expect-error テスト用に不正な値を渡す
        contentExtractorProvider: "invalid",
      });

      expect(errors).toContain("コンテンツ抽出プロバイダーの選択が不正です");
    });

    it("無効なSlack Webhook URLの場合はエラーを返す", () => {
      const { errors } = validateSettings({
        ...baseSettings,
        slackWebhookUrl: "https://example.com/webhook",
      });

      expect(errors).toContain(
        "Slack Webhook URLはSlackの正しいURLで入力してください",
      );
    });
  });
});
