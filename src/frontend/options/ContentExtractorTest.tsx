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
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ExtractContentResult | null>(null);
  const [summarizeResult, setSummarizeResult] =
    useState<SummarizeResult | null>(null);

  const handleExtractAndSummarize = async () => {
    if (!url.trim()) {
      setResult({
        success: false,
        error: "URLを入力してください",
      });
      return;
    }

    setIsProcessing(true);
    setResult(null);
    setSummarizeResult(null);

    try {
      // Step 1: Extract content
      const extractMessage: ExtractContentMessage = {
        type: "EXTRACT_CONTENT",
        url: url.trim(),
      };

      const extractResponse = await chrome.runtime.sendMessage(extractMessage);

      if (!isExtractContentResult(extractResponse)) {
        setResult({
          success: false,
          error: "不正なレスポンス形式です",
        });
        return;
      }

      setResult(extractResponse);

      if (!extractResponse.success || !extractResponse.content) {
        return; // Extraction failed, stop here
      }

      // Step 2: Summarize content
      const title = new URL(url.trim()).hostname;

      const summarizeMessage: SummarizeTestMessage = {
        type: "SUMMARIZE_TEST",
        title,
        url: url.trim(),
        content: extractResponse.content,
      };

      const summarizeResponse =
        await chrome.runtime.sendMessage(summarizeMessage);

      if (isSummarizeResult(summarizeResponse)) {
        setSummarizeResult(summarizeResponse);
      } else {
        setSummarizeResult({
          success: false,
          error: "不正なレスポンス形式です",
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // If no extraction result yet, set extraction error
      if (!result) {
        setResult({
          success: false,
          error: errorMessage,
        });
      } else {
        // If extraction was successful but summarization failed
        setSummarizeResult({
          success: false,
          error: errorMessage,
        });
      }
    } finally {
      setIsProcessing(false);
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
            disabled={isProcessing}
          />
        </div>

        <div>
          <button
            type="button"
            onClick={handleExtractAndSummarize}
            disabled={isProcessing || !url.trim()}
            class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "処理中..." : "コンテンツ抽出・要約生成"}
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
