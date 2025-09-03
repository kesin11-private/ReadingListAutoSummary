import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Firecrawl SDK のモック
const mockScrapeUrl = vi.fn();

// Firecrawl モジュールのモック
vi.mock("@mendable/firecrawl-js", () => {
  return {
    default: class MockFirecrawlApp {
      scrapeUrl = mockScrapeUrl;
    },
  };
});

// 動的インポートでテスト対象モジュールを読み込み
const { extractContent } = await import("../../src/backend/content_extractor");

describe("extractContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("APIキーが未設定の場合、エラーを返す", async () => {
    const result = await extractContent("https://example.com", "");

    expect(result).toEqual({
      success: false,
      error: "Firecrawl API キーが設定されていません",
    });
    // APIキーが空の場合はFirecrawl SDKが呼ばれないことを確認
    expect(mockScrapeUrl).not.toHaveBeenCalled();
  });

  it("正常な本文抽出が成功する", async () => {
    const mockContent = "# テスト記事\n\nこれはテスト記事の内容です。";
    const mockTitle = "テスト記事";
    mockScrapeUrl.mockResolvedValue({
      markdown: mockContent,
      metadata: { title: mockTitle },
    });

    const result = await extractContent("https://example.com", "fc-test-key");

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: mockTitle,
    });
    expect(mockScrapeUrl).toHaveBeenCalledWith("https://example.com", {
      formats: ["markdown"],
      onlyMainContent: true,
    });
  });

  it("抽出された本文が空の場合、エラーを返す", async () => {
    mockScrapeUrl.mockResolvedValue({
      markdown: "",
    });

    const extractPromise = extractContent("https://example.com", "fc-test-key");

    // リトライの遅延をスキップ (1000ms + 2000ms)
    await vi.advanceTimersByTimeAsync(3000);

    const result = await extractPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("抽出された本文が空です");
  });

  it("markdownフィールドが存在しない場合、エラーを返す", async () => {
    mockScrapeUrl.mockResolvedValue({});

    const extractPromise = extractContent("https://example.com", "fc-test-key");

    // リトライの遅延をスキップ (1000ms + 2000ms)
    await vi.advanceTimersByTimeAsync(3000);

    const result = await extractPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("抽出された本文が空です");
  });

  it("APIエラー時に1回目で失敗したら2回目で成功する", async () => {
    const mockContent = "# 回復成功\n\n最終的に成功した内容";
    const mockTitle = "回復成功";
    mockScrapeUrl
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValueOnce({
        markdown: mockContent,
        metadata: { title: mockTitle },
      });

    const extractPromise = extractContent("https://example.com", "fc-test-key");

    // 1回目失敗後の1000ms遅延をスキップ
    await vi.advanceTimersByTimeAsync(1000);

    const result = await extractPromise;

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: mockTitle,
    });
    expect(mockScrapeUrl).toHaveBeenCalledTimes(2);
  });

  it("3回連続で失敗した場合、最終的にエラーを返す", async () => {
    const apiError = new Error("Persistent API error");
    mockScrapeUrl
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError);

    const extractPromise = extractContent("https://example.com", "fc-test-key");

    // 1回目失敗後の1000ms遅延をスキップ
    await vi.advanceTimersByTimeAsync(1000);
    // 2回目失敗後の2000ms遅延をスキップ
    await vi.advanceTimersByTimeAsync(2000);

    const result = await extractPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Persistent API error");
    expect(mockScrapeUrl).toHaveBeenCalledTimes(3);
  });

  it("リトライ間に適切な遅延が発生する", async () => {
    // vitestのタイマーモックを使用
    const apiError = new Error("Network error");
    mockScrapeUrl
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError);

    const extractPromise = extractContent("https://example.com", "fc-test-key");

    // 最初の試行は失敗し、2回目の試行前に1000ms待機
    await vi.advanceTimersByTimeAsync(1000);

    // 2回目の試行も失敗し、3回目の試行前に2000ms待機
    await vi.advanceTimersByTimeAsync(2000);

    const result = await extractPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
    expect(mockScrapeUrl).toHaveBeenCalledTimes(3);
  });

  it("空白文字のみのAPIキーでエラーを返す", async () => {
    const result = await extractContent("https://example.com", "   ");

    expect(result).toEqual({
      success: false,
      error: "Firecrawl API キーが設定されていません",
    });
  });

  it("非Error型の例外もハンドリングする", async () => {
    mockScrapeUrl.mockRejectedValue("文字列エラー");

    const extractPromise = extractContent("https://example.com", "fc-test-key");

    // リトライの遅延をスキップ (1000ms + 2000ms)
    await vi.advanceTimersByTimeAsync(3000);

    const result = await extractPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("文字列エラー");
  });

  it("タイトルメタデータが存在しない場合、ホスト名をフォールバックとして使用する", async () => {
    const mockContent = "# テスト記事\n\nこれはテスト記事の内容です。";
    mockScrapeUrl.mockResolvedValue({
      markdown: mockContent,
      metadata: {},
    });

    const result = await extractContent("https://example.com", "fc-test-key");

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: "example.com",
    });
  });
});
