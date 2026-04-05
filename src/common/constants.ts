export const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

export const CONTENT_EXTRACTOR_PROVIDERS = [
  "local-with-tavily-fallback",
  "tavily",
] as const;

export type ContentExtractorProvider =
  (typeof CONTENT_EXTRACTOR_PROVIDERS)[number];

export const CONTENT_EXTRACTOR_PROVIDER_LABELS: Record<
  ContentExtractorProvider,
  string
> = {
  "local-with-tavily-fallback": "ローカル + Tavilyフォールバック",
  tavily: "Tavily",
};

export const CONTENT_EXTRACTOR_PROVIDER_DESCRIPTIONS: Record<
  ContentExtractorProvider,
  string
> = {
  "local-with-tavily-fallback":
    "拡張機能内でHTMLを取得して本文を抽出し、失敗時のみ Tavily Extract API にフォールバックします。Tavily API キーは任意です。",
  tavily:
    "ローカル抽出は行わず、最初から Tavily Extract API で本文を抽出します。Tavily API キーが必須です。",
};

export const DEFAULT_CONTENT_EXTRACTOR_PROVIDER: ContentExtractorProvider =
  "local-with-tavily-fallback";
