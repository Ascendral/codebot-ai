import { Tool } from '../types';

export class WebFetchTool implements Tool {
  name = 'web_fetch';
  description = 'Make HTTP requests to URLs or APIs. Fetch web pages, call REST APIs, post data. Supports GET, POST, PUT, PATCH, DELETE.';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      method: { type: 'string', description: 'HTTP method (default: GET)', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      headers: { type: 'object', description: 'Request headers as key-value pairs' },
      body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
      json: { type: 'object', description: 'JSON body (auto-sets Content-Type)' },
    },
    required: ['url'],
  };

  private validateUrl(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'Invalid URL';
    }

    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `Blocked protocol: ${parsed.protocol} — only http/https allowed`;
    }

    // Block requests to private/internal IPs
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
      return 'Blocked: requests to localhost are not allowed';
    }

    // Block cloud metadata endpoints
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
      return 'Blocked: requests to cloud metadata endpoints are not allowed';
    }

    // Block private IP ranges (10.x, 172.16-31.x, 192.168.x)
    const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      if (a === 10) return 'Blocked: private IP range (10.x.x.x)';
      if (a === 172 && b >= 16 && b <= 31) return 'Blocked: private IP range (172.16-31.x.x)';
      if (a === 192 && b === 168) return 'Blocked: private IP range (192.168.x.x)';
      if (a === 0) return 'Blocked: invalid IP (0.x.x.x)';
    }

    return null; // URL is safe
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = args.url as string;
    if (!url) return 'Error: url is required';
    const method = (args.method as string) || 'GET';

    const urlError = this.validateUrl(url);
    if (urlError) return `Error: ${urlError}`;
    const headers: Record<string, string> = (args.headers as Record<string, string>) || {};

    let body: string | undefined;
    if (args.json) {
      body = JSON.stringify(args.json);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    } else if (args.body) {
      body = args.body as string;
    }

    try {
      // AbortController covers both connection AND body reading (res.text())
      const controller = new AbortController();
      const bodyTimeout = setTimeout(() => controller.abort(), 30_000);

      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      let responseText: string;
      try {
        responseText = await res.text();
      } finally {
        clearTimeout(bodyTimeout);
      }

      // Truncate very large responses
      const maxLen = 50000;
      const truncated = responseText.length > maxLen
        ? responseText.substring(0, maxLen) + `\n\n... (truncated, ${responseText.length} total chars)`
        : responseText;

      const statusLine = `HTTP ${res.status} ${res.statusText}`;

      // For HTML, strip tags to get readable text
      if (contentType.includes('text/html')) {
        const text = this.htmlToText(truncated);
        return `${statusLine}\n\n${text}`;
      }

      return `${statusLine}\n\n${truncated}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: ${msg}`;
    }
  }

  private htmlToText(html: string): string {
    return html
      // Remove script/style blocks
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // Convert common block elements to newlines
      .replace(/<\/?(div|p|br|h[1-6]|li|tr|blockquote|pre|section|article|header|footer|nav|main)[^>]*>/gi, '\n')
      // Remove all remaining tags
      .replace(/<[^>]+>/g, '')
      // Decode common entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Clean up whitespace
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }
}
