export const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";

export const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

export const CONTENT_EXTRACTOR_PROVIDERS = ["tavily", "firecrawl"] as const;

export type ContentExtractorProvider =
  (typeof CONTENT_EXTRACTOR_PROVIDERS)[number];

export const DEFAULT_CONTENT_EXTRACTOR_PROVIDER: ContentExtractorProvider =
  "tavily";
