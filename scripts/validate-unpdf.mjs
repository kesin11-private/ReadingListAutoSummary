import { extractText, getDocumentProxy } from "unpdf";

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
    stack: undefined,
  };
}

const PDFS = [
  {
    name: "Google Prompt Engineering Whitepaper",
    url: "https://services.google.com/fh/files/misc/promptengineeringwhitepaper.pdf",
  },
  {
    name: "DeNA AI 100 Tips Slide",
    url: "https://fullswing.dena.com/pdf/AI_100tips_slide.pdf",
  },
];

async function fetchPdf(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.arrayBuffer();
}

async function validatePdf(pdfConfig) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📄 ${pdfConfig.name}`);
  console.log(`   URL: ${pdfConfig.url}`);
  console.log(`${"=".repeat(70)}`);

  try {
    console.log("   Downloading PDF...");
    const arrayBuffer = await fetchPdf(pdfConfig.url);
    console.log(
      `   Downloaded: ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB`,
    );

    // Use getDocumentProxy to avoid ArrayBuffer detachment issues
    // (passing raw ArrayBuffer to multiple functions detaches it)
    const docProxy = await getDocumentProxy(arrayBuffer);

    // Extract text (per-page)
    console.log("\n   --- Text Extraction (per-page) ---");
    const result = await extractText(docProxy);
    console.log(`   Total pages: ${result.totalPages}`);
    console.log(`   Text chunks (pages): ${result.text.length}`);

    // Combine all text for stats
    const fullText = result.text.join("\n");
    const totalChars = fullText.length;
    console.log(`   Total characters: ${totalChars.toLocaleString()}`);

    // Per-page stats
    for (const [i, pageText] of result.text.entries()) {
      console.log(
        `   Page ${i + 1}: ${pageText.length.toLocaleString()} chars`,
      );
    }

    // Show first 500 chars
    console.log("\n   --- First 500 Characters ---");
    const preview = fullText.slice(0, 500);
    console.log(
      preview
        .split("\n")
        .map((line) => `   | ${line}`)
        .join("\n"),
    );

    // Quality assessment
    console.log("\n   --- Quality Assessment ---");
    const nonWhitespaceChars = fullText.replace(/\s/g, "").length;
    const ratio = totalChars > 0 ? nonWhitespaceChars / totalChars : 0;
    console.log(
      `   Non-whitespace ratio: ${(ratio * 100).toFixed(1)}% (${nonWhitespaceChars.toLocaleString()} / ${totalChars.toLocaleString()})`,
    );

    // Check for common PDF extraction issues
    const hasCharFragments = /[a-z]\s[a-z]\s[a-z]\s[a-z]/.test(fullText);
    const avgWordLength =
      fullText.split(/\s+/).filter(Boolean).length > 0
        ? nonWhitespaceChars / fullText.split(/\s+/).filter(Boolean).length
        : 0;
    console.log(`   Average word length: ${avgWordLength.toFixed(1)}`);
    console.log(
      `   Character fragmentation detected: ${hasCharFragments ? "⚠️ YES" : "✅ No"}`,
    );
    console.log(
      `   Sufficient for summarization: ${nonWhitespaceChars > 100 ? "✅ Yes" : "❌ No (too little text)"}`,
    );

    return { success: true, totalChars, pages: result.totalPages };
  } catch (error) {
    const normalizedError = normalizeError(error);
    console.log(`\n   ❌ ERROR: ${normalizedError.message}`);
    if (normalizedError.stack) {
      console.log(
        `   Stack: ${normalizedError.stack.split("\n").slice(0, 3).join("\n         ")}`,
      );
    }
    return { success: false, error: normalizedError.message };
  }
}

console.log("🔍 unpdf Validation Script");

const results = [];
for (const pdf of PDFS) {
  const result = await validatePdf(pdf);
  results.push({ name: pdf.name, ...result });
}

console.log(`\n${"=".repeat(70)}`);
console.log("📊 Summary");
console.log(`${"=".repeat(70)}`);
for (const r of results) {
  if (r.success) {
    console.log(
      `   ✅ ${r.name}: ${r.pages} pages, ${r.totalChars.toLocaleString()} chars`,
    );
  } else {
    console.log(`   ❌ ${r.name}: ${r.error}`);
  }
}
