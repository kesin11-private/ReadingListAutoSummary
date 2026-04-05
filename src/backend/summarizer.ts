import OpenAI from "openai";

/**
 * 要約結果の型定義
 */
export interface SummarizeResult {
  success: boolean;
  summary?: string;
  error?: string;
  retryCount?: number;
  modelName?: string;
}

/**
 * 要約設定の型定義
 */
export interface SummarizerConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

interface ChatCompletionResponseLike {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

/**
 * 指数バックオフでのリトライ用の遅延時間を計算
 */
function calculateBackoffDelay(attempt: number): number {
  const baseDelay = 1000; // 1秒
  return baseDelay * 2 ** (attempt - 1);
}

/**
 * 指定した時間だけ待機
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isChatCompletionResponseLike(
  response: unknown,
): response is ChatCompletionResponseLike {
  return (
    typeof response === "object" &&
    response !== null &&
    "choices" in response &&
    Array.isArray(response.choices)
  );
}

function createInvalidResponseErrorMessage(config: SummarizerConfig): string {
  return [
    "要約APIから期待した形式のレスポンスを受け取れませんでした。",
    `確認候補: エンドポイントURL (${config.endpoint}) が正しいか、モデル名 (${config.model}) が存在するか、接続先が OpenAI 互換の chat completions API を提供しているか、認証設定が接続先の仕様と一致しているか。`,
  ].join(" ");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractSummaryFromResponse(
  response: unknown,
  config: SummarizerConfig,
): string {
  if (
    !isChatCompletionResponseLike(response) ||
    !Array.isArray(response.choices)
  ) {
    console.error("要約APIレスポンス形式エラー:", {
      endpoint: config.endpoint,
      model: config.model,
      response,
    });
    throw new Error(createInvalidResponseErrorMessage(config));
  }

  const summary = response.choices[0]?.message?.content?.trim();
  if (!summary) {
    throw new Error("要約結果が空です");
  }

  return summary;
}

/**
 * OpenAI APIを使用してコンテンツを要約
 * リトライ機能付き（指数バックオフで最大3回まで）
 */
export async function summarizeContent(
  title: string,
  url: string,
  content: string,
  config: SummarizerConfig,
  systemPrompt: string,
): Promise<SummarizeResult> {
  const maxRetries = 3;
  const client = new OpenAI({
    baseURL: config.endpoint,
    apiKey: config.apiKey,
  });
  const userPrompt = `以下のWebページを要約してください：\n\nタイトル: ${title}\nURL: ${url}\n\n内容:\n${content}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`要約開始 (試行 ${attempt}/${maxRetries}): ${title}`);

    try {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        stream: false,
      });

      const summary = extractSummaryFromResponse(response, config);

      console.log(`要約生成成功 (試行 ${attempt}): ${title}`);
      console.log(`生成された要約 (${summary.length}文字): ${summary}`);

      return {
        success: true,
        summary,
        retryCount: attempt,
        modelName: config.model,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error(
        `要約失敗 (試行 ${attempt}/${maxRetries}): ${errorMessage}`,
      );

      // 最後の試行でない場合はリトライ
      if (attempt < maxRetries) {
        const delayMs = calculateBackoffDelay(attempt);
        console.log(`${delayMs}ms後にリトライします...`);
        await delay(delayMs);
        continue;
      }

      // 最後の試行でも失敗した場合
      console.error(`要約生成失敗 (全${maxRetries}回試行): ${title}`);
      return {
        success: false,
        error: errorMessage,
        retryCount: attempt,
        modelName: config.model,
      };
    }
  }

  // ここには到達しないはずですが、型安全性のため
  return {
    success: false,
    error: "不明なエラー",
    retryCount: maxRetries,
  };
}

/**
 * Slack投稿用のメッセージフォーマットを生成
 * フォーマット:
 * *{title}*
 * {url}
 *
 * _{model_name}による要約_
 *
 * {summary}
 */
export function formatSlackMessage(
  title: string,
  url: string,
  modelName: string,
  summary: string,
): string {
  return `*${title}*
${url}

_${modelName}による要約_

${summary}`;
}

/**
 * 要約失敗時のSlack投稿用メッセージを生成
 */
export function formatSlackErrorMessage(
  title: string,
  url: string,
  modelName: string,
  error: string,
): string {
  return `*${title}*
${url}

_${modelName}による要約_

要約生成に失敗しました: ${error}


`;
}
