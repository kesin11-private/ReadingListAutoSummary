import { useState } from "preact/hooks";
import type { ExtractContentResult } from "../../backend/content_extractor";
import type { ExtractContentMessage } from "../../types/messages";

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

export function ContentExtractorTest() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ExtractContentResult | null>(null);

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

        <button
          type="button"
          onClick={handleExtractContent}
          disabled={isLoading || !url.trim()}
          class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "抽出中..." : "コンテンツを抽出"}
        </button>

        {result && (
          <div class="mt-4">
            <h4 class="text-sm font-medium text-gray-700 mb-2">結果:</h4>
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
      </div>
    </section>
  );
}
