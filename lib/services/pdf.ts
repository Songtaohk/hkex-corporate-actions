import { PDFParse } from "pdf-parse";

export async function extractPdfTextFromUrl(url: string, firstPages = 12) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HKEX Corporate Actions Dashboard)",
        accept: "application/pdf,*/*",
      },
    });

    if (!response.ok) {
      throw new Error(`PDF fetch failed with ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const parser = new PDFParse({ data: Buffer.from(arrayBuffer) });
    try {
      const result = await parser.getText({ first: firstPages });
      return result.text.replace(/\s+/g, " ").trim();
    } finally {
      await parser.destroy();
    }
  } finally {
    clearTimeout(timeout);
  }
}
