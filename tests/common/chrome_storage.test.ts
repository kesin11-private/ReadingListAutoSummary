import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  getSettings,
  type Settings,
  saveSettings,
  type ValidatedSettings,
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

      expect(result).toMatchObject({
        daysUntilRead: DEFAULT_SETTINGS.daysUntilRead,
        daysUntilDelete: DEFAULT_SETTINGS.daysUntilDelete,
        maxEntriesPerRun: DEFAULT_SETTINGS.maxEntriesPerRun,
        alarmIntervalMinutes: DEFAULT_SETTINGS.alarmIntervalMinutes,
      });
      expect(mockChromeStorage.local.get).toHaveBeenCalledTimes(1);
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
        tavilyApiKey: "tv-test123",
        systemPrompt: "カスタムプロンプト",
      };
      mockChromeStorage.local.get.mockResolvedValue(storedSettings);

      const result = await getSettings();

      expect(result).toMatchObject(storedSettings);
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
        tavilyApiKey: "tv-test123",
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
        tavilyApiKey: "tv-test123",
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
        tavilyApiKey: "",
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
    const baseSettings: Partial<Settings> = {
      tavilyApiKey: "tv-test",
    };

    it("有効な設定の場合は空配列とvalidatedSettingsを返す", () => {
      const settings: Settings = {
        daysUntilRead: 30,
        daysUntilDelete: 60,
        maxEntriesPerRun: 5,
        alarmIntervalMinutes: 720,
        openaiEndpoint: "https://api.openai.com/v1",
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        tavilyApiKey: "tv-test",
      };

      const result = validateSettings(settings);

      expect(result.errors).toEqual([]);
      expect(result.validatedSettings).toBeDefined();
      expect(result.validatedSettings?.validated).toBe(true);
    });

    it("既読化日数が無効な場合はエラーを返す", () => {
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilRead: 0,
        }).errors,
      ).toContain("既読化までの日数は1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilRead: 366,
        }).errors,
      ).toContain("既読化までの日数は1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilRead: 1.5,
        }).errors,
      ).toContain("既読化までの日数は1-365の整数で入力してください");
    });

    it("削除日数が無効な場合はエラーを返す", () => {
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilDelete: 0,
        }).errors,
      ).toContain("削除までの日数は-1または1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilDelete: 366,
        }).errors,
      ).toContain("削除までの日数は-1または1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilDelete: 2.5,
        }).errors,
      ).toContain("削除までの日数は-1または1-365の整数で入力してください");
    });

    it("最大エントリ数が無効な場合はエラーを返す", () => {
      expect(
        validateSettings({
          ...baseSettings,
          maxEntriesPerRun: 0,
        }).errors,
      ).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
      expect(
        validateSettings({
          ...baseSettings,
          maxEntriesPerRun: 101,
        }).errors,
      ).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
      expect(
        validateSettings({
          ...baseSettings,
          maxEntriesPerRun: 1.5,
        }).errors,
      ).toContain(
        "1回の実行で既読にする最大エントリ数は1-100の整数で入力してください",
      );
    });

    it("Tavily APIキーが未設定の場合はエラーを返す", () => {
      const { errors } = validateSettings({});

      expect(errors).toContain("Tavily APIキーを入力してください");
    });

    it("無効なOpenAI APIエンドポイントの場合はエラーを返す", () => {
      const { errors } = validateSettings({
        ...baseSettings,
        openaiEndpoint: "invalid-url",
      });

      expect(errors).toContain(
        "OpenAI APIエンドポイントは有効なURLで入力してください",
      );
    });

    it("無効なSlack Webhook URLの場合はエラーを返す", () => {
      const { errors: errors1 } = validateSettings({
        ...baseSettings,
        slackWebhookUrl: "invalid-url",
      });
      expect(errors1).toContain(
        "Slack Webhook URLは有効なURLで入力してください",
      );

      const { errors: errors2 } = validateSettings({
        ...baseSettings,
        slackWebhookUrl: "https://example.com/webhook",
      });
      expect(errors2).toContain(
        "Slack Webhook URLはSlackの正しいURLで入力してください",
      );
    });

    it("複数のエラーがある場合は全て返す", () => {
      const { errors } = validateSettings({
        ...baseSettings,
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
        ...baseSettings,
        daysUntilRead: 30,
        daysUntilDelete: 10,
      });

      expect(errors).toEqual([]);
    });

    it("削除日数と既読化日数が同じでも有効", () => {
      const { errors } = validateSettings({
        ...baseSettings,
        daysUntilRead: 30,
        daysUntilDelete: 30,
      });

      expect(errors).toEqual([]);
    });
  });
});
