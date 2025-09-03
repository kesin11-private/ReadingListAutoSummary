export interface ExtractContentResult {
  success: boolean;
  content?: string;
  title?: string;
  error?: string;
}

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
  apiKey: string,
): Promise<ExtractContentResult> {
  if (!apiKey?.trim()) {
    const error = "Firecrawl API キーが設定されていません";
    console.error(error);
    return {
      success: false,
      error,
    };
  }

  console.log(`本文抽出開始: ${url}`);

  try {
    const result = await retryWithExponentialBackoff(async () => {
      console.log(`Firecrawl API呼び出し: ${url}`);

      const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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

      // エラーレスポンスの場合
      if (!apiResponse || !apiResponse.data || !apiResponse.data.markdown) {
        throw new Error("抽出された本文が空です");
      }

      return {
        content: apiResponse.data.markdown,
        title: apiResponse.data.metadata?.title || new URL(url).hostname,
      };
    });

    console.log(`本文抽出成功: ${url} (文字数: ${result.content.length})`);
    return {
      success: true,
      content: result.content,
      title: result.title,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`本文抽出失敗: ${url} - ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
