import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FIRECRAWL_BASE_URL,
  DEFAULT_TAVILY_BASE_URL,
} from "../../src/common/constants";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { extractContent } = await import("../../src/backend/content_extractor");

describe("extractContent", () => {
  const firecrawlConfig = {
    provider: "firecrawl" as const,
    firecrawl: {
      apiKey: "fc-test-key",
      baseUrl: DEFAULT_FIRECRAWL_BASE_URL,
    },
  };

  const tavilyConfig = {
    provider: "tavily" as const,
    tavily: {
      apiKey: "tv-test-key",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("Firecrawl: APIキーが空の場合はAPI呼び出しに失敗する", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const extractPromise = extractContent("https://example.com", {
      provider: "firecrawl",
      firecrawl: { apiKey: "", baseUrl: "https://api.firecrawl.dev" },
    });
    await vi.runAllTimersAsync();
    const result = await extractPromise;

    if (result.success) {
      throw new Error("Expected failure result");
    }
    expect(result.error).toContain("Firecrawl API error");
  });

  it("Firecrawl: 正常に本文を抽出する", async () => {
    const mockContent = "# テスト記事\n\nこれはテスト記事の内容です。";
    const mockTitle = "テスト記事";
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: mockContent,
          metadata: { title: mockTitle },
        },
      }),
    });

    const result = await extractContent("https://example.com", firecrawlConfig);

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: mockTitle,
    });

    const expectedEndpoint = new URL(
      "/v2/scrape",
      DEFAULT_FIRECRAWL_BASE_URL,
    ).toString();
    expect(mockFetch).toHaveBeenCalledWith(expectedEndpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer fc-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com",
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });
  });

  it("Firecrawl: カスタムBase URLを使用する", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: "# テスト",
          metadata: { title: "テスト" },
        },
      }),
    });

    await extractContent("https://example.com", {
      provider: "firecrawl",
      firecrawl: {
        apiKey: "fc-test-key",
        baseUrl: "http://localhost:3002",
      },
    });

    const customEndpoint = new URL(
      "/v2/scrape",
      "http://localhost:3002",
    ).toString();
    expect(mockFetch).toHaveBeenCalledWith(customEndpoint, expect.any(Object));
  });

  it("Firecrawl: 無効なBase URLの場合はエラーを返す", async () => {
    const extractPromise = extractContent("https://example.com", {
      provider: "firecrawl",
      firecrawl: {
        apiKey: "fc-test-key",
        baseUrl: "::invalid-url::",
      },
    });
    await vi.runAllTimersAsync();
    const result = await extractPromise;

    if (result.success) {
      throw new Error("Expected failure result");
    }
    expect(result.error).toContain("Invalid URL");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("Firecrawl: 抽出結果が空の場合はリトライ後にエラーを返す", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: "",
        },
      }),
    });

    const extractPromise = extractContent(
      "https://example.com",
      firecrawlConfig,
    );
    await vi.runAllTimersAsync();
    const result = await extractPromise;

    if (result.success) {
      throw new Error("Expected failure result");
    }
    expect(result.error).toBe("抽出された本文が空です");
  });

  it("Firecrawl: APIエラーからリカバリーできる", async () => {
    const mockContent = "# 回復成功\n\n最終的に成功した内容";
    const mockTitle = "回復成功";
    mockFetch
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            markdown: mockContent,
            metadata: { title: mockTitle },
          },
        }),
      });

    const extractPromise = extractContent(
      "https://example.com",
      firecrawlConfig,
    );

    await vi.advanceTimersByTimeAsync(1000);
    const result = await extractPromise;

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: mockTitle,
    });
  });

  it("Tavily: APIキーが空の場合はAPI呼び出しに失敗する", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const extractPromise = extractContent("https://example.com", {
      provider: "tavily",
      tavily: { apiKey: "" },
    });
    await vi.runAllTimersAsync();
    const result = await extractPromise;

    if (result.success) {
      throw new Error("Expected failure result");
    }
    expect(result.error).toContain("Tavily API error");
  });

  it("Tavily: 正常に本文を抽出する", async () => {
    const mockContent = "# Tavilyテスト\n\n本文";
    const mockTitle = "Tavilyタイトル";
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            url: "https://example.com",
            raw_content: mockContent,
            title: mockTitle,
          },
        ],
      }),
    });

    const result = await extractContent("https://example.com", tavilyConfig);

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: mockTitle,
    });

    const expectedEndpoint = new URL(
      "/extract",
      DEFAULT_TAVILY_BASE_URL,
    ).toString();
    expect(mockFetch).toHaveBeenCalledWith(expectedEndpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer tv-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: ["https://example.com"],
        extract_depth: "basic",
        format: "markdown",
      }),
    });
  });

  it("Tavily: 失敗結果のみの場合はエラーを返す", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        failed_results: [
          {
            url: "https://example.com",
            error: "Rate limited",
          },
        ],
      }),
    });

    const extractPromise = extractContent("https://example.com", tavilyConfig);
    await vi.runAllTimersAsync();
    const result = await extractPromise;

    if (result.success) {
      throw new Error("Expected failure result");
    }
    expect(result.error).toBe("Rate limited");
  });

  it("Tavily: HTTPエラーをハンドリングする", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    const extractPromise = extractContent("https://example.com", tavilyConfig);
    await vi.runAllTimersAsync();
    const result = await extractPromise;

    if (result.success) {
      throw new Error("Expected failure result");
    }
    expect(result.error).toBe("Tavily API error: 429 Too Many Requests");
  });
});
