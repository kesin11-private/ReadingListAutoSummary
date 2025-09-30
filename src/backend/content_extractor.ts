import { DEFAULT_TAVILY_BASE_URL } from "../common/constants";

export type ExtractContentResult =
  | {
      success: true;
      content: string;
      title?: string;
    }
  | {
      success: false;
      error: string;
    };

export interface FirecrawlConfig {
  apiKey: string;
  baseUrl: string;
}

export interface TavilyConfig {
  apiKey: string;
}

export type ExtractContentConfig =
  | {
      provider: "firecrawl";
      firecrawl: FirecrawlConfig;
    }
  | {
      provider: "tavily";
      tavily: TavilyConfig;
    };

interface FirecrawlV2Metadata {
  title?: string;
  description?: string;
  language?: string;
  sourceURL?: string;
  statusCode?: number;
  error?: string;
}

interface FirecrawlV2Data {
  markdown?: string;
  metadata?: FirecrawlV2Metadata;
}

interface FirecrawlV2Response {
  success: boolean;
  data?: FirecrawlV2Data;
  warning?: string;
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

      // リトライ前に指数バックオフで待機
      const delay = baseDelay * 2 ** (attempt - 1);
      console.log(`${delay}ms 待機してリトライします...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Firecrawl APIを使用してURLから本文を抽出
 * 失敗時は指数バックオフで最大3回までリトライ
 */
export async function extractContent(
  url: string,
  config: ExtractContentConfig,
): Promise<ExtractContentResult> {
  console.log(`本文抽出開始: ${url} (provider=${config.provider})`);

  try {
    const result = await retryWithExponentialBackoff(async () => {
      if (config.provider === "firecrawl") {
        return extractWithFirecrawl(url, config.firecrawl);
      }

      return extractWithTavily(url, config.tavily);
    });

    console.log(`本文抽出成功: ${url} (文字数: ${result.content.length})`);
    return {
      success: true,
      content: result.content,
      title: result.title,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `本文抽出失敗: ${url} (provider=${config.provider}) - ${errorMessage}`,
    );
    return {
      success: false,
      error: errorMessage,
    };
  }
}

async function extractWithFirecrawl(
  url: string,
  config: FirecrawlConfig,
): Promise<{ content: string; title: string }> {
  console.log(`Firecrawl API呼び出し: ${url}`);

  const endpoint = new URL("/v2/scrape", config.baseUrl).toString();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Firecrawl API error: ${response.status} ${response.statusText}`,
    );
  }

  const apiResponse: FirecrawlV2Response = await response.json();

  if (!apiResponse?.data?.markdown) {
    throw new Error("抽出された本文が空です");
  }

  return {
    content: apiResponse.data.markdown,
    title: apiResponse.data.metadata?.title || new URL(url).hostname,
  };
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
    title: result.title || new URL(url).hostname,
  };
}
