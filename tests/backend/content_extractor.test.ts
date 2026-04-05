import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TAVILY_BASE_URL } from "../../src/common/constants";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { extractContent, summarizeExtractionResult } = await import(
  "../../src/backend/content_extractor"
);

const localArticleHtml = `<!doctype html>
<html>
  <head>
    <title>Local Title</title>
  </head>
  <body>
    <main>
      <article>
        <h1>Local Title</h1>
        <p>${"あ".repeat(120)}</p>
        <p>${"い".repeat(120)}</p>
      </article>
    </main>
  </body>
</html>`;

const nonArticleHtml = `<!doctype html>
<html>
  <head>
    <title>Index</title>
  </head>
  <body>
    <nav><a href="/a">A</a><a href="/b">B</a></nav>
    <footer>Footer</footer>
  </body>
</html>`;

describe("extractContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("ローカルHTML取得と readability で本文抽出に成功する", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => localArticleHtml,
    });

    const result = await extractContent("https://example.com/article", {});

    expect(result).toEqual({
      success: true,
      content: expect.stringContaining("# Local Title"),
      title: "Local Title",
      source: "local",
      outcome: "local-success",
      attempts: [
        {
          source: "local",
          success: true,
          kind: "local-success",
        },
      ],
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/article", {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  });

  it("ローカル fetch がブロックされた場合に Tavily へフォールバックする", async () => {
    const mockContent = "# Tavilyタイトル\n\nTavily本文";
    const mockTitle = "Tavilyタイトル";
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              url: "https://example.com/article",
              raw_content: mockContent,
              title: mockTitle,
            },
          ],
        }),
      });

    const result = await extractContent("https://example.com/article", {
      tavily: { apiKey: "tv-test-key" },
    });

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: mockTitle,
      source: "tavily",
      outcome: "tavily-fallback-success",
      attempts: [
        {
          source: "local",
          success: false,
          kind: "fetch-blocked",
          error: "ローカルHTML取得に失敗しました: 403 Forbidden",
          status: 403,
        },
        {
          source: "tavily",
          success: true,
          kind: "tavily-success",
        },
      ],
    });

    const expectedEndpoint = new URL(
      "/extract",
      DEFAULT_TAVILY_BASE_URL,
    ).toString();
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expectedEndpoint,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer tv-test-key",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("ローカル fetch 例外かつ Tavily 未設定なら失敗詳細を返す", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await extractContent("https://example.com/article", {});

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected failure result");
    }

    expect(result.outcome).toBe("local-failed-no-fallback");
    expect(result.error).toBe(
      "ローカルHTML取得に失敗しました: Failed to fetch",
    );
    expect(result.attempts).toEqual([
      {
        source: "local",
        success: false,
        kind: "fetch-blocked",
        error: "ローカルHTML取得に失敗しました: Failed to fetch",
      },
      {
        source: "tavily",
        success: false,
        kind: "fallback-unavailable",
        error: "Tavily API キーが未設定のためフォールバックできません。",
      },
    ]);
  });

  it("ローカル parse 失敗後に Tavily も失敗したら両方の失敗を返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => nonArticleHtml,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        failed_results: [
          {
            url: "https://example.com/article",
            error: "Rate limited",
          },
        ],
      }),
    });

    const extractPromise = extractContent("https://example.com/article", {
      tavily: { apiKey: "tv-test-key" },
    });
    await vi.runAllTimersAsync();
    const result = await extractPromise;

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected failure result");
    }

    expect(result.outcome).toBe("tavily-fallback-failed");
    expect(result.error).toContain(
      "ローカル抽出と Tavily フォールバックの両方に失敗しました。",
    );
    expect(result.error).toContain(
      "readabilityで本文抽出できませんでした (pageType=other)",
    );
    expect(result.error).toContain("tavily=Rate limited");
    expect(result.attempts).toEqual([
      {
        source: "local",
        success: false,
        kind: "parse-failed",
        error: "readabilityで本文抽出できませんでした (pageType=other)",
      },
      {
        source: "tavily",
        success: false,
        kind: "tavily-failed",
        error: "Rate limited",
      },
    ]);
  });

  it("Tavily フォールバックはリトライ後に回復できる", async () => {
    const mockContent = "# 回復成功\n\n最終的に成功した内容";
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      })
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              url: "https://example.com/article",
              raw_content: mockContent,
              title: "回復成功",
            },
          ],
        }),
      });

    const extractPromise = extractContent("https://example.com/article", {
      tavily: { apiKey: "tv-test-key" },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await extractPromise;

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: "回復成功",
      source: "tavily",
      outcome: "tavily-fallback-success",
      attempts: [
        {
          source: "local",
          success: false,
          kind: "fetch-blocked",
          error: "ローカルHTML取得に失敗しました: 403 Forbidden",
          status: 403,
        },
        {
          source: "tavily",
          success: true,
          kind: "tavily-success",
        },
      ],
    });
  });

  it("抽出サマリーでローカル失敗と Tavily 成功を区別できる", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              url: "https://example.com/article",
              raw_content: "# Tavily\n\n本文",
              title: "Tavily",
            },
          ],
        }),
      });

    const result = await extractContent("https://example.com/article", {
      tavily: { apiKey: "tv-test-key" },
    });

    expect(summarizeExtractionResult(result)).toBe(
      "outcome=tavily-fallback-success; attempts=local:fetch-blocked(403):ローカルHTML取得に失敗しました: 403 Forbidden -> tavily:tavily-success",
    );
  });
});
