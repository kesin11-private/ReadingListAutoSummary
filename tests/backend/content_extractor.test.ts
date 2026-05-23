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

const redirectedArticleHtml = `<!doctype html>
<html>
  <body>
    <article>
      <img src="/images/cover.png" alt="cover" />
      <p>${"う".repeat(140)}</p>
      <p>${"え".repeat(140)}</p>
    </article>
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

const htmlLikeTokenArticleHtml = `<!doctype html>
<html>
  <head>
    <title>HTML Token Sample</title>
  </head>
  <body>
    <article>
      <h1>HTML Token Sample</h1>
      <p>脚注<sup>1</sup>と化学式 H<sub>2</sub>O を含みます。</p>
      <p>タグ名は <span>&lt;img&gt;</span> です。</p>
      <p>インラインコードは <code>&lt;section&gt;</code> です。</p>
      <pre><code class="language-html">&lt;p&gt;Hello&lt;/p&gt;</code></pre>
    </article>
  </body>
</html>`;

const localArticleExcerpt = "あ".repeat(20);
const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_SPAN_RE = /`[^`\n]+`/g;
const RAW_HTML_TAG_RE = /<\/?[A-Za-z][^>]*>/g;

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
    url: "https://example.com/mock-response",
    headers,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => ({}),
    ...rest,
  };
}

function hasResidualHtmlTags(markdown: string): boolean {
  let protectedMarkdown = markdown;

  for (const pattern of [FENCED_CODE_BLOCK_RE, INLINE_CODE_SPAN_RE]) {
    protectedMarkdown = protectedMarkdown.replace(
      pattern,
      "__CODE_PLACEHOLDER__",
    );
  }

  return (protectedMarkdown.match(RAW_HTML_TAG_RE) ?? []).length > 0;
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

  it("ローカルHTML取得と defuddle で本文抽出に成功する", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ text: async () => localArticleHtml }),
    );

    const result = await extractContent("https://example.com/article", {});

    expect(result).toEqual({
      success: true,
      content: expect.stringContaining(localArticleExcerpt),
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
    if (!result.success) {
      throw new Error("Expected success result");
    }
    expect(hasResidualHtmlTags(result.content)).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/article", {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  });

  it("リダイレクト後の最終URLを defuddle のベースURLとタイトル解決に使う", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({
        url: "https://redirected.example.org/final/article",
        text: async () => redirectedArticleHtml,
      }),
    );

    const result = await extractContent("https://example.com/article", {});

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success result");
    }
    expect(result.content).toContain(
      "https://redirected.example.org/images/cover.png",
    );
    expect(result.title).toBe("redirected.example.org");
    expect(result.source).toBe("local");
    expect(result.outcome).toBe("local-success");
    expect(hasResidualHtmlTags(result.content)).toBe(false);
    expect(result.attempts).toEqual([
      {
        source: "local",
        success: true,
        kind: "local-success",
      },
    ]);
  });

  it("defuddle の markdown に残るHTMLタグを除去しつつコード例は保つ", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ text: async () => htmlLikeTokenArticleHtml }),
    );

    const result = await extractContent("https://example.com/article", {});

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected success result");
    }
    expect(result.content).toContain("^1^");
    expect(result.content).toContain("H~2~O");
    expect(result.content).toContain("&lt;img&gt;");
    expect(result.content).toContain("`<section>`");
    expect(result.content).toContain("```html");
    expect(result.content).toContain("<p>Hello</p>");
    expect(hasResidualHtmlTags(result.content)).toBe(false);
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

  it("defuddle が empty content を返したら診断しやすいエラーを返す", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({
        url: "https://redirected.example.org/landing",
        text: async () => nonArticleHtml,
      }),
    );

    const result = await extractContent("https://example.com/article", {});

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected failure result");
    }

    expect(result.outcome).toBe("local-failed-no-fallback");
    expect(result.error).toContain("defuddleがempty contentを返しました");
    expect(result.error).toContain('title="Index"');
    expect(result.error).toContain("contentLength=0");
    expect(result.error).toContain(
      "url=https://redirected.example.org/landing",
    );
    expect(result.attempts).toEqual([
      {
        source: "local",
        success: false,
        kind: "parse-failed",
        error: expect.stringContaining("defuddleがempty contentを返しました"),
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
    expect(result.error).toContain("defuddleがempty contentを返しました");
    expect(result.error).toContain("tavily=Rate limited");
    expect(result.attempts).toEqual([
      {
        source: "local",
        success: false,
        kind: "parse-failed",
        error: expect.stringContaining(
          'defuddleがempty contentを返しました: title="Index"',
        ),
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
    it("Content-Type が大文字小文字違いでもPDFとして扱い、unpdfでテキスト抽出に成功する", async () => {
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
              name === "content-type"
                ? "Application/PDF; charset=binary"
                : null,
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

    it("Content-Type が PDF 以外でもURLが.pdfで終わる場合はPDFとして処理する", async () => {
      const mockDocProxy = {};
      const mockPdfText = ["PDF本文テキスト"];
      vi.mocked(getDocumentProxy).mockResolvedValueOnce(mockDocProxy as never);
      vi.mocked(extractText).mockResolvedValueOnce({
        totalPages: 1,
        text: mockPdfText,
      } as never);

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          headers: { get: () => "application/octet-stream" },
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

    it("PDFレスポンスの arrayBuffer 読み取り失敗時も Tavily にフォールバックする", async () => {
      const mockTavilyContent = "# Tavily PDF本文\n\nPDFの代替コンテンツ";
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            headers: { get: () => "application/pdf" },
            arrayBuffer: async () => {
              throw new Error("Body stream aborted");
            },
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
            kind: "fetch-failed",
            error: "PDF本文取得に失敗しました: Body stream aborted",
          },
          {
            source: "tavily",
            success: true,
            kind: "tavily-success",
          },
        ],
      });
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

    it("PDFではないContent-Typeの場合はdefuddleで処理する", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          headers: { get: () => "text/html; charset=utf-8" },
          text: async () => localArticleHtml,
        }),
      );

      const result = await extractContent("https://example.com/article", {});

      expect(result).toEqual({
        success: true,
        content: expect.stringContaining(localArticleExcerpt),
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
      expect(getDocumentProxy).not.toHaveBeenCalled();
      expect(extractText).not.toHaveBeenCalled();
    });
  });
});
