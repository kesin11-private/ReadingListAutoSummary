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
    // コンソールログをモック（テスト出力を静かにするため）
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    mockScrapeUrl.mockResolvedValue({
      markdown: mockContent,
    });

    const result = await extractContent("https://example.com", "fc-test-key");

    expect(result).toEqual({
      success: true,
      content: mockContent,
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

    const result = await extractContent("https://example.com", "fc-test-key");

    expect(result.success).toBe(false);
    expect(result.error).toBe("抽出された本文が空です");
  });

  it("markdownフィールドが存在しない場合、エラーを返す", async () => {
    mockScrapeUrl.mockResolvedValue({});

    const result = await extractContent("https://example.com", "fc-test-key");

    expect(result.success).toBe(false);
    expect(result.error).toBe("抽出された本文が空です");
  });

  it("APIエラー時に1回目で失敗したら2回目で成功する", async () => {
    const mockContent = "# 回復成功\n\n最終的に成功した内容";
    mockScrapeUrl
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValueOnce({
        markdown: mockContent,
      });

    const result = await extractContent("https://example.com", "fc-test-key");

    expect(result).toEqual({
      success: true,
      content: mockContent,
    });
    expect(mockScrapeUrl).toHaveBeenCalledTimes(2);
  });

  it("3回連続で失敗した場合、最終的にエラーを返す", async () => {
    const apiError = new Error("Persistent API error");
    mockScrapeUrl
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError);

    const result = await extractContent("https://example.com", "fc-test-key");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Persistent API error");
    expect(mockScrapeUrl).toHaveBeenCalledTimes(3);
  });

  it("リトライ間に適切な遅延が発生する", async () => {
    const apiError = new Error("Network error");

    // setTimeout をモックして時間をコントロール
    const mockSetTimeout = vi.spyOn(global, "setTimeout").mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: vitest mock type compatibility
      ((callback: () => void, _delay: number) => {
        // 実際の遅延は発生させずに即座に実行
        callback();
        // biome-ignore lint/suspicious/noExplicitAny: vitest mock return type compatibility
        return 0 as any;
        // biome-ignore lint/suspicious/noExplicitAny: vitest mock type compatibility
      }) as any,
    );

    mockScrapeUrl
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError)
      .mockRejectedValueOnce(apiError);

    await extractContent("https://example.com", "fc-test-key");

    // リトライの遅延が適切に設定されているかチェック
    expect(mockSetTimeout).toHaveBeenCalledTimes(2); // 1回目と2回目の失敗後
    expect(mockSetTimeout).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      1000,
    ); // 1秒
    expect(mockSetTimeout).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      2000,
    ); // 2秒

    mockSetTimeout.mockRestore();
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

    const result = await extractContent("https://example.com", "fc-test-key");

    expect(result.success).toBe(false);
    expect(result.error).toBe("文字列エラー");
  });
});
