import { readable } from "@mizchi/readability";
import { definePDFJSModule, extractText, getDocumentProxy } from "unpdf";
import * as unpdfPdfjs from "unpdf/pdfjs";
import {
  type ContentExtractorProvider,
  DEFAULT_CONTENT_EXTRACTOR_PROVIDER,
  DEFAULT_TAVILY_BASE_URL,
} from "../common/constants";

// ServiceWorker環境では動的import()が禁止されているため、
// 静的インポートでPDF.jsモジュールを事前登録する
await definePDFJSModule(async () => unpdfPdfjs);

export type ExtractContentOutcome =
  | "local-success"
  | "tavily-success"
  | "tavily-fallback-success"
  | "local-failed-no-fallback"
  | "tavily-only-failed"
  | "tavily-fallback-failed";

export type ExtractAttemptKind =
  | "local-success"
  | "configuration-missing"
  | "fetch-blocked"
  | "fetch-failed"
  | "parse-failed"
  | "tavily-success"
  | "tavily-failed"
  | "fallback-unavailable";

export interface ExtractAttempt {
  source: "local" | "tavily";
  success: boolean;
  kind: ExtractAttemptKind;
  error?: string;
  status?: number;
}

export type ExtractContentResult =
  | {
      success: true;
      content: string;
      title?: string;
      source: "local" | "tavily";
      outcome: "local-success" | "tavily-success" | "tavily-fallback-success";
      attempts: ExtractAttempt[];
    }
  | {
      success: false;
      error: string;
      outcome:
        | "local-failed-no-fallback"
        | "tavily-only-failed"
        | "tavily-fallback-failed";
      attempts: ExtractAttempt[];
    };

export interface TavilyConfig {
  apiKey: string;
}

export interface ExtractContentConfig {
  mode?: ContentExtractorProvider;
  tavily?: TavilyConfig;
}

interface TavilyExtractResult {
  url: string;
  raw_content?: string;
  title?: string;
  favicon?: string;
}

interface TavilyExtractResponse {
  results?: TavilyExtractResult[];
  failed_results?: Array<{
    url: string;
    error: string;
  }>;
}

type LocalExtractResult =
  | {
      success: true;
      content: string;
      title: string;
      attempt: ExtractAttempt;
    }
  | {
      success: false;
      attempt: ExtractAttempt;
    };

/**
 * 指数バックオフでリトライを実行する汎用関数
 */
async function retryWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`試行 ${attempt}/${maxRetries}`);
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.error(`試行 ${attempt} 失敗:`, error);

      if (attempt === maxRetries) {
        console.error(`最大リトライ回数 (${maxRetries}) に達しました`);
        break;
      }

      const delay = baseDelay * 2 ** (attempt - 1);
      console.log(`${delay}ms 待機してリトライします...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveFallbackTitle(url: string, title?: string): string {
  if (title?.trim()) {
    return title;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isPdfContent(contentType: string | null, url: string): boolean {
  if (contentType !== null) {
    return contentType.includes("application/pdf");
  }
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

async function extractPdfText(
  arrayBuffer: ArrayBuffer,
  url: string,
): Promise<LocalExtractResult> {
  let textPages: string[];
  try {
    const docProxy = await getDocumentProxy(arrayBuffer);
    const result = await extractText(docProxy);
    textPages = result.text;
  } catch (error) {
    return {
      success: false,
      attempt: {
        source: "local",
        success: false,
        kind: "parse-failed",
        error: `PDFテキスト抽出に失敗しました: ${normalizeErrorMessage(error)}`,
      },
    };
  }

  const content = textPages.join("\n\n").trim();
  if (!content) {
    return {
      success: false,
      attempt: {
        source: "local",
        success: false,
        kind: "parse-failed",
        error: "PDFからテキストを抽出できませんでした。",
      },
    };
  }

  return {
    success: true,
    content,
    title: resolveFallbackTitle(url),
    attempt: {
      source: "local",
      success: true,
      kind: "local-success",
    },
  };
}

function isBlockedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 451;
}

function isFetchBlockedError(error: unknown): boolean {
  const message = normalizeErrorMessage(error);
  return (
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed|cors|access/i.test(message)
  );
}

function formatAttempt(attempt: ExtractAttempt): string {
  const status = attempt.status !== undefined ? `(${attempt.status})` : "";
  const error = attempt.success || !attempt.error ? "" : `:${attempt.error}`;
  return `${attempt.source}:${attempt.kind}${status}${error}`;
}

export function summarizeExtractionResult(
  result: ExtractContentResult,
): string {
  return `outcome=${result.outcome}; attempts=${result.attempts
    .map(formatAttempt)
    .join(" -> ")}`;
}

/**
 * URLから本文を抽出する。ローカル本文取得 + readability を優先し、
 * 失敗時のみ Tavily Extract API にフォールバックする。
 */
export async function extractContent(
  url: string,
  config: ExtractContentConfig,
): Promise<ExtractContentResult> {
  const mode = config.mode ?? DEFAULT_CONTENT_EXTRACTOR_PROVIDER;
  console.log(`本文抽出開始: ${url} (mode=${mode})`);

  if (mode === "tavily") {
    return extractWithTavilyOnly(url, config);
  }

  return extractLocallyWithTavilyFallback(url, config);
}

async function extractLocallyWithTavilyFallback(
  url: string,
  config: ExtractContentConfig,
): Promise<ExtractContentResult> {
  const attempts: ExtractAttempt[] = [];
  const localResult = await extractLocally(url);
  attempts.push(localResult.attempt);

  if (localResult.success) {
    const result: ExtractContentResult = {
      success: true,
      content: localResult.content,
      title: localResult.title,
      source: "local",
      outcome: "local-success",
      attempts,
    };
    console.log(`本文抽出成功: ${url} (${summarizeExtractionResult(result)})`);
    return result;
  }

  console.warn(
    `ローカル抽出失敗: ${url} (${localResult.attempt.kind}) - ${localResult.attempt.error}`,
  );

  const tavilyApiKey = config.tavily?.apiKey?.trim();
  if (!tavilyApiKey) {
    const fallbackError =
      "Tavily API キーが未設定のためフォールバックできません。";
    attempts.push({
      source: "tavily",
      success: false,
      kind: "fallback-unavailable",
      error: fallbackError,
    });

    const result: ExtractContentResult = {
      success: false,
      error:
        localResult.attempt.error ||
        "ローカル抽出に失敗し、Tavilyフォールバックも利用できません。",
      outcome: "local-failed-no-fallback",
      attempts,
    };
    console.error(
      `本文抽出失敗: ${url} (${summarizeExtractionResult(result)})`,
    );
    return result;
  }

  try {
    const fallbackResult = await retryWithExponentialBackoff(() =>
      extractWithTavily(url, { apiKey: tavilyApiKey }),
    );
    attempts.push({
      source: "tavily",
      success: true,
      kind: "tavily-success",
    });

    const result: ExtractContentResult = {
      success: true,
      content: fallbackResult.content,
      title: fallbackResult.title,
      source: "tavily",
      outcome: "tavily-fallback-success",
      attempts,
    };
    console.log(`本文抽出成功: ${url} (${summarizeExtractionResult(result)})`);
    return result;
  } catch (error) {
    const fallbackError = normalizeErrorMessage(error);
    attempts.push({
      source: "tavily",
      success: false,
      kind: "tavily-failed",
      error: fallbackError,
    });

    const result: ExtractContentResult = {
      success: false,
      error: `ローカル抽出と Tavily フォールバックの両方に失敗しました。local=${localResult.attempt.error}; tavily=${fallbackError}`,
      outcome: "tavily-fallback-failed",
      attempts,
    };
    console.error(
      `本文抽出失敗: ${url} (${summarizeExtractionResult(result)})`,
    );
    return result;
  }
}

async function extractWithTavilyOnly(
  url: string,
  config: ExtractContentConfig,
): Promise<ExtractContentResult> {
  const attempts: ExtractAttempt[] = [];
  const tavilyApiKey = config.tavily?.apiKey?.trim();
  if (!tavilyApiKey) {
    const configError = "Tavily API キーが未設定のため本文抽出できません。";
    attempts.push({
      source: "tavily",
      success: false,
      kind: "configuration-missing",
      error: configError,
    });

    const result: ExtractContentResult = {
      success: false,
      error: configError,
      outcome: "tavily-only-failed",
      attempts,
    };
    console.error(
      `本文抽出失敗: ${url} (${summarizeExtractionResult(result)})`,
    );
    return result;
  }

  try {
    const tavilyResult = await retryWithExponentialBackoff(() =>
      extractWithTavily(url, { apiKey: tavilyApiKey }),
    );
    attempts.push({
      source: "tavily",
      success: true,
      kind: "tavily-success",
    });

    const result: ExtractContentResult = {
      success: true,
      content: tavilyResult.content,
      title: tavilyResult.title,
      source: "tavily",
      outcome: "tavily-success",
      attempts,
    };
    console.log(`本文抽出成功: ${url} (${summarizeExtractionResult(result)})`);
    return result;
  } catch (error) {
    const tavilyError = normalizeErrorMessage(error);
    attempts.push({
      source: "tavily",
      success: false,
      kind: "tavily-failed",
      error: tavilyError,
    });

    const result: ExtractContentResult = {
      success: false,
      error: `Tavily での本文抽出に失敗しました: ${tavilyError}`,
      outcome: "tavily-only-failed",
      attempts,
    };
    console.error(
      `本文抽出失敗: ${url} (${summarizeExtractionResult(result)})`,
    );
    return result;
  }
}

async function extractLocally(url: string): Promise<LocalExtractResult> {
  console.log(`ローカル本文取得開始: ${url}`);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (error) {
    const kind = isFetchBlockedError(error) ? "fetch-blocked" : "fetch-failed";

    return {
      success: false,
      attempt: {
        source: "local",
        success: false,
        kind,
        error: `ローカル本文取得に失敗しました: ${normalizeErrorMessage(error)}`,
      },
    };
  }

  if (!response.ok) {
    const kind = isBlockedStatus(response.status)
      ? "fetch-blocked"
      : "fetch-failed";

    return {
      success: false,
      attempt: {
        source: "local",
        success: false,
        kind,
        error: `ローカル本文取得に失敗しました: ${response.status} ${response.statusText}`,
        status: response.status,
      },
    };
  }

  // PDFの場合はunpdfでテキスト抽出
  const contentType = response.headers.get("content-type");
  if (isPdfContent(contentType, url)) {
    console.log(`PDFとして処理: ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    return extractPdfText(arrayBuffer, url);
  }

  const html = await response.text();
  if (!html.trim()) {
    return {
      success: false,
      attempt: {
        source: "local",
        success: false,
        kind: "parse-failed",
        error: "取得したHTMLが空のため本文抽出できません。",
      },
    };
  }

  try {
    const result = readable(html, {
      url,
      charThreshold: 20,
    });
    const content = result.toMarkdown().trim();
    if (!content) {
      const pageType = result.pageType === "article" ? "article" : "other";
      return {
        success: false,
        attempt: {
          source: "local",
          success: false,
          kind: "parse-failed",
          error: `readabilityで本文抽出できませんでした (pageType=${pageType})`,
        },
      };
    }

    return {
      success: true,
      content,
      title: resolveFallbackTitle(url, result.snapshot.metadata.title),
      attempt: {
        source: "local",
        success: true,
        kind: "local-success",
      },
    };
  } catch (error) {
    return {
      success: false,
      attempt: {
        source: "local",
        success: false,
        kind: "parse-failed",
        error: `readability解析に失敗しました: ${normalizeErrorMessage(error)}`,
      },
    };
  }
}

async function extractWithTavily(
  url: string,
  config: TavilyConfig,
): Promise<{ content: string; title: string }> {
  console.log(`Tavily API呼び出し: ${url}`);

  const endpoint = new URL("/extract", DEFAULT_TAVILY_BASE_URL).toString();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls: [url],
      extract_depth: "basic",
      format: "markdown",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Tavily API error: ${response.status} ${response.statusText}`,
    );
  }

  const apiResponse: TavilyExtractResponse = await response.json();

  const result = apiResponse?.results?.[0];
  if (!result?.raw_content) {
    const failedMessage = apiResponse?.failed_results?.[0]?.error;
    throw new Error(failedMessage || "抽出された本文が空です");
  }

  return {
    content: result.raw_content,
    title: resolveFallbackTitle(url, result.title),
  };
}
