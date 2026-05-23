#!/usr/bin/env node

import process from "node:process";
import { Defuddle } from "defuddle/node";

const SAMPLE_URLS = [
  "https://openai.com/ja-JP/index/inside-our-in-house-data-agent/",
  "https://speakerdeck.com/watany/agentic-coding-workshops-20260121",
  "https://www.anthropic.com/engineering/AI-resistant-technical-evaluations",
  "https://github.blog/security/ai-supported-vulnerability-triage-with-the-github-security-lab-taskflow-agent/",
];

const REQUEST_TIMEOUT_MS = 20_000;
const EXCERPT_LENGTH = 200;
const BLOCKED_STATUS_CODES = new Set([401, 403, 429]);
const BLOCKED_BODY_PATTERNS = [
  /access denied/i,
  /verify you are human/i,
  /captcha/i,
  /request blocked/i,
  /bot detection/i,
];
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const PARSER_BACKEND = "defuddle/node";
const DEFUDDLE_OPTIONS = {
  markdown: true,
  useAsync: false,
};

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getContentType(response) {
  return response.headers.get("content-type") ?? "";
}

function classifyFailedFetch(response, html) {
  const blockedByStatus = BLOCKED_STATUS_CODES.has(response.status);
  const blockedByBody = BLOCKED_BODY_PATTERNS.some((pattern) =>
    pattern.test(html.slice(0, 4000)),
  );

  return blockedByStatus || blockedByBody ? "access-blocked" : "fetch-failure";
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const html = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        url,
        finalUrl: response.url,
        status: response.status,
        statusText: response.statusText,
        contentType: getContentType(response),
        html,
        classification: classifyFailedFetch(response, html),
        reason: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    return {
      ok: true,
      url,
      finalUrl: response.url,
      status: response.status,
      statusText: response.statusText,
      contentType: getContentType(response),
      html,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      finalUrl: url,
      status: null,
      statusText: null,
      contentType: "",
      html: "",
      classification: "fetch-failure",
      reason: formatError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createValidationResult(fetchResult, overrides) {
  return {
    url: fetchResult.url,
    finalUrl: fetchResult.finalUrl,
    httpStatus: fetchResult.status,
    statusText: fetchResult.statusText,
    contentType: fetchResult.contentType,
    parserBackend: PARSER_BACKEND,
    ...overrides,
  };
}

async function parseWithDefuddle(html, url) {
  const parsed = await Defuddle(html, url, DEFUDDLE_OPTIONS);
  const content = parsed.content.trim();

  return {
    content,
    title: parsed.title || null,
  };
}

async function validateUrl(url) {
  const fetchResult = await fetchHtml(url);

  if (!fetchResult.ok) {
    return createValidationResult(fetchResult, {
      classification: fetchResult.classification,
      parsedTitle: null,
      extractedContentLength: 0,
      excerpt: null,
      failureReason: fetchResult.reason,
    });
  }

  try {
    const parsed = await parseWithDefuddle(
      fetchResult.html,
      fetchResult.finalUrl,
    );
    const content = parsed.content;
    const failureReason =
      content.length > 0 ? null : "Defuddle returned empty extracted content";

    return createValidationResult(fetchResult, {
      classification:
        failureReason === null ? "parse-success" : "parse-failure",
      parsedTitle: parsed.title,
      extractedContentLength: content.length,
      excerpt: content.slice(0, EXCERPT_LENGTH) || null,
      failureReason,
    });
  } catch (error) {
    return createValidationResult(fetchResult, {
      classification: "parse-failure",
      parsedTitle: null,
      extractedContentLength: 0,
      excerpt: null,
      failureReason: formatError(error),
    });
  }
}

function printResult(result) {
  console.log(`\n[${result.classification}] ${result.url}`);
  console.log(`  finalUrl: ${result.finalUrl}`);
  console.log(
    `  httpStatus: ${result.httpStatus ?? "n/a"}${result.statusText ? ` ${result.statusText}` : ""}`,
  );
  console.log(`  parserBackend: ${result.parserBackend}`);
  console.log(`  parsedTitle: ${result.parsedTitle ?? "-"}`);
  console.log(`  extractedContentLength: ${result.extractedContentLength}`);
  console.log(`  excerpt: ${result.excerpt ?? "-"}`);
  console.log(`  failureReason: ${result.failureReason ?? "-"}`);
}

function printSummary(results) {
  const summary = {};

  for (const result of results) {
    summary[result.classification] = (summary[result.classification] ?? 0) + 1;
  }

  const sortedSummary = Object.fromEntries(
    Object.entries(summary).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );

  console.log("\n=== Summary ===");
  console.log(`parserBackend: ${PARSER_BACKEND}`);
  console.log(JSON.stringify(sortedSummary, null, 2));
  console.log("\n=== Detailed Results ===");
  console.log(JSON.stringify(results, null, 2));
}

async function main() {
  const urls = process.argv.slice(2);
  const targets = urls.length > 0 ? urls : SAMPLE_URLS;

  console.log(`Validating defuddle against ${targets.length} URL(s)...`);

  const results = [];
  for (const url of targets) {
    const result = await validateUrl(url);
    results.push(result);
    printResult(result);
  }

  printSummary(results);
}

await main();
