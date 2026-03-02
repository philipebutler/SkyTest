export function buildChatCompletionsUrl(rawEndpoint: string): string {
  const endpoint = rawEndpoint.trim();

  try {
    const url = new URL(endpoint);
    const path = url.pathname.replace(/\/+$/, "");

    if (/\/chat\/completions$/i.test(path)) {
      url.pathname = path;
      return url.toString();
    }

    if (/\/completions$/i.test(path)) {
      url.pathname = path.replace(/\/completions$/i, "/chat/completions");
      return url.toString();
    }

    url.pathname = `${path}/chat/completions`.replace(/\/+/g, "/");
    return url.toString();
  } catch {
    const cleaned = endpoint.replace(/\/+$/, "");
    if (/\/chat\/completions$/i.test(cleaned)) return cleaned;
    if (/\/completions$/i.test(cleaned)) {
      return cleaned.replace(/\/completions$/i, "/chat/completions");
    }
    return `${cleaned}/chat/completions`;
  }
}
