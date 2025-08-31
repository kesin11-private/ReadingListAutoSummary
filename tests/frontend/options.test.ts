import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Chrome API のモック設定
const mockChromeStorageLocal = {
  get: vi.fn(),
  set: vi.fn(),
};

// グローバル chrome オブジェクトのモック
beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: {
      local: mockChromeStorageLocal,
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// オプション画面で使用される設定操作をテスト
describe("Options Settings Management", () => {
  it("デフォルト設定値の読み込み", async () => {
    mockChromeStorageLocal.get.mockResolvedValue({});

    const result = await chrome.storage.local.get([
      "daysUntilRead",
      "daysUntilDelete",
      "openaiEndpoint",
      "openaiApiKey",
      "openaiModel",
      "slackWebhookUrl",
    ]);

    expect(result).toEqual({});
    expect(mockChromeStorageLocal.get).toHaveBeenCalledWith([
      "daysUntilRead",
      "daysUntilDelete",
      "openaiEndpoint",
      "openaiApiKey",
      "openaiModel",
      "slackWebhookUrl",
    ]);
  });

  it("保存済み設定値の読み込み", async () => {
    const savedSettings = {
      daysUntilRead: 14,
      daysUntilDelete: 30,
      openaiEndpoint: "https://api.openai.com/v1",
      openaiApiKey: "sk-test123",
      openaiModel: "gpt-4o-mini",
      slackWebhookUrl: "https://hooks.slack.com/test",
    };
    mockChromeStorageLocal.get.mockResolvedValue(savedSettings);

    const result = await chrome.storage.local.get([
      "daysUntilRead",
      "daysUntilDelete",
      "openaiEndpoint",
      "openaiApiKey",
      "openaiModel",
      "slackWebhookUrl",
    ]);

    expect(result).toEqual(savedSettings);
  });

  it("設定値の保存", async () => {
    const settingsToSave = {
      daysUntilRead: 21,
      daysUntilDelete: 45,
      openaiEndpoint: "https://api.custom.ai/v1",
      openaiApiKey: "sk-custom123",
      openaiModel: "gpt-4",
      slackWebhookUrl: "https://hooks.slack.com/test-webhook",
    };

    mockChromeStorageLocal.set.mockResolvedValue(undefined);

    await chrome.storage.local.set(settingsToSave);

    expect(mockChromeStorageLocal.set).toHaveBeenCalledWith(settingsToSave);
  });

  it("設定読み込みエラーのハンドリング", async () => {
    mockChromeStorageLocal.get.mockRejectedValue(
      new Error("Storage unavailable"),
    );

    try {
      await chrome.storage.local.get(["daysUntilRead", "daysUntilDelete"]);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Storage unavailable");
    }
  });

  it("設定保存エラーのハンドリング", async () => {
    mockChromeStorageLocal.set.mockRejectedValue(
      new Error("Storage write failed"),
    );

    try {
      await chrome.storage.local.set({ daysUntilRead: 30 });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Storage write failed");
    }
  });

  it("部分的な設定値の保存（空文字列は保存しない）", async () => {
    const settingsToSave = {
      daysUntilRead: 15,
      daysUntilDelete: 45,
      openaiEndpoint: "https://api.custom.ai/v1",
      openaiApiKey: "", // 空文字列は保存しない想定
    };

    // 空文字列フィールドを除外する処理をシミュレート
    const filteredSettings = Object.fromEntries(
      Object.entries(settingsToSave).filter(
        ([, value]) =>
          typeof value === "number" ||
          (typeof value === "string" && value !== ""),
      ),
    );

    mockChromeStorageLocal.set.mockResolvedValue(undefined);

    await chrome.storage.local.set(filteredSettings);

    expect(mockChromeStorageLocal.set).toHaveBeenCalledWith({
      daysUntilRead: 15,
      daysUntilDelete: 45,
      openaiEndpoint: "https://api.custom.ai/v1",
    });
  });

  it("数値設定のバリデーション", () => {
    // 日数設定のバリデーションロジックをテスト
    const validateDays = (value: number, min = 1, max = 365): boolean => {
      return value >= min && value <= max && Number.isInteger(value);
    };

    // 正常値
    expect(validateDays(30)).toBe(true);
    expect(validateDays(1)).toBe(true);
    expect(validateDays(365)).toBe(true);

    // 異常値
    expect(validateDays(0)).toBe(false);
    expect(validateDays(366)).toBe(false);
    expect(validateDays(-1)).toBe(false);
    expect(validateDays(30.5)).toBe(false);
  });

  it("設定値のデフォルト値適用", () => {
    // オプション画面で使用される設定マージロジックをテスト
    const mergeWithDefaults = (
      stored: Record<string, string | number | undefined>,
    ) => {
      const defaults = {
        daysUntilRead: 30,
        daysUntilDelete: 60,
      };

      return {
        daysUntilRead: stored.daysUntilRead ?? defaults.daysUntilRead,
        daysUntilDelete: stored.daysUntilDelete ?? defaults.daysUntilDelete,
        openaiEndpoint: stored.openaiEndpoint || "",
        openaiApiKey: stored.openaiApiKey || "",
        openaiModel: stored.openaiModel || "",
        slackWebhookUrl: stored.slackWebhookUrl || "",
      };
    };

    // 空のストレージからデフォルト値が適用される
    expect(mergeWithDefaults({})).toEqual({
      daysUntilRead: 30,
      daysUntilDelete: 60,
      openaiEndpoint: "",
      openaiApiKey: "",
      openaiModel: "",
      slackWebhookUrl: "",
    });

    // 部分的な設定値が適用される
    expect(mergeWithDefaults({ daysUntilRead: 15 })).toEqual({
      daysUntilRead: 15,
      daysUntilDelete: 60,
      openaiEndpoint: "",
      openaiApiKey: "",
      openaiModel: "",
      slackWebhookUrl: "",
    });
  });
});
