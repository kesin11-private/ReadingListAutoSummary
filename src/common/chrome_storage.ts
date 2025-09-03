export interface Settings {
  daysUntilRead: number;
  daysUntilDelete: number;
  openaiEndpoint?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  slackWebhookUrl?: string;
  firecrawlApiKey?: string;
  systemPrompt?: string;
}

// デフォルトのシステムプロンプト
export const DEFAULT_SYSTEM_PROMPT =
  "テキストから本文を抜き出し、日本語で要約してください。\n" +
  "要約は技術的な内容に焦点を当て、 **3文に分けて** 600文字程度にしてください。\n\n" +
  "<format>\n\n" +
  "{section1}\n\n" +
  "{section2}\n\n" +
  "{section3}\n" +
  "</format>\n\n" +
  "<example>\n\n" +
  "macOSのコマンドラインツールが設定ファイルを~/Library/Application Supportに配置するのは不適切であり、ユーザーの期待やXDG Base Directory Specificationに反していると筆者は主張しています。\n\n" +
  "多くのCLIツールやdotfileマネージャーも~/.configをデフォルトとしており、~/Library/Application SupportはGUIアプリケーションがユーザーに代わって設定を管理する場合にのみ適していると結論付けています。\n\n" +
  "</example>";

// デフォルト設定
export const DEFAULT_SETTINGS: Settings = {
  daysUntilRead: 30,
  daysUntilDelete: 60,
};

/**
 * chrome.storage.localから設定を取得
 */
export async function getSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.local.get([
      "daysUntilRead",
      "daysUntilDelete",
      "openaiEndpoint",
      "openaiApiKey",
      "openaiModel",
      "slackWebhookUrl",
      "firecrawlApiKey",
      "systemPrompt",
    ]);

    return {
      daysUntilRead: result.daysUntilRead ?? DEFAULT_SETTINGS.daysUntilRead,
      daysUntilDelete:
        result.daysUntilDelete ?? DEFAULT_SETTINGS.daysUntilDelete,
      openaiEndpoint: result.openaiEndpoint,
      openaiApiKey: result.openaiApiKey,
      openaiModel: result.openaiModel,
      slackWebhookUrl: result.slackWebhookUrl,
      firecrawlApiKey: result.firecrawlApiKey,
      systemPrompt: result.systemPrompt,
    };
  } catch (error) {
    console.error("設定取得エラー:", error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * chrome.storage.localに設定を保存
 */
export async function saveSettings(settings: Settings): Promise<void> {
  try {
    const settingsToSave: Record<string, string | number> = {
      daysUntilRead: settings.daysUntilRead,
      daysUntilDelete: settings.daysUntilDelete,
    };

    // オプション項目は値が存在する場合のみ保存
    if (settings.openaiEndpoint) {
      settingsToSave.openaiEndpoint = settings.openaiEndpoint;
    }
    if (settings.openaiApiKey) {
      settingsToSave.openaiApiKey = settings.openaiApiKey;
    }
    if (settings.openaiModel) {
      settingsToSave.openaiModel = settings.openaiModel;
    }
    if (settings.slackWebhookUrl) {
      settingsToSave.slackWebhookUrl = settings.slackWebhookUrl;
    }
    if (settings.firecrawlApiKey) {
      settingsToSave.firecrawlApiKey = settings.firecrawlApiKey;
    }
    if (settings.systemPrompt !== undefined) {
      settingsToSave.systemPrompt = settings.systemPrompt;
    }

    await chrome.storage.local.set(settingsToSave);
  } catch (error) {
    console.error("設定保存エラー:", error);
    throw error;
  }
}

/**
 * 設定の妥当性チェック
 */
export function validateSettings(settings: Partial<Settings>): string[] {
  const errors: string[] = [];

  if (settings.daysUntilRead !== undefined) {
    if (
      !Number.isInteger(settings.daysUntilRead) ||
      settings.daysUntilRead < 1 ||
      settings.daysUntilRead > 365
    ) {
      errors.push("既読化までの日数は1-365の整数で入力してください");
    }
  }

  if (settings.daysUntilDelete !== undefined) {
    if (
      !Number.isInteger(settings.daysUntilDelete) ||
      settings.daysUntilDelete < 1 ||
      settings.daysUntilDelete > 365
    ) {
      errors.push("削除までの日数は1-365の整数で入力してください");
    }
  }

  if (
    settings.daysUntilRead !== undefined &&
    settings.daysUntilDelete !== undefined
  ) {
    if (settings.daysUntilRead >= settings.daysUntilDelete) {
      errors.push("削除までの日数は既読化までの日数より大きくしてください");
    }
  }

  if (
    settings.openaiEndpoint !== undefined &&
    settings.openaiEndpoint.trim() !== ""
  ) {
    try {
      new URL(settings.openaiEndpoint);
    } catch {
      errors.push("OpenAI APIエンドポイントは有効なURLで入力してください");
    }
  }

  if (
    settings.slackWebhookUrl !== undefined &&
    settings.slackWebhookUrl.trim() !== ""
  ) {
    try {
      const url = new URL(settings.slackWebhookUrl);
      if (!url.hostname.includes("hooks.slack.com")) {
        errors.push("Slack Webhook URLはSlackの正しいURLで入力してください");
      }
    } catch {
      errors.push("Slack Webhook URLは有効なURLで入力してください");
    }
  }

  return errors;
}
