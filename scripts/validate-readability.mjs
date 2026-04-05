#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const SAMPLE_URLS = [
  "https://openai.com/ja-JP/index/inside-our-in-house-data-agent/",
  "https://speakerdeck.com/watany/agentic-coding-workshops-20260121",
  "https://www.anthropic.com/engineering/AI-resistant-technical-evaluations",
  "https://github.blog/security/ai-supported-vulnerability-triage-with-the-github-security-lab-taskflow-agent/",
];

const REQUEST_TIMEOUT_MS = 20_000;
const CHAR_THRESHOLD = 100;
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

const NPM_EXEC_PARSER_SOURCE = `
import { extract, extractTextContent } from "@mizchi/readability";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const html = Buffer.concat(chunks).toString("utf8");
const url = process.env.READABILITY_TARGET_URL ?? "";
const extracted = extract(html, {
  url,
  charThreshold: ${CHAR_THRESHOLD},
});
const text = extracted.root
  ? extractTextContent(extracted.root).replace(/s+/g, " ").trim()
  : "";

process.stdout.write(JSON.stringify({
  title: extracted.metadata?.title ?? "",
  excerpt: text.slice(0, ${EXCERPT_LENGTH}),
  extractedTextLength: text.length,
  rootFound: Boolean(extracted.root),
  nodeCount: extracted.nodeCount ?? 0,
}));
`;

function toParsedResult(extracted, extractTextContent) {
  const text = extracted.root
    ? extractTextContent(extracted.root).replace(/\s+/g, " ").trim()
    : "";

  return {
    title: extracted.metadata?.title ?? "",
    excerpt: text.slice(0, EXCERPT_LENGTH),
    extractedTextLength: text.length,
    rootFound: Boolean(extracted.root),
    nodeCount: extracted.nodeCount ?? 0,
  };
}

async function loadParser() {
  try {
    const module = await import("@mizchi/readability");
    return {
      backend: "local-dependency",
      async parse(html, url) {
        const extracted = module.extract(html, {
          url,
          charThreshold: CHAR_THRESHOLD,
        });

        return toParsedResult(extracted, module.extractTextContent);
      },
    };
  } catch (error) {
    return {
      backend: "npm-exec-fallback",
      loadError: formatError(error),
      async parse(html, url) {
        const result = spawnSync(
          "npm",
          [
            "exec",
            "--yes",
            "--package",
            "@mizchi/readability",
            "--",
            "node",
            "--input-type=module",
            "-e",
            NPM_EXEC_PARSER_SOURCE,
          ],
          {
            input: html,
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
            env: {
              ...process.env,
              READABILITY_TARGET_URL: url,
            },
          },
        );

        if (result.error) {
          throw result.error;
        }

        if (result.status !== 0) {
          throw new Error(
            result.stderr.trim() ||
              result.stdout.trim() ||
              `npm exec failed with exit code ${result.status}`,
          );
        }

        return JSON.parse(result.stdout);
      },
    };
  }
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

function createValidationResult(fetchResult, parser, overrides) {
  return {
    url: fetchResult.url,
    finalUrl: fetchResult.finalUrl,
    httpStatus: fetchResult.status,
    statusText: fetchResult.statusText,
    contentType: fetchResult.contentType,
    parserBackend: parser.backend,
    ...overrides,
  };
}

function getParseFailureReason(parsed) {
  if (parsed.rootFound && parsed.extractedTextLength > 0) {
    return null;
  }

  if (parsed.rootFound) {
    return "Readability returned empty extracted text";
  }

  return "Readability did not find a main content root";
}

async function validateUrl(url, parser) {
  const fetchResult = await fetchHtml(url);

  if (!fetchResult.ok) {
    return createValidationResult(fetchResult, parser, {
      classification: fetchResult.classification,
      parsedTitle: null,
      extractedContentLength: 0,
      excerpt: null,
      failureReason: fetchResult.reason,
    });
  }

  try {
    const parsed = await parser.parse(fetchResult.html, fetchResult.finalUrl);
    const failureReason = getParseFailureReason(parsed);

    return createValidationResult(fetchResult, parser, {
      classification:
        failureReason === null ? "parse-success" : "parse-failure",
      parsedTitle: parsed.title || null,
      extractedContentLength: parsed.extractedTextLength,
      excerpt: parsed.excerpt || null,
      failureReason,
    });
  } catch (error) {
    return createValidationResult(fetchResult, parser, {
      classification: "parse-failure",
      parsedTitle: null,
      extractedContentLength: 0,
      excerpt: null,
      failureReason: formatError(error),
    });
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

function printSummary(results, parser) {
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
  console.log(`parserBackend: ${parser.backend}`);
  if (parser.loadError) {
    console.log(`localImportFallbackReason: ${parser.loadError}`);
  }
  console.log(JSON.stringify(sortedSummary, null, 2));
  console.log("\n=== Detailed Results ===");
  console.log(JSON.stringify(results, null, 2));
}

async function main() {
  const urls = process.argv.slice(2);
  const targets = urls.length > 0 ? urls : SAMPLE_URLS;
  const parser = await loadParser();

  console.log(
    `Validating @mizchi/readability against ${targets.length} URL(s)...`,
  );

  const results = [];
  for (const url of targets) {
    const result = await validateUrl(url, parser);
    results.push(result);
    printResult(result);
  }

  printSummary(results, parser);
}

await main();
