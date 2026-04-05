import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteEntry,
  getReadingListEntries,
  markAsReadAndNotify,
  processReadingListEntries,
  shouldDelete,
  shouldMarkAsRead,
} from "../../src/backend/background";
import {
  DELETION_DISABLED_VALUE,
  getSettings,
} from "../../src/common/chrome_storage";
import {
  DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
  DEFAULT_FIRECRAWL_BASE_URL,
} from "../../src/common/constants";

vi.mock("../../src/backend/content_extractor", () => ({
  extractContent: vi.fn(),
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
};

const mockChromeReadingList = {
  query: vi.fn(),
  updateEntry: vi.fn(),
  removeEntry: vi.fn(),
};

const completeSettings = {
  daysUntilRead: 30,
  daysUntilDelete: 60,
  maxEntriesPerRun: 3,
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
  slackWebhookUrl: "https://hooks.slack.com/test",
  contentExtractorProvider: "firecrawl" as const,
  firecrawlApiKey: "fc-test-key",
  firecrawlBaseUrl: DEFAULT_FIRECRAWL_BASE_URL,
};

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

describe("getSettings", () => {
  it("デフォルト設定を返す（ストレージが空の場合）", async () => {
    mockChromeStorageLocal.get.mockResolvedValue({});

    const settings = await getSettings();

    expect(settings).toEqual({
      daysUntilRead: 30,
      daysUntilDelete: DELETION_DISABLED_VALUE,
      maxEntriesPerRun: 3,
      alarmIntervalMinutes: 720,
      llmEndpoints: [],
      llmModels: [],
      selectedLlmEndpointId: null,
      selectedLlmModelId: null,
      contentExtractorProvider: DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
      firecrawlBaseUrl: DEFAULT_FIRECRAWL_BASE_URL,
    });
  });

  it("ストレージから複数LLM設定を正常取得", async () => {
    mockChromeStorageLocal.get.mockResolvedValue({
      ...completeSettings,
      alarmIntervalMinutes: 720,
      systemPrompt: "カスタムプロンプト",
    });

    const settings = await getSettings();

    expect(settings.llmEndpoints).toEqual(completeSettings.llmEndpoints);
    expect(settings.llmModels).toEqual(completeSettings.llmModels);
    expect(settings.selectedLlmEndpointId).toBe("endpoint-1");
    expect(settings.selectedLlmModelId).toBe("model-1");
  });
});

describe("getReadingListEntries", () => {
  it("リーディングリストエントリを正常取得", async () => {
    const mockEntries = [
      {
        url: "https://example.com/1",
        title: "テスト記事1",
        hasBeenRead: false,
        creationTime: Date.now() - 25 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now() - 25 * 24 * 60 * 60 * 1000,
      },
    ];
    mockChromeReadingList.query.mockResolvedValue(mockEntries);

    const entries = await getReadingListEntries();

    expect(entries).toEqual(mockEntries);
    expect(mockChromeReadingList.query).toHaveBeenCalledWith({});
  });
});

describe("shouldMarkAsRead", () => {
  it("未読エントリが期間経過で既読化対象になる", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: false,
      creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
    };

    expect(shouldMarkAsRead(entry, 30)).toBe(true);
  });

  it("既読エントリは既読化対象外", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 10 * 24 * 60 * 60 * 1000,
    };

    expect(shouldMarkAsRead(entry, 30)).toBe(false);
  });
});

describe("shouldDelete", () => {
  it("既読エントリが期間経過で削除対象になる", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 80 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 65 * 24 * 60 * 60 * 1000,
    };

    expect(shouldDelete(entry, 60)).toBe(true);
  });

  it("削除機能が無効化されている場合は削除対象外", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 80 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 65 * 24 * 60 * 60 * 1000,
    };

    expect(shouldDelete(entry, DELETION_DISABLED_VALUE)).toBe(false);
  });
});

describe("markAsReadAndNotify", () => {
  const entry = {
    url: "https://example.com",
    title: "テスト記事",
    hasBeenRead: false,
    creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
    lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
  };

  it("本文抽出成功時に選択中モデルで要約してSlackに投稿", async () => {
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue({
      success: true,
      content: "# テスト記事\n\nテスト本文",
    });
    vi.mocked(mockSummarizeContent).mockResolvedValue({
      success: true,
      summary: "要約文1\n要約文2\n要約文3",
      retryCount: 1,
      modelName: "gpt-4o-mini",
    });
    vi.mocked(mockFormatSlackMessage).mockReturnValue(
      "formatted slack message",
    );
    vi.mocked(mockPostToSlack).mockResolvedValue();

    await markAsReadAndNotify(entry, completeSettings);

    expect(mockSummarizeContent).toHaveBeenCalledWith(
      entry.title,
      entry.url,
      "# テスト記事\n\nテスト本文",
      {
        endpoint: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "gpt-4o-mini",
      },
      expect.any(String),
    );
    expect(mockPostToSlack).toHaveBeenCalledWith(
      completeSettings.slackWebhookUrl,
      "formatted slack message",
    );
  });

  it("APIキーが空欄でも選択中モデルで要約できる", async () => {
    const selectedEndpoint = completeSettings.llmEndpoints[0];
    if (!selectedEndpoint) {
      throw new Error("テスト用エンドポイントがありません");
    }

    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue({
      success: true,
      content: "# テスト記事\n\nテスト本文",
    });
    vi.mocked(mockSummarizeContent).mockResolvedValue({
      success: true,
      summary: "要約文",
      retryCount: 1,
      modelName: "gpt-4o-mini",
    });
    vi.mocked(mockFormatSlackMessage).mockReturnValue(
      "formatted slack message",
    );
    vi.mocked(mockPostToSlack).mockResolvedValue();

    await markAsReadAndNotify(entry, {
      ...completeSettings,
      llmEndpoints: [
        {
          ...selectedEndpoint,
          apiKey: "",
        },
      ],
    });

    expect(mockSummarizeContent).toHaveBeenCalledWith(
      entry.title,
      entry.url,
      "# テスト記事\n\nテスト本文",
      {
        endpoint: "https://api.openai.com/v1",
        apiKey: expect.any(String),
        model: "gpt-4o-mini",
      },
      expect.any(String),
    );
    expect(mockPostToSlack).toHaveBeenCalledWith(
      completeSettings.slackWebhookUrl,
      "formatted slack message",
    );
  });

  it("本文抽出失敗時に選択中モデル名でエラーメッセージをSlackに投稿", async () => {
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue({
      success: false,
      error: "コンテンツ抽出に失敗",
    });
    vi.mocked(mockFormatSlackErrorMessage).mockReturnValue(
      "formatted extraction error message",
    );
    vi.mocked(mockPostToSlack).mockResolvedValue();

    await markAsReadAndNotify(entry, completeSettings);

    expect(mockFormatSlackErrorMessage).toHaveBeenCalledWith(
      entry.title,
      entry.url,
      "gpt-4o-mini",
      expect.stringContaining("firecrawl"),
    );
    expect(mockPostToSlack).toHaveBeenCalledWith(
      completeSettings.slackWebhookUrl,
      "formatted extraction error message",
    );
  });
});

describe("deleteEntry", () => {
  it("エントリを正常に削除", async () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 80 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 65 * 24 * 60 * 60 * 1000,
    };
    mockChromeReadingList.removeEntry.mockResolvedValue(undefined);

    await deleteEntry(entry);

    expect(mockChromeReadingList.removeEntry).toHaveBeenCalledWith({
      url: entry.url,
    });
  });
});

describe("processReadingListEntries", () => {
  it("maxEntriesPerRunの設定に従って処理数を制限する", async () => {
    const mockEntries = [
      {
        url: "https://example.com/1",
        title: "最古の記事",
        hasBeenRead: false,
        creationTime: Date.now() - 40 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now() - 40 * 24 * 60 * 60 * 1000,
      },
      {
        url: "https://example.com/2",
        title: "2番目に古い記事",
        hasBeenRead: false,
        creationTime: Date.now() - 39 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now() - 39 * 24 * 60 * 60 * 1000,
      },
      {
        url: "https://example.com/3",
        title: "3番目に古い記事",
        hasBeenRead: false,
        creationTime: Date.now() - 38 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now() - 38 * 24 * 60 * 60 * 1000,
      },
      {
        url: "https://example.com/4",
        title: "4番目に古い記事",
        hasBeenRead: false,
        creationTime: Date.now() - 37 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now() - 37 * 24 * 60 * 60 * 1000,
      },
    ];

    mockChromeStorageLocal.get.mockResolvedValue(completeSettings);
    mockChromeReadingList.query.mockResolvedValue(mockEntries);
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    vi.mocked(mockExtractContent).mockResolvedValue({
      success: true,
      content: "本文",
    });
    vi.mocked(mockSummarizeContent).mockResolvedValue({
      success: true,
      summary: "要約",
      retryCount: 1,
      modelName: "gpt-4o-mini",
    });
    vi.mocked(mockFormatSlackMessage).mockReturnValue(
      "formatted slack message",
    );
    vi.mocked(mockPostToSlack).mockResolvedValue();

    await processReadingListEntries();

    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledTimes(3);
    expect(mockChromeReadingList.updateEntry).toHaveBeenNthCalledWith(1, {
      url: "https://example.com/1",
      hasBeenRead: true,
    });
  });
});
