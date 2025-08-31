import FirecrawlApp from "@mendable/firecrawl-js";

export interface ExtractContentResult {
  success: boolean;
  content?: string;
  error?: string;
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

      // 指数バックオフで待機
      const delay = baseDelay * 2 ** (attempt - 1);
      console.log(`${delay}ms 待機してリトライします...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Firecrawl SDKを使用してURLから本文を抽出
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
    const app = new FirecrawlApp({ apiKey });

    const result = await retryWithExponentialBackoff(async () => {
      console.log(`Firecrawl API呼び出し: ${url}`);
      const response = await app.scrapeUrl(url, {
        formats: ["markdown"],
        onlyMainContent: true,
      });

      // エラーレスポンスの場合
      if (!response || !("markdown" in response) || !response.markdown) {
        throw new Error("抽出された本文が空です");
      }

      return response.markdown;
    });

    console.log(`本文抽出成功: ${url} (文字数: ${result.length})`);
    return {
      success: true,
      content: result,
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
