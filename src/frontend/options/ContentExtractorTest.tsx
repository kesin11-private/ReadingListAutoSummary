import { useState } from "preact/hooks";
import type { ExtractContentResult } from "../../backend/content_extractor";
import type { SummarizeResult } from "../../backend/summarizer";
import type { ContentExtractorProvider } from "../../common/constants";
import type {
  ExtractContentMessage,
  SlackTestMessage,
  SlackTestResult,
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

/**
 * Type guard to validate SlackTestResult
 */
function isSlackTestResult(obj: unknown): obj is SlackTestResult {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const result = obj as Record<string, unknown>;
  return (
    typeof result.success === "boolean" &&
    (result.success === true || typeof result.error === "string")
  );
}

interface ContentExtractorTestProps {
  provider: ContentExtractorProvider;
}

export function ContentExtractorTest({ provider }: ContentExtractorTestProps) {
  const [url, setUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ExtractContentResult | null>(null);
  const [summarizeResult, setSummarizeResult] =
    useState<SummarizeResult | null>(null);
  const [isSlackPosting, setIsSlackPosting] = useState(false);
  const [slackResult, setSlackResult] = useState<SlackTestResult | null>(null);

  const handleSlackTest = async () => {
    if (!summarizeResult?.success || !summarizeResult.summary) return;

    setIsSlackPosting(true);
    setSlackResult(null);

    try {
      // Slack設定の確認
      const settings = await chrome.storage.local.get(["slackWebhookUrl"]);
      if (!settings.slackWebhookUrl) {
        setSlackResult({
          success: false,
          error:
            "Slack Webhook URLが設定されていません。設定画面で設定してください。",
        });
        return;
      }

      // 要約結果をSlackメッセージ形式に変換
      const title =
        (result?.success === true ? result.title : undefined) ||
        new URL(url.trim()).hostname;
      const modelName = summarizeResult.modelName || "Unknown Model";

      const message: SlackTestMessage = {
        type: "SLACK_TEST",
        title,
        url: url.trim(),
        modelName,
        summary: summarizeResult.summary,
      };

      const response = await chrome.runtime.sendMessage(message);

      if (isSlackTestResult(response)) {
        setSlackResult(response);
      } else {
        setSlackResult({
          success: false,
          error: "不正なレスポンス形式です",
        });
      }
    } catch (error) {
      setSlackResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSlackPosting(false);
    }
  };

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
    setSlackResult(null);

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
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-md font-semibold">コンテンツ抽出テスト</h3>
        <span class="text-xs font-medium text-gray-600 border border-gray-300 rounded px-2 py-1">
          現在のプロバイダー: {provider === "tavily" ? "Tavily" : "Firecrawl"}
        </span>
      </div>

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
                <div class="mt-3">
                  <button
                    type="button"
                    onClick={handleSlackTest}
                    disabled={isSlackPosting}
                    class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSlackPosting ? "投稿中..." : "Slackへの投稿テスト"}
                  </button>
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

        {slackResult && (
          <div class="mt-4">
            <h4 class="text-sm font-medium text-gray-700 mb-2">
              Slack投稿結果:
            </h4>
            <div
              class={`p-3 rounded-md text-sm ${
                slackResult.success
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
            >
              {slackResult.success
                ? "✓ Slackへの投稿が完了しました！"
                : `✗ 投稿エラー: ${slackResult.error}`}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
