import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  getSettings,
  type Settings,
  saveSettings,
  validateSettings,
} from "../../src/common/chrome_storage";

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
        "openaiEndpoint",
        "openaiApiKey",
        "openaiModel",
        "slackWebhookUrl",
        "firecrawlApiKey",
        "systemPrompt",
      ]);
    });

    it("保存された設定がある場合は結合して返す", async () => {
      const storedSettings = {
        daysUntilRead: 45,
        daysUntilDelete: 90,
        maxEntriesPerRun: 5,
        openaiEndpoint: "https://api.example.com/v1",
        openaiApiKey: "sk-test123",
        openaiModel: "gpt-4",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
      };
      mockChromeStorage.local.get.mockResolvedValue(storedSettings);

      const result = await getSettings();

      expect(result).toEqual(storedSettings);
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
      const settings: Settings = {
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 5,
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 5,
      });
    });

    it("オプション設定が含まれる場合は一緒に保存する", async () => {
      const settings: Settings = {
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 7,
        openaiEndpoint: "https://api.openai.com/v1",
        openaiApiKey: "sk-test123",
        openaiModel: "gpt-4",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        firecrawlApiKey: "fc-test123",
        systemPrompt: "カスタムプロンプト",
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 7,
        openaiEndpoint: "https://api.openai.com/v1",
        openaiApiKey: "sk-test123",
        openaiModel: "gpt-4",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        firecrawlApiKey: "fc-test123",
        systemPrompt: "カスタムプロンプト",
      });
    });

    it("空文字列のオプション設定は保存しない", async () => {
      const settings: Settings = {
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 3,
        openaiEndpoint: "",
        openaiApiKey: "",
        openaiModel: "",
        slackWebhookUrl: "",
        firecrawlApiKey: "",
        systemPrompt: "",
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 3,
      });
    });

    it("エラーが発生した場合は例外を投げる", async () => {
      const settings: Settings = {
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerRun: 3,
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
    it("有効な設定の場合は空配列を返す", () => {
      const settings: Settings = {
        daysUntilRead: 30,
        daysUntilDelete: 60,
        maxEntriesPerRun: 5,
        openaiEndpoint: "https://api.openai.com/v1",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
      };

      const errors = validateSettings(settings);

      expect(errors).toEqual([]);
    });

    it("既読化日数が無効な場合はエラーを返す", () => {
      expect(validateSettings({ daysUntilRead: 0 })).toContain(
        "既読化までの日数は1-365の整数で入力してください",
      );
      expect(validateSettings({ daysUntilRead: 366 })).toContain(
        "既読化までの日数は1-365の整数で入力してください",
      );
      expect(validateSettings({ daysUntilRead: 1.5 })).toContain(
        "既読化までの日数は1-365の整数で入力してください",
      );
    });

    it("削除日数が無効な場合はエラーを返す", () => {
      expect(validateSettings({ daysUntilDelete: 0 })).toContain(
        "削除までの日数は1-365の整数で入力してください",
      );
      expect(validateSettings({ daysUntilDelete: 366 })).toContain(
        "削除までの日数は1-365の整数で入力してください",
      );
      expect(validateSettings({ daysUntilDelete: 2.5 })).toContain(
        "削除までの日数は1-365の整数で入力してください",
      );
    });

    it("最大エントリ数が無効な場合はエラーを返す", () => {
      expect(validateSettings({ maxEntriesPerRun: 0 })).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
      expect(validateSettings({ maxEntriesPerRun: 101 })).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
      expect(validateSettings({ maxEntriesPerRun: 1.5 })).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
    });

    it("削除日数が既読化日数以下の場合はエラーを返す", () => {
      const errors = validateSettings({
        daysUntilRead: 60,
        daysUntilDelete: 30,
      });

      expect(errors).toContain(
        "削除までの日数は既読化までの日数より大きくしてください",
      );
    });

    it("削除日数と既読化日数が同じ場合はエラーを返す", () => {
      const errors = validateSettings({
        daysUntilRead: 30,
        daysUntilDelete: 30,
      });

      expect(errors).toContain(
        "削除までの日数は既読化までの日数より大きくしてください",
      );
    });

    it("無効なOpenAI APIエンドポイントの場合はエラーを返す", () => {
      const errors = validateSettings({
        openaiEndpoint: "invalid-url",
      });

      expect(errors).toContain(
        "OpenAI APIエンドポイントは有効なURLで入力してください",
      );
    });

    it("無効なSlack Webhook URLの場合はエラーを返す", () => {
      const errors1 = validateSettings({
        slackWebhookUrl: "invalid-url",
      });
      expect(errors1).toContain(
        "Slack Webhook URLは有効なURLで入力してください",
      );

      const errors2 = validateSettings({
        slackWebhookUrl: "https://example.com/webhook",
      });
      expect(errors2).toContain(
        "Slack Webhook URLはSlackの正しいURLで入力してください",
      );
    });

    it("複数のエラーがある場合は全て返す", () => {
      const errors = validateSettings({
        daysUntilRead: 0,
        daysUntilDelete: 366,
        openaiEndpoint: "invalid",
        slackWebhookUrl: "also-invalid",
      });

      expect(errors).toHaveLength(4);
    });
  });
});
