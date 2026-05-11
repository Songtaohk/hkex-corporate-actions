export function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|td|th|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{2,}/g, "\n"),
  ).trim();
}

export function absoluteUrl(url: string, base: string) {
  try {
    return new URL(decodeHtml(url), base).toString();
  } catch {
    return base;
  }
}

export function extractLinks(html: string, base: string) {
  const links: Array<{ href: string; label: string; context: string }> = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html))) {
    const start = Math.max(0, match.index - 500);
    const end = Math.min(html.length, match.index + match[0].length + 500);
    links.push({
      href: absoluteUrl(match[1], base),
      label: htmlToText(match[2]),
      context: htmlToText(html.slice(start, end)),
    });
  }
  return links;
}
