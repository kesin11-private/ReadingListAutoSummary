#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { readable } from "@mizchi/readability";
import { Defuddle } from "defuddle/node";
import { JSDOM } from "jsdom";

const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const DEFAULT_OUTPUT_DIR = path.join(
  os.tmpdir(),
  "reading-list-auto-summary",
  "extractor-comparisons",
  new Date().toISOString().replaceAll(":", "-"),
);

function printUsage() {
  console.log(`Usage:
  node scripts/compare-extractors.mjs [--output-dir <dir>] <url> [url...]

Examples:
  node scripts/compare-extractors.mjs https://example.com/article
  pnpm compare:extractors -- --output-dir ./tmp/compare https://example.com/a https://example.com/b`);
}

function parseArguments(argv) {
  let outputDir = DEFAULT_OUTPUT_DIR;
  const urls = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      printUsage();
      process.exit(0);
    }

    if (argument === "--output-dir") {
      const nextArgument = argv[index + 1];
      if (!nextArgument) {
        throw new Error(
          "--output-dir には保存先ディレクトリを指定してください。",
        );
      }
      outputDir = path.resolve(nextArgument);
      index += 1;
      continue;
    }

    if (argument.startsWith("--output-dir=")) {
      outputDir = path.resolve(argument.slice("--output-dir=".length));
      continue;
    }

    urls.push(argument);
  }

  if (urls.length === 0) {
    throw new Error("比較対象の URL を少なくとも 1 つ指定してください。");
  }

  return {
    outputDir,
    urls,
  };
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildTargetDirectoryName(url, index) {
  return `${String(index + 1).padStart(2, "0")}-${slugify(url) || "target"}`;
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
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    if (!html.trim()) {
      throw new Error("取得した HTML が空でした。");
    }

    return {
      html,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractWithReadability(html, url) {
  const result = readable(html, {
    url,
    charThreshold: 20,
  });
  const content = result.toMarkdown().trim();
  if (!content) {
    throw new Error("readability の抽出結果が空でした。");
  }

  return {
    title: result.snapshot.metadata.title?.trim() ?? "",
    content,
    metadata: {
      pageType: result.pageType === "article" ? "article" : "other",
    },
  };
}

async function extractWithDefuddle(html, url) {
  const dom = new JSDOM(html, { url });
  try {
    const result = await Defuddle(dom.window.document, url, {
      markdown: true,
      useAsync: false,
    });
    const content = result.content?.trim() ?? "";
    if (!content) {
      throw new Error("defuddle の抽出結果が空でした。");
    }

    return {
      title: result.title?.trim() ?? "",
      content,
      metadata: {
        author: result.author ?? "",
        wordCount: result.wordCount ?? 0,
        domain: result.domain ?? "",
        language: result.language ?? "",
      },
    };
  } finally {
    dom.window.close();
  }
}

function buildReport({
  extractor,
  url,
  finalUrl,
  contentType,
  title,
  metadata,
  content,
}) {
  const lines = [
    `Extractor: ${extractor}`,
    `Requested URL: ${url}`,
    `Final URL: ${finalUrl}`,
    `Content-Type: ${contentType || "(unknown)"}`,
    `Title: ${title || "(none)"}`,
  ];

  for (const [key, value] of Object.entries(metadata)) {
    lines.push(`${key}: ${String(value || "(none)")}`);
  }

  lines.push("", "--- Markdown ---", "", content);
  return `${lines.join("\n")}\n`;
}

function buildFailureReport({ extractor, url, finalUrl, contentType, error }) {
  return [
    `Extractor: ${extractor}`,
    `Requested URL: ${url}`,
    `Final URL: ${finalUrl}`,
    `Content-Type: ${contentType || "(unknown)"}`,
    `Error: ${error}`,
    "",
  ].join("\n");
}

async function processUrl(url, outputDir, index) {
  const extractorTasks = [
    {
      name: "readability",
      fileName: "readability.txt",
      run: (fetchResult) =>
        extractWithReadability(fetchResult.html, fetchResult.finalUrl),
    },
    {
      name: "defuddle",
      fileName: "defuddle.txt",
      run: (fetchResult) =>
        extractWithDefuddle(fetchResult.html, fetchResult.finalUrl),
    },
  ];

  let fetchResult;
  let targetDirectory = path.join(
    outputDir,
    buildTargetDirectoryName(url, index),
  );

  try {
    fetchResult = await fetchHtml(url);
    targetDirectory = path.join(
      outputDir,
      buildTargetDirectoryName(fetchResult.finalUrl, index),
    );
  } catch (error) {
    const message = normalizeError(error);
    await mkdir(targetDirectory, { recursive: true });

    const results = await Promise.all(
      extractorTasks.map(async (extractor) => {
        const filePath = path.join(targetDirectory, extractor.fileName);
        await writeFile(
          filePath,
          buildFailureReport({
            extractor: extractor.name,
            url,
            finalUrl: url,
            contentType: "",
            error: `HTML の取得に失敗しました: ${message}`,
          }),
          "utf8",
        );

        return {
          extractor: extractor.name,
          ok: false,
          filePath,
          error: `HTML の取得に失敗しました: ${message}`,
        };
      }),
    );

    return {
      requestedUrl: url,
      finalUrl: url,
      targetDirectory,
      results,
      fetchFailed: true,
    };
  }

  await mkdir(targetDirectory, { recursive: true });

  const results = await Promise.all(
    extractorTasks.map(async (extractor) => {
      try {
        const result = await extractor.run(fetchResult);
        const filePath = path.join(targetDirectory, extractor.fileName);
        await writeFile(
          filePath,
          buildReport({
            extractor: extractor.name,
            url,
            finalUrl: fetchResult.finalUrl,
            contentType: fetchResult.contentType,
            title: result.title,
            metadata: result.metadata,
            content: result.content,
          }),
          "utf8",
        );

        return {
          extractor: extractor.name,
          ok: true,
          filePath,
          length: result.content.length,
        };
      } catch (error) {
        const filePath = path.join(targetDirectory, extractor.fileName);
        await writeFile(
          filePath,
          buildFailureReport({
            extractor: extractor.name,
            url,
            finalUrl: fetchResult.finalUrl,
            contentType: fetchResult.contentType,
            error: normalizeError(error),
          }),
          "utf8",
        );

        return {
          extractor: extractor.name,
          ok: false,
          filePath,
          error: normalizeError(error),
        };
      }
    }),
  );

  return {
    requestedUrl: url,
    finalUrl: fetchResult.finalUrl,
    targetDirectory,
    results,
    fetchFailed: false,
  };
}

async function main() {
  const { outputDir, urls } = parseArguments(process.argv.slice(2));
  await mkdir(outputDir, { recursive: true });

  console.log(`出力先: ${outputDir}`);

  const summaries = [];
  for (const [index, url] of urls.entries()) {
    console.log(`\n=== ${index + 1}/${urls.length}: ${url}`);
    const summary = await processUrl(url, outputDir, index);
    summaries.push(summary);
    console.log(`保存先: ${summary.targetDirectory}`);
    for (const result of summary.results) {
      if (result.ok) {
        console.log(
          `  ✅ ${result.extractor}: ${result.filePath} (${result.length.toLocaleString()} chars)`,
        );
      } else {
        console.log(
          `  ❌ ${result.extractor}: ${result.filePath} (${result.error})`,
        );
      }
    }
    if (summary.fetchFailed) {
      process.exitCode = 1;
    }
  }

  if (summaries.length > 0) {
    console.log("\n=== Summary ===");
    for (const summary of summaries) {
      console.log(`${summary.requestedUrl}`);
      console.log(`  Final URL: ${summary.finalUrl}`);
      console.log(`  Directory: ${summary.targetDirectory}`);
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(normalizeError(error));
  printUsage();
  process.exit(1);
}
