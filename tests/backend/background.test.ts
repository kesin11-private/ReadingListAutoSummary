import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteEntry,
  getReadingListEntries,
  markAsReadAndNotify,
  processReadingListEntries,
  shouldDelete,
  shouldMarkAsRead,
} from "../../src/backend/background";
import type { ExtractContentResult } from "../../src/backend/content_extractor";
import {
  DELETION_DISABLED_VALUE,
  type Settings,
} from "../../src/common/chrome_storage";

function createExtractSuccessResult(
  overrides: Partial<Extract<ExtractContentResult, { success: true }>> = {},
): Extract<ExtractContentResult, { success: true }> {
  return {
    success: true,
    content: "# テスト記事\n\nテスト本文",
    title: "テスト記事",
    source: "local",
    outcome: "local-success",
    attempts: [
      {
        source: "local",
        success: true,
        kind: "local-success",
      },
    ],
    ...overrides,
  };
}

function createExtractFailureResult(
  error = "ローカル本文取得に失敗しました: 403 Forbidden",
): ExtractContentResult {
  return {
    success: false,
    error,
    outcome: "local-failed-no-fallback",
    attempts: [
      {
        source: "local",
        success: false,
        kind: "fetch-blocked",
        error,
        status: 403,
      },
      {
        source: "tavily",
        success: false,
        kind: "fallback-unavailable",
        error: "Tavily API キーが未設定のためフォールバックできません。",
      },
    ],
  };
}

vi.mock("../../src/backend/content_extractor", () => ({
  extractContent: vi.fn(),
  summarizeExtractionResult: vi.fn(
    (result: ExtractContentResult) =>
      `outcome=${result.outcome}; attempts=${result.attempts
        .map((attempt) => `${attempt.source}:${attempt.kind}`)
        .join(" -> ")}`,
  ),
}));

vi.mock("../../src/backend/post", () => ({
  postToSlack: vi.fn(),
}));

vi.mock("../../src/backend/summarizer", () => ({
  summarizeContent: vi.fn(),
  formatSlackMessage: vi.fn(),
  formatSlackErrorMessage: vi.fn(),
}));

const { extractContent: mockExtractContent } = await import(
  "../../src/backend/content_extractor"
);
const { postToSlack: mockPostToSlack } = await import("../../src/backend/post");
const {
  summarizeContent: mockSummarizeContent,
  formatSlackMessage: mockFormatSlackMessage,
  formatSlackErrorMessage: mockFormatSlackErrorMessage,
} = await import("../../src/backend/summarizer");

const mockChromeStorageLocal = {
  get: vi.fn(),
  remove: vi.fn(),
  set: vi.fn(),
};

const mockChromeReadingList = {
  query: vi.fn(),
  updateEntry: vi.fn(),
  removeEntry: vi.fn(),
};

const completeSettings: Settings = {
  daysUntilRead: 30,
  daysUntilDelete: 60,
  maxEntriesPerDay: 2,
  alarmIntervalMinutes: 720,
  llmEndpoints: [
    {
      id: "endpoint-1",
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1",
      apiKey: "test-key",
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
  contentExtractorProvider: "local-with-tavily-fallback",
  slackWebhookUrl: "https://hooks.slack.com/test",
  tavilyApiKey: "tv-test-key",
  systemPrompt: "カスタムプロンプト",
};

function setupMockStorage(overrides: Record<string, unknown> = {}): void {
  const storedValues = {
    ...completeSettings,
    ...overrides,
  };

  mockChromeStorageLocal.set.mockImplementation(async (values) => {
    Object.assign(storedValues, values);
  });
  mockChromeStorageLocal.remove.mockImplementation(async (keys: string[]) => {
    for (const key of keys) {
      delete storedValues[key as keyof typeof storedValues];
    }
  });
  mockChromeStorageLocal.get.mockImplementation(async (keys?: string[]) => {
    if (!Array.isArray(keys)) {
      return storedValues;
    }

    return Object.fromEntries(
      keys.flatMap((key) =>
        storedValues[key as keyof typeof storedValues] === undefined
          ? []
          : [[key, storedValues[key as keyof typeof storedValues]]],
      ),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: {
      local: mockChromeStorageLocal,
    },
    readingList: mockChromeReadingList,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("getReadingListEntries", () => {
  it("リーディングリストエントリを正常取得", async () => {
    const mockEntries = [
      {
        url: "https://example.com/1",
        title: "テスト記事1",
        hasBeenRead: false,
        creationTime: Date.now(),
        lastUpdateTime: Date.now(),
      },
    ];
    mockChromeReadingList.query.mockResolvedValue(mockEntries);

    await expect(getReadingListEntries()).resolves.toEqual(mockEntries);
    expect(mockChromeReadingList.query).toHaveBeenCalledWith({});
  });

  it("リーディングリストAPIエラー時に空配列を返す", async () => {
    mockChromeReadingList.query.mockRejectedValue(new Error("API error"));

    await expect(getReadingListEntries()).resolves.toEqual([]);
  });
});

describe("shouldMarkAsRead", () => {
  it("未読エントリが期間経過で既読化対象になる", () => {
    expect(
      shouldMarkAsRead(
        {
          url: "https://example.com",
          title: "記事",
          hasBeenRead: false,
          creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
          lastUpdateTime: Date.now(),
        },
        30,
      ),
    ).toBe(true);
  });
});

describe("shouldDelete", () => {
  it("削除機能が無効のときは削除対象外", () => {
    expect(
      shouldDelete(
        {
          url: "https://example.com",
          title: "記事",
          hasBeenRead: true,
          creationTime: Date.now(),
          lastUpdateTime: Date.now() - 80 * 24 * 60 * 60 * 1000,
        },
        DELETION_DISABLED_VALUE,
      ),
    ).toBe(false);
  });
});

describe("markAsReadAndNotify", () => {
  const entry = {
    url: "https://example.com/article",
    title: "テスト記事",
    hasBeenRead: false,
    creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
    lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
  };

  it("ローカル抽出成功時に選択中モデルで要約してSlackに投稿する", async () => {
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue(
      createExtractSuccessResult(),
    );
    vi.mocked(mockSummarizeContent).mockResolvedValue({
      success: true,
      summary: "要約文1\n\n要約文2\n\n要約文3",
      modelName: "gpt-4o-mini",
    });
    vi.mocked(mockFormatSlackMessage).mockReturnValue(
      "formatted slack message",
    );
    vi.mocked(mockPostToSlack).mockResolvedValue();

    await markAsReadAndNotify(entry, completeSettings);

    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledWith({
      url: entry.url,
      hasBeenRead: true,
    });
    expect(mockExtractContent).toHaveBeenCalledWith(entry.url, {
      mode: "local-with-tavily-fallback",
      tavily: {
        apiKey: "tv-test-key",
      },
    });
    expect(mockSummarizeContent).toHaveBeenCalledWith(
      entry.title,
      entry.url,
      "# テスト記事\n\nテスト本文",
      {
        endpoint: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "gpt-4o-mini",
      },
      "カスタムプロンプト",
    );
    expect(mockPostToSlack).toHaveBeenCalledWith(
      completeSettings.slackWebhookUrl,
      "formatted slack message",
    );
  });

  it("抽出失敗時は要約せずにSlackへエラー通知する", async () => {
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue(
      createExtractFailureResult(),
    );
    vi.mocked(mockFormatSlackErrorMessage).mockReturnValue("formatted error");
    vi.mocked(mockPostToSlack).mockResolvedValue();

    await markAsReadAndNotify(entry, completeSettings);

    expect(mockExtractContent).toHaveBeenCalledWith(entry.url, {
      mode: "local-with-tavily-fallback",
      tavily: {
        apiKey: "tv-test-key",
      },
    });
    expect(mockSummarizeContent).not.toHaveBeenCalled();
    expect(mockFormatSlackErrorMessage).toHaveBeenCalledWith(
      entry.title,
      entry.url,
      "gpt-4o-mini",
      expect.stringContaining("本文抽出失敗:"),
    );
    expect(mockPostToSlack).toHaveBeenCalledWith(
      completeSettings.slackWebhookUrl,
      "formatted error",
    );
  });
});

describe("deleteEntry", () => {
  it("削除処理で removeEntry を呼ぶ", async () => {
    mockChromeReadingList.removeEntry.mockResolvedValue(undefined);

    await deleteEntry({
      url: "https://example.com/remove",
      title: "削除対象",
      hasBeenRead: true,
      creationTime: Date.now(),
      lastUpdateTime: Date.now(),
    });

    expect(mockChromeReadingList.removeEntry).toHaveBeenCalledWith({
      url: "https://example.com/remove",
    });
  });
});

describe("processReadingListEntries", () => {
  it("自動実行では既読化対象を古い順かつ日次上限の残枠まで処理する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    setupMockStorage({
      dailySummaryQuotaDate: "2099-01-01",
      dailySummaryQuotaCount: 0,
    });
    mockChromeReadingList.query.mockResolvedValue([
      {
        url: "https://example.com/newer",
        title: "newer",
        hasBeenRead: false,
        creationTime: Date.now() - 31 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
      {
        url: "https://example.com/oldest",
        title: "oldest",
        hasBeenRead: false,
        creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
      {
        url: "https://example.com/middle",
        title: "middle",
        hasBeenRead: false,
        creationTime: Date.now() - 45 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
    ]);
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue(
      createExtractSuccessResult(),
    );
    vi.mocked(mockSummarizeContent).mockResolvedValue({
      success: true,
      summary: "要約",
      modelName: "gpt-4o-mini",
    });
    vi.mocked(mockFormatSlackMessage).mockReturnValue(
      "formatted slack message",
    );
    vi.mocked(mockPostToSlack).mockResolvedValue();

    await processReadingListEntries();

    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledTimes(2);
    expect(mockChromeReadingList.updateEntry).toHaveBeenNthCalledWith(1, {
      url: "https://example.com/oldest",
      hasBeenRead: true,
    });
    expect(mockChromeReadingList.updateEntry).toHaveBeenNthCalledWith(2, {
      url: "https://example.com/middle",
      hasBeenRead: true,
    });
    expect(mockChromeStorageLocal.set).toHaveBeenNthCalledWith(1, {
      dailySummaryQuotaDate: "2099-01-01",
      dailySummaryQuotaCount: 1,
    });
    expect(mockChromeStorageLocal.set).toHaveBeenNthCalledWith(2, {
      dailySummaryQuotaDate: "2099-01-01",
      dailySummaryQuotaCount: 2,
    });
    vi.useRealTimers();
  });

  it("自動実行では今日の残枠がなければ既読化しないが削除は続ける", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    setupMockStorage({
      dailySummaryQuotaDate: "2099-01-01",
      dailySummaryQuotaCount: 2,
    });
    mockChromeReadingList.query.mockResolvedValue([
      {
        url: "https://example.com/unread",
        title: "unread",
        hasBeenRead: false,
        creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
      {
        url: "https://example.com/read",
        title: "read",
        hasBeenRead: true,
        creationTime: Date.now() - 90 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now() - 90 * 24 * 60 * 60 * 1000,
      },
    ]);
    mockChromeReadingList.removeEntry.mockResolvedValue(undefined);

    await processReadingListEntries();

    expect(mockChromeReadingList.updateEntry).not.toHaveBeenCalled();
    expect(mockChromeReadingList.removeEntry).toHaveBeenCalledWith({
      url: "https://example.com/read",
    });
    expect(mockChromeStorageLocal.set).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("手動実行でも日次上限に達していれば既読化しない", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    setupMockStorage({
      dailySummaryQuotaDate: "2099-01-01",
      dailySummaryQuotaCount: 2,
    });
    mockChromeReadingList.query.mockResolvedValue([
      {
        url: "https://example.com/oldest",
        title: "oldest",
        hasBeenRead: false,
        creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
      {
        url: "https://example.com/middle",
        title: "middle",
        hasBeenRead: false,
        creationTime: Date.now() - 45 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
      {
        url: "https://example.com/newer",
        title: "newer",
        hasBeenRead: false,
        creationTime: Date.now() - 31 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
    ]);
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue(
      createExtractSuccessResult(),
    );
    vi.mocked(mockSummarizeContent).mockResolvedValue({
      success: true,
      summary: "要約",
      modelName: "gpt-4o-mini",
    });
    vi.mocked(mockFormatSlackMessage).mockReturnValue(
      "formatted slack message",
    );
    vi.mocked(mockPostToSlack).mockResolvedValue();

    await processReadingListEntries();

    expect(mockChromeReadingList.updateEntry).not.toHaveBeenCalled();
    expect(mockChromeStorageLocal.set).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("既読化後の通知が失敗しても日次クォータは加算する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    setupMockStorage({
      dailySummaryQuotaDate: "2099-01-01",
      dailySummaryQuotaCount: 0,
    });
    mockChromeReadingList.query.mockResolvedValue([
      {
        url: "https://example.com/oldest",
        title: "oldest",
        hasBeenRead: false,
        creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
    ]);
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue(
      createExtractSuccessResult(),
    );
    vi.mocked(mockSummarizeContent).mockResolvedValue({
      success: true,
      summary: "要約",
      modelName: "gpt-4o-mini",
    });
    vi.mocked(mockFormatSlackMessage).mockReturnValue(
      "formatted slack message",
    );
    vi.mocked(mockPostToSlack).mockRejectedValue(new Error("slack failed"));

    await processReadingListEntries();

    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledTimes(1);
    expect(mockChromeStorageLocal.set).toHaveBeenCalledWith({
      dailySummaryQuotaDate: "2099-01-01",
      dailySummaryQuotaCount: 1,
    });
    const quotaUpdateCallOrder =
      mockChromeStorageLocal.set.mock.invocationCallOrder[0];
    const slackNotificationCallOrder =
      vi.mocked(mockPostToSlack).mock.invocationCallOrder[0];
    expect(quotaUpdateCallOrder).toBeDefined();
    expect(slackNotificationCallOrder).toBeDefined();
    if (
      quotaUpdateCallOrder === undefined ||
      slackNotificationCallOrder === undefined
    ) {
      throw new Error("呼び出し順序を検証できませんでした");
    }
    expect(quotaUpdateCallOrder).toBeLessThan(slackNotificationCallOrder);
    vi.useRealTimers();
  });

  it("同時に複数回呼ばれても既存の処理を共有して二重実行しない", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    setupMockStorage({
      dailySummaryQuotaDate: "2099-01-01",
      dailySummaryQuotaCount: 0,
    });
    mockChromeReadingList.query.mockResolvedValue([
      {
        url: "https://example.com/oldest",
        title: "oldest",
        hasBeenRead: false,
        creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now(),
      },
    ]);
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue(
      createExtractSuccessResult(),
    );
    vi.mocked(mockSummarizeContent).mockResolvedValue({
      success: true,
      summary: "要約",
      modelName: "gpt-4o-mini",
    });
    vi.mocked(mockFormatSlackMessage).mockReturnValue(
      "formatted slack message",
    );
    vi.mocked(mockPostToSlack).mockResolvedValue();

    const firstProcessing = processReadingListEntries();
    const secondProcessing = processReadingListEntries();

    expect(firstProcessing).toBe(secondProcessing);

    await Promise.all([firstProcessing, secondProcessing]);

    expect(mockChromeReadingList.query).toHaveBeenCalledTimes(1);
    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledTimes(1);
    expect(mockChromeStorageLocal.set).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
