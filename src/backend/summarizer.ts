import OpenAI from "openai";

/**
 * 要約結果の型定義
 */
export interface SummarizeResult {
  success: boolean;
  summary?: string;
  error?: string;
  retryCount?: number;
}

/**
 * 要約設定の型定義
 */
export interface SummarizerConfig {
  endpoint: string;
  apiKey: string;
  model: string;
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

/**
 * OpenAI APIを使用してコンテンツを要約
 * リトライ機能付き（指数バックオフで最大3回まで）
 */
export async function summarizeContent(
  title: string,
  url: string,
  content: string,
  config: SummarizerConfig,
): Promise<SummarizeResult> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`要約開始 (試行 ${attempt}/${maxRetries}): ${title}`);

    try {
      const client = new OpenAI({
        baseURL: config.endpoint,
        apiKey: config.apiKey,
      });

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "あなたは優秀な要約専門家です。与えられたWebページの内容を、以下の条件で要約してください：\n" +
              "- 3つの文に分けて要約する\n" +
              "- 全体で600文字以内に収める\n" +
              "- 各文は改行で区切る\n" +
              "- 重要なポイントを逃さず、読みやすく簡潔にまとめる",
          },
          {
            role: "user",
            content: `以下のWebページを要約してください：\n\nタイトル: ${title}\nURL: ${url}\n\n内容:\n${content}`,
          },
        ],
        stream: false,
      });

      const summary = response.choices[0]?.message?.content?.trim();

      if (!summary) {
        throw new Error("要約結果が空です");
      }

      console.log(`要約生成成功 (試行 ${attempt}): ${title}`);
      console.log(`生成された要約 (${summary.length}文字): ${summary}`);

      return {
        success: true,
        summary,
        retryCount: attempt,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
 * {title}
 * {url}
 *
 * {model_name}による要約
 *
 * {本文section1}
 *
 * {本文section2}
 *
 * {本文section3}
 */
export function formatSlackMessage(
  title: string,
  url: string,
  modelName: string,
  summary: string,
): string {
  // 要約を3つのセクションに分割
  const lines = summary.split("\n").filter((line) => line.trim() !== "");
  const section1 = lines[0] || "";
  const section2 = lines[1] || "";
  const section3 = lines[2] || "";

  return `${title}
${url}

${modelName}による要約

${section1}

${section2}

${section3}`;
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
  return `${title}
${url}

${modelName}による要約

要約生成に失敗しました: ${error}


`;
}
