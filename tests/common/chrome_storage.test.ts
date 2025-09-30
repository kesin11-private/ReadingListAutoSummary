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

// Chrome APIのモック
const mockChromeStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
  },
};

// グローバルにchromeオブジェクトを設定
Object.defineProperty(globalThis, "chrome", {
  value: {
    storage: mockChromeStorage,
  },
  writable: true,
});

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

    it("保存された設定がある場合は結合して返す", async () => {
      const storedSettings = {
        daysUntilRead: 45,
        daysUntilDelete: 90,
        maxEntriesPerRun: 5,
        alarmIntervalMinutes: 120,
        openaiEndpoint: "https://api.example.com/v1",
        openaiApiKey: "sk-test123",
        openaiModel: "gpt-4",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "firecrawl",
        firecrawlApiKey: "fc-test123",
        firecrawlBaseUrl: "http://localhost:3002",
      };
      mockChromeStorage.local.get.mockResolvedValue(storedSettings);

      const result = await getSettings();

      expect(result).toEqual(storedSettings);
    });

    it("Firecrawl Base URLが存在しない場合は既定値を返す", async () => {
      const storedSettings = {
        daysUntilRead: 10,
        daysUntilDelete: 20,
      };
      mockChromeStorage.local.get.mockResolvedValue(storedSettings);

      const result = await getSettings();

      expect(result.firecrawlBaseUrl).toBe(DEFAULT_FIRECRAWL_BASE_URL);
    });

    it("エラーが発生した場合はデフォルト設定を返す", async () => {
      mockChromeStorage.local.get.mockRejectedValue(new Error("Storage error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await getSettings();

      expect(result).toEqual(DEFAULT_SETTINGS);
      expect(consoleSpy).toHaveBeenCalledWith(
        "設定取得エラー:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("saveSettings", () => {
    it("必須設定を保存する", async () => {
      const settings: ValidatedSettings = {
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 5,
        alarmIntervalMinutes: 60,
        validated: true,
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 5,
        alarmIntervalMinutes: 60,
      });
    });

    it("オプション設定が含まれる場合は一緒に保存する", async () => {
      const settings: ValidatedSettings = {
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 7,
        alarmIntervalMinutes: 15,
        openaiEndpoint: "https://api.openai.com/v1",
        openaiApiKey: "sk-test123",
        openaiModel: "gpt-4",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "tavily",
        tavilyApiKey: "tv-test123",
        firecrawlApiKey: "fc-test123",
        firecrawlBaseUrl: "http://localhost:3002",
        systemPrompt: "カスタムプロンプト",
        validated: true,
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 7,
        alarmIntervalMinutes: 15,
        openaiEndpoint: "https://api.openai.com/v1",
        openaiApiKey: "sk-test123",
        openaiModel: "gpt-4",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "tavily",
        tavilyApiKey: "tv-test123",
        firecrawlApiKey: "fc-test123",
        firecrawlBaseUrl: "http://localhost:3002",
        systemPrompt: "カスタムプロンプト",
      });
    });

    it("空文字列のオプション設定は保存しない", async () => {
      const settings: ValidatedSettings = {
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 3,
        alarmIntervalMinutes: 720,
        openaiEndpoint: "",
        openaiApiKey: "",
        openaiModel: "",
        slackWebhookUrl: "",
        firecrawlApiKey: "",
        firecrawlBaseUrl: "",
        systemPrompt: "",
        validated: true,
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 3,
        alarmIntervalMinutes: 720,
        systemPrompt: "",
      });
    });

    it("エラーが発生した場合は例外を投げる", async () => {
      const settings: ValidatedSettings = {
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 3,
        alarmIntervalMinutes: 60,
        validated: true,
      };
      const error = new Error("Storage error");
      mockChromeStorage.local.set.mockRejectedValue(error);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(saveSettings(settings)).rejects.toThrow(error);
      expect(consoleSpy).toHaveBeenCalledWith("設定保存エラー:", error);
      consoleSpy.mockRestore();
    });
  });

  describe("validateSettings", () => {
    const baseProviderSettings: Partial<Settings> = {
      contentExtractorProvider: "firecrawl",
      firecrawlApiKey: "fc-test",
    };

    it("有効な設定の場合は空配列とvalidatedSettingsを返す", () => {
      const settings: Settings = {
        daysUntilRead: 30,
        daysUntilDelete: 60,
        maxEntriesPerRun: 5,
        alarmIntervalMinutes: 720,
        openaiEndpoint: "https://api.openai.com/v1",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "firecrawl",
        firecrawlApiKey: "fc-test",
        firecrawlBaseUrl: "https://api.firecrawl.dev",
      };

      const result = validateSettings(settings);

      expect(result.errors).toEqual([]);
      expect(result.validatedSettings).toBeDefined();
      expect(result.validatedSettings?.validated).toBe(true);
    });

    it("既読化日数が無効な場合はエラーを返す", () => {
      expect(
        validateSettings({
          ...baseProviderSettings,
          daysUntilRead: 0,
        }).errors,
      ).toContain("既読化までの日数は1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseProviderSettings,
          daysUntilRead: 366,
        }).errors,
      ).toContain("既読化までの日数は1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseProviderSettings,
          daysUntilRead: 1.5,
        }).errors,
      ).toContain("既読化までの日数は1-365の整数で入力してください");
    });

    it("削除日数が無効な場合はエラーを返す", () => {
      expect(
        validateSettings({
          ...baseProviderSettings,
          daysUntilDelete: 0,
        }).errors,
      ).toContain("削除までの日数は-1または1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseProviderSettings,
          daysUntilDelete: 366,
        }).errors,
      ).toContain("削除までの日数は-1または1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseProviderSettings,
          daysUntilDelete: 2.5,
        }).errors,
      ).toContain("削除までの日数は-1または1-365の整数で入力してください");
    });

    it("最大エントリ数が無効な場合はエラーを返す", () => {
      expect(
        validateSettings({
          ...baseProviderSettings,
          maxEntriesPerRun: 0,
        }).errors,
      ).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
      expect(
        validateSettings({
          ...baseProviderSettings,
          maxEntriesPerRun: 101,
        }).errors,
      ).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
      expect(
        validateSettings({
          ...baseProviderSettings,
          maxEntriesPerRun: 1.5,
        }).errors,
      ).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
    });

    it("TavilyプロバイダーでAPIキーが未設定の場合はエラーを返す", () => {
      const { errors } = validateSettings({
        contentExtractorProvider: "tavily",
      });

      expect(errors).toContain("Tavily APIキーを入力してください");
    });

    it("FirecrawlプロバイダーでAPIキーが未設定の場合はエラーを返す", () => {
      const { errors } = validateSettings({
        contentExtractorProvider: "firecrawl",
      });

      expect(errors).toContain("Firecrawl APIキーを入力してください");
    });

    it("不正なプロバイダー値の場合はエラーを返す", () => {
      const { errors } = validateSettings({
        // @ts-expect-error テスト用に不正な値を渡す
        contentExtractorProvider: "invalid",
        firecrawlApiKey: "fc-test",
      });

      expect(errors).toContain("コンテンツ抽出プロバイダーの選択が不正です");
    });

    it("無効なOpenAI APIエンドポイントの場合はエラーを返す", () => {
      const { errors } = validateSettings({
        ...baseProviderSettings,
        openaiEndpoint: "invalid-url",
      });

      expect(errors).toContain(
        "OpenAI APIエンドポイントは有効なURLで入力してください",
      );
    });

    it("無効なSlack Webhook URLの場合はエラーを返す", () => {
      const { errors: errors1 } = validateSettings({
        ...baseProviderSettings,
        slackWebhookUrl: "invalid-url",
      });
      expect(errors1).toContain(
        "Slack Webhook URLは有効なURLで入力してください",
      );

      const { errors: errors2 } = validateSettings({
        ...baseProviderSettings,
        slackWebhookUrl: "https://example.com/webhook",
      });
      expect(errors2).toContain(
        "Slack Webhook URLはSlackの正しいURLで入力してください",
      );
    });

    it("無効なFirecrawl Base URLの場合はエラーを返す", () => {
      const { errors } = validateSettings({
        ...baseProviderSettings,
        firecrawlBaseUrl: "not-a-url",
      });

      expect(errors).toContain(
        "Firecrawl Base URLは有効なURLで入力してください",
      );
    });

    it("Firecrawl Base URLがhttp/https以外の場合はエラーを返す", () => {
      const { errors } = validateSettings({
        ...baseProviderSettings,
        firecrawlBaseUrl: "ftp://example.com",
      });

      expect(errors).toContain(
        "Firecrawl Base URLはhttpまたはhttpsで指定してください",
      );
    });

    it("複数のエラーがある場合は全て返す", () => {
      const { errors } = validateSettings({
        ...baseProviderSettings,
        daysUntilRead: 0,
        daysUntilDelete: 366,
        alarmIntervalMinutes: 0,
        openaiEndpoint: "invalid",
        slackWebhookUrl: "also-invalid",
      });

      expect(errors).toHaveLength(5);
    });

    it("削除日数が既読化日数より小さくても有効", () => {
      const { errors } = validateSettings({
        ...baseProviderSettings,
        daysUntilRead: 30,
        daysUntilDelete: 10,
      });

      expect(errors).toEqual([]);
    });

    it("削除日数と既読化日数が同じでも有効", () => {
      const { errors } = validateSettings({
        ...baseProviderSettings,
        daysUntilRead: 30,
        daysUntilDelete: 30,
      });

      expect(errors).toEqual([]);
    });
  });
});
