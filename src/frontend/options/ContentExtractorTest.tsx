import { useState } from "preact/hooks";
import type { ExtractContentResult } from "../../backend/content_extractor";
import type { SummarizeResult } from "../../backend/summarizer";
import type {
  ExtractContentMessage,
  SummarizeTestMessage,
} from "../../types/messages";

/**
 * Type guard to validate ExtractContentResult
 */
function isExtractContentResult(obj: unknown): obj is ExtractContentResult {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const result = obj as Record<string, unknown>;
  return (
    typeof result.success === "boolean" &&
    (result.success === false || typeof result.content === "string") &&
    (result.success === true || typeof result.error === "string")
  );
}

/**
 * Type guard to validate SummarizeResult
 */
function isSummarizeResult(obj: unknown): obj is SummarizeResult {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const result = obj as Record<string, unknown>;
  return (
    typeof result.success === "boolean" &&
    (result.success === false || typeof result.summary === "string") &&
    (result.success === true || typeof result.error === "string")
  );
}

export function ContentExtractorTest() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ExtractContentResult | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summarizeResult, setSummarizeResult] =
    useState<SummarizeResult | null>(null);

  const handleExtractContent = async () => {
    if (!url.trim()) {
      setResult({
        success: false,
        error: "URLを入力してください",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);
    setSummarizeResult(null);

    try {
      const message: ExtractContentMessage = {
        type: "EXTRACT_CONTENT",
        url: url.trim(),
      };

      const response = await chrome.runtime.sendMessage(message);

      if (isExtractContentResult(response)) {
        setResult(response);
      } else {
        setResult({
          success: false,
          error: "不正なレスポンス形式です",
        });
      }
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSummarizeContent = async () => {
    if (!result?.success || !result.content) {
      setSummarizeResult({
        success: false,
        error: "まず、コンテンツを抽出してください",
      });
      return;
    }

    setIsSummarizing(true);
    setSummarizeResult(null);

    try {
      // URLからタイトルを抽出（簡易実装）
      const title = new URL(url.trim()).hostname;

      const message: SummarizeTestMessage = {
        type: "SUMMARIZE_TEST",
        title,
        url: url.trim(),
        content: result.content,
      };

      const response = await chrome.runtime.sendMessage(message);

      if (isSummarizeResult(response)) {
        setSummarizeResult(response);
      } else {
        setSummarizeResult({
          success: false,
          error: "不正なレスポンス形式です",
        });
      }
    } catch (error) {
      setSummarizeResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSummarizing(false);
    }
  };

  return (
    <section class="bg-gray-50 p-4 rounded-lg">
      <h3 class="text-md font-semibold mb-4">コンテンツ抽出テスト</h3>

      <div class="space-y-4">
        <div>
          <label
            for="testUrl"
            class="block text-sm font-medium text-gray-700 mb-1"
          >
            テストURL
          </label>
          <input
            id="testUrl"
            type="url"
            placeholder="https://example.com/article"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
        </div>

        <div class="flex gap-2">
          <button
            type="button"
            onClick={handleExtractContent}
            disabled={isLoading || !url.trim()}
            class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "抽出中..." : "コンテンツを抽出"}
          </button>

          <button
            type="button"
            onClick={handleSummarizeContent}
            disabled={isSummarizing || !result?.success || !result.content}
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSummarizing ? "要約中..." : "要約を生成"}
          </button>
        </div>

        {result && (
          <div class="mt-4">
            <h4 class="text-sm font-medium text-gray-700 mb-2">抽出結果:</h4>
            {result.success ? (
              <div class="space-y-2">
                <div class="text-sm text-green-600 font-medium">
                  ✓ 抽出成功 (文字数: {result.content?.length || 0})
                </div>
                <div class="bg-white border rounded-md p-3 max-h-64 overflow-y-auto">
                  <pre class="text-xs text-gray-700 whitespace-pre-wrap">
                    {result.content}
                  </pre>
                </div>
              </div>
            ) : (
              <div class="text-sm text-red-600 font-medium">
                ✗ 抽出失敗: {result.error}
              </div>
            )}
          </div>
        )}

        {summarizeResult && (
          <div class="mt-4">
            <h4 class="text-sm font-medium text-gray-700 mb-2">要約結果:</h4>
            {summarizeResult.success ? (
              <div class="space-y-2">
                <div class="text-sm text-blue-600 font-medium">
                  ✓ 要約成功 (文字数: {summarizeResult.summary?.length || 0})
                  {summarizeResult.retryCount &&
                    ` (試行回数: ${summarizeResult.retryCount})`}
                </div>
                <div class="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <pre class="text-sm text-gray-700 whitespace-pre-wrap">
                    {summarizeResult.summary}
                  </pre>
                </div>
              </div>
            ) : (
              <div class="text-sm text-red-600 font-medium">
                ✗ 要約失敗: {summarizeResult.error}
                {summarizeResult.retryCount &&
                  ` (試行回数: ${summarizeResult.retryCount})`}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
