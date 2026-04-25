import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TAVILY_BASE_URL } from "../../src/common/constants";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// unpdfをモック
vi.mock("unpdf", () => ({
  definePDFJSModule: vi.fn(),
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

// unpdf/pdfjsをモック（静的インポート用）
vi.mock("unpdf/pdfjs", () => ({
  default: {},
}));

const { extractContent, summarizeExtractionResult } = await import(
  "../../src/backend/content_extractor"
);
const { getDocumentProxy, extractText } = await import("unpdf");

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

/** モック用のResponse風オブジェクトを作成するヘルパー */
function createMockResponse(overrides: Record<string, unknown> = {}) {
  const { headers: headersOverride, ...rest } = overrides;
  const headers =
    typeof headersOverride === "object" && headersOverride !== null
      ? headersOverride
      : { get: () => null };
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => ({}),
    ...rest,
  };
}

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
    mockFetch.mockResolvedValue(
      createMockResponse({ text: async () => localArticleHtml }),
    );

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
      .mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          json: async () => ({
            results: [
              {
                url: "https://example.com/article",
                raw_content: mockContent,
                title: mockTitle,
              },
            ],
          }),
        }),
      );

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
          error: "ローカル本文取得に失敗しました: 403 Forbidden",
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

  it("Tavily モードではローカル取得を行わずに本文抽出する", async () => {
    const mockContent = "# Tavilyタイトル\n\nTavily本文";
    const mockTitle = "Tavilyタイトル";
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        json: async () => ({
          results: [
            {
              url: "https://example.com/article",
              raw_content: mockContent,
              title: mockTitle,
            },
          ],
        }),
      }),
    );

    const result = await extractContent("https://example.com/article", {
      mode: "tavily",
      tavily: { apiKey: "tv-test-key" },
    });

    expect(result).toEqual({
      success: true,
      content: mockContent,
      title: mockTitle,
      source: "tavily",
      outcome: "tavily-success",
      attempts: [
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
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expectedEndpoint,
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("Tavily モードでAPIキーが未設定なら失敗する", async () => {
    const result = await extractContent("https://example.com/article", {
      mode: "tavily",
    });

    expect(result).toEqual({
      success: false,
      error: "Tavily API キーが未設定のため本文抽出できません。",
      outcome: "tavily-only-failed",
      attempts: [
        {
          source: "tavily",
          success: false,
          kind: "configuration-missing",
          error: "Tavily API キーが未設定のため本文抽出できません。",
        },
      ],
    });
    expect(mockFetch).not.toHaveBeenCalled();
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
      "ローカル本文取得に失敗しました: Failed to fetch",
    );
    expect(result.attempts).toEqual([
      {
        source: "local",
        success: false,
        kind: "fetch-blocked",
        error: "ローカル本文取得に失敗しました: Failed to fetch",
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
    mockFetch
      .mockResolvedValueOnce(
        createMockResponse({ text: async () => nonArticleHtml }),
      )
      .mockResolvedValue(
        createMockResponse({
          json: async () => ({
            results: [],
            failed_results: [
              {
                url: "https://example.com/article",
                error: "Rate limited",
              },
            ],
          }),
        }),
      );

    const extractPromise = extractContent("https://example.com/article", {
      mode: "local-with-tavily-fallback",
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
      .mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        }),
      )
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValueOnce(
        createMockResponse({
          json: async () => ({
            results: [
              {
                url: "https://example.com/article",
                raw_content: mockContent,
                title: "回復成功",
              },
            ],
          }),
        }),
      );

    const extractPromise = extractContent("https://example.com/article", {
      mode: "local-with-tavily-fallback",
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
          error: "ローカル本文取得に失敗しました: 403 Forbidden",
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
      .mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          json: async () => ({
            results: [
              {
                url: "https://example.com/article",
                raw_content: "# Tavily\n\n本文",
                title: "Tavily",
              },
            ],
          }),
        }),
      );

    const result = await extractContent("https://example.com/article", {
      mode: "local-with-tavily-fallback",
      tavily: { apiKey: "tv-test-key" },
    });

    expect(summarizeExtractionResult(result)).toBe(
      "outcome=tavily-fallback-success; attempts=local:fetch-blocked(403):ローカル本文取得に失敗しました: 403 Forbidden -> tavily:tavily-success",
    );
  });

  describe("PDF抽出", () => {
    it("Content-Type が application/pdf の場合、unpdfでテキスト抽出に成功する", async () => {
      const mockDocProxy = {};
      const mockPdfText = ["1ページ目のテキスト", "2ページ目のテキスト"];
      vi.mocked(getDocumentProxy).mockResolvedValueOnce(mockDocProxy as never);
      vi.mocked(extractText).mockResolvedValueOnce({
        totalPages: 2,
        text: mockPdfText,
      } as never);

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          headers: {
            get: (name: string) =>
              name === "content-type" ? "application/pdf" : null,
          },
          arrayBuffer: async () => new ArrayBuffer(100),
        }),
      );

      const result = await extractContent("https://example.com/paper.pdf", {});

      expect(result).toEqual({
        success: true,
        content: "1ページ目のテキスト\n\n2ページ目のテキスト",
        title: "example.com",
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
      expect(getDocumentProxy).toHaveBeenCalledTimes(1);
      expect(extractText).toHaveBeenCalledWith(mockDocProxy);
    });

    it("Content-Type ヘッダーがなくてもURLが.pdfで終わる場合はPDFとして処理する", async () => {
      const mockDocProxy = {};
      const mockPdfText = ["PDF本文テキスト"];
      vi.mocked(getDocumentProxy).mockResolvedValueOnce(mockDocProxy as never);
      vi.mocked(extractText).mockResolvedValueOnce({
        totalPages: 1,
        text: mockPdfText,
      } as never);

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(100),
        }),
      );

      const result = await extractContent(
        "https://example.com/docs/whitepaper.pdf",
        {},
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Expected success");
      expect(result.content).toBe("PDF本文テキスト");
      expect(result.source).toBe("local");
      expect(result.outcome).toBe("local-success");
    });

    it("PDFテキスト抽出結果が空の場合は parse-failed となる", async () => {
      const mockDocProxy = {};
      vi.mocked(getDocumentProxy).mockResolvedValueOnce(mockDocProxy as never);
      vi.mocked(extractText).mockResolvedValueOnce({
        totalPages: 1,
        text: [""],
      } as never);

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          headers: { get: () => "application/pdf" },
          arrayBuffer: async () => new ArrayBuffer(100),
        }),
      );

      const result = await extractContent("https://example.com/empty.pdf", {});

      expect(result.success).toBe(false);
      if (result.success) throw new Error("Expected failure");
      expect(result.outcome).toBe("local-failed-no-fallback");
      expect(result.attempts[0]).toEqual({
        source: "local",
        success: false,
        kind: "parse-failed",
        error: "PDFからテキストを抽出できませんでした。",
      });
    });

    it("PDF抽出失敗時にTavilyフォールバックが機能する", async () => {
      const mockDocProxy = {};
      vi.mocked(getDocumentProxy).mockResolvedValueOnce(mockDocProxy as never);
      vi.mocked(extractText).mockRejectedValueOnce(
        new Error("PDF parsing error") as never,
      );

      const mockTavilyContent = "# Tavily PDF本文\n\nPDFの代替コンテンツ";
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            headers: { get: () => "application/pdf" },
            arrayBuffer: async () => new ArrayBuffer(100),
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            json: async () => ({
              results: [
                {
                  url: "https://example.com/paper.pdf",
                  raw_content: mockTavilyContent,
                  title: "Tavily PDFタイトル",
                },
              ],
            }),
          }),
        );

      const result = await extractContent("https://example.com/paper.pdf", {
        tavily: { apiKey: "tv-test-key" },
      });

      expect(result).toEqual({
        success: true,
        content: mockTavilyContent,
        title: "Tavily PDFタイトル",
        source: "tavily",
        outcome: "tavily-fallback-success",
        attempts: [
          {
            source: "local",
            success: false,
            kind: "parse-failed",
            error: "PDFテキスト抽出に失敗しました: PDF parsing error",
          },
          {
            source: "tavily",
            success: true,
            kind: "tavily-success",
          },
        ],
      });
    });

    it("PDFではないContent-Typeの場合はreadabilityで処理する", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          headers: { get: () => "text/html; charset=utf-8" },
          text: async () => localArticleHtml,
        }),
      );

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
      // readabilityが使われ、unpdfは呼ばれないことを確認
      expect(getDocumentProxy).not.toHaveBeenCalled();
      expect(extractText).not.toHaveBeenCalled();
    });
  });
});
