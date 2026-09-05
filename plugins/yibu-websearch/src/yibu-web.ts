import { isIP } from "node:net";

import { Type } from "typebox";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { WebFetchProviderPlugin } from "openclaw/plugin-sdk/provider-web-fetch";
import {
  getScopedCredentialValue,
  postTrustedWebToolsJson,
  resolveWebSearchProviderCredential,
  setScopedCredentialValue,
  wrapWebContent,
  type WebSearchProviderPlugin,
} from "openclaw/plugin-sdk/provider-web-search";
import {
  markdownToText,
  truncateText,
  wrapExternalContent,
} from "openclaw/plugin-sdk/provider-web-fetch";

const YIBU_PROVIDER_ID = "yibu";
const YIBU_ENV_VARS = ["YIBU_KEY"];
const YIBU_CREDENTIAL_PATH = "tools.web.search.yibu.apiKey";
const YIBU_SEARCH_URL = "https://yibuapi.com/serper/search";
const YIBU_READ_URL = "https://yibuapi.com/jina_reader/read/";
const DEFAULT_SEARCH_COUNT = 5;
const DEFAULT_SEARCH_TIMEOUT_SECONDS = 30;
const DEFAULT_FETCH_TIMEOUT_SECONDS = 120;
const DEFAULT_FETCH_MAX_CHARS = 50_000;

type UnknownRecord = Record<string, unknown>;

export type YibuSearchItem = {
  title: string;
  url: string;
  description?: string;
  published?: string;
  siteName?: string;
};

export type YibuReadResult = {
  url: string;
  finalUrl: string;
  title?: string;
  content: string;
  status?: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pluginConfig(config?: OpenClawConfig): UnknownRecord | undefined {
  const value = config?.plugins?.entries?.["yibu-websearch"]?.config;
  return isRecord(value) ? value : undefined;
}

function yibuSearchConfig(config?: OpenClawConfig): UnknownRecord | undefined {
  const search = config?.tools?.web?.search;
  if (!isRecord(search)) return undefined;
  const value = search[YIBU_PROVIDER_ID];
  return isRecord(value) ? value : undefined;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function searchTimeoutSeconds(config?: OpenClawConfig): number {
  return positiveNumber(yibuSearchConfig(config)?.timeoutSeconds, DEFAULT_SEARCH_TIMEOUT_SECONDS);
}

function fetchTimeoutSeconds(config?: OpenClawConfig): number {
  return positiveNumber(pluginConfig(config)?.yibuFetchTimeoutSeconds, DEFAULT_FETCH_TIMEOUT_SECONDS);
}

function resolveApiKey(config?: OpenClawConfig, searchConfig?: UnknownRecord): string | undefined {
  const source = searchConfig ?? (isRecord(config?.tools?.web?.search) ? config.tools.web.search : undefined);
  return resolveWebSearchProviderCredential({
    credentialValue: getScopedCredentialValue(source, YIBU_PROVIDER_ID),
    path: YIBU_CREDENTIAL_PATH,
    envVars: YIBU_ENV_VARS,
  });
}

function requiredApiKey(config?: OpenClawConfig, searchConfig?: UnknownRecord): string {
  const apiKey = resolveApiKey(config, searchConfig);
  if (!apiKey) {
    throw new Error(
      "Yibu web tools need an API key. Configure tools.web.search.yibu.apiKey or set YIBU_KEY in the Gateway environment.",
    );
  }
  return apiKey;
}

function siteName(urlRaw: string): string | undefined {
  try {
    return new URL(urlRaw).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

function stringValue(record: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function parseYibuSearchPayload(payload: unknown): YibuSearchItem[] {
  if (!isRecord(payload)) throw new Error("Yibu Search returned a malformed JSON response.");
  if (!Array.isArray(payload.organic)) return [];

  const results: YibuSearchItem[] = [];
  for (const candidate of payload.organic) {
    if (!isRecord(candidate)) continue;
    const url = stringValue(candidate, "link", "url");
    if (!url) continue;
    const title = stringValue(candidate, "title") ?? siteName(url) ?? url;
    const description = stringValue(candidate, "snippet", "description");
    const published = stringValue(candidate, "date", "published", "publishedDate");
    results.push({
      title,
      url,
      ...(description ? { description } : {}),
      ...(published ? { published } : {}),
      ...(siteName(url) ? { siteName: siteName(url) } : {}),
    });
  }
  return results;
}

function privateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function privateIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(host)) return true;
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice("::ffff:".length);
    return isIP(mapped) === 4 ? privateIpv4(mapped) : true;
  }
  return false;
}

export function assertPublicHttpUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("web_fetch requires a URL.");
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("web_fetch requires a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("web_fetch only supports HTTP(S) URLs.");
  }
  if (parsed.username || parsed.password) throw new Error("web_fetch URLs must not contain credentials.");

  const hostname = parsed.hostname.toLowerCase();
  const ipVersion = isIP(hostname.replace(/^\[|\]$/g, ""));
  const blockedName =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal");
  if (blockedName || (ipVersion === 4 && privateIpv4(hostname)) || (ipVersion === 6 && privateIpv6(hostname))) {
    throw new Error("web_fetch blocks local, private, and internal targets.");
  }
  return parsed.toString();
}

export function parseYibuReadPayload(payload: unknown, requestedUrl: string): YibuReadResult {
  if (!isRecord(payload)) throw new Error("Yibu Reader returned a malformed JSON response.");
  const data = isRecord(payload.data) ? payload.data : payload;
  const content = stringValue(data, "content", "markdown", "text");
  if (!content) throw new Error("Yibu Reader returned no page content.");
  const finalUrl = stringValue(data, "url", "finalUrl") ?? requestedUrl;
  const title = stringValue(data, "title");
  const rawStatus = typeof payload.code === "number" ? payload.code : payload.status;
  const status = typeof rawStatus === "number" && Number.isFinite(rawStatus) ? rawStatus : undefined;
  return { url: requestedUrl, finalUrl, ...(title ? { title } : {}), content, ...(status ? { status } : {}) };
}

const yibuCredentialFields = {
  credentialPath: YIBU_CREDENTIAL_PATH,
  inactiveSecretPaths: [YIBU_CREDENTIAL_PATH],
  getCredentialValue: (searchConfig?: UnknownRecord) => getScopedCredentialValue(searchConfig, YIBU_PROVIDER_ID),
  setCredentialValue: (searchConfigTarget: UnknownRecord, value: unknown) =>
    setScopedCredentialValue(searchConfigTarget, YIBU_PROVIDER_ID, value),
  getConfiguredCredentialValue: (config?: OpenClawConfig) =>
    getScopedCredentialValue(isRecord(config?.tools?.web?.search) ? config.tools.web.search : undefined, YIBU_PROVIDER_ID),
};

const searchSchema = Type.Object(
  {
    query: Type.String({ description: "Search query string." }),
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Number of results to return (1-10)." })),
    country: Type.Optional(Type.String({ description: "Two-letter country code such as hk, cn, or us." })),
    search_lang: Type.Optional(Type.String({ description: "Search language such as zh-cn, zh-tw, or en." })),
    freshness: Type.Optional(
      Type.Union(
        [Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")],
        { description: "Optional recency filter." },
      ),
    ),
  },
  { additionalProperties: false },
);

const freshnessMap: Record<string, string> = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" };

export function createYibuWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: YIBU_PROVIDER_ID,
    label: "Yibu Search",
    hint: "Serper-compatible structured Google results",
    requiresCredential: true,
    credentialLabel: "Yibu API key",
    envVars: YIBU_ENV_VARS,
    placeholder: "sk-...",
    signupUrl: "https://yibuapi.com/",
    docsUrl: "https://yibuapi.com/",
    autoDetectOrder: 20,
    ...yibuCredentialFields,
    createTool: (ctx) => ({
      description: "Search the web through Yibu's Serper-compatible endpoint and return structured results with snippets.",
      parameters: searchSchema,
      execute: async (args, executionContext) => {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) throw new Error("web_search requires a non-empty query.");
        const count = typeof args.count === "number" && Number.isFinite(args.count)
          ? Math.max(1, Math.min(10, Math.floor(args.count)))
          : DEFAULT_SEARCH_COUNT;
        const country = typeof args.country === "string" ? args.country.trim().toLowerCase() : "";
        const language = typeof args.search_lang === "string" ? args.search_lang.trim().toLowerCase() : "";
        const freshness = typeof args.freshness === "string" ? freshnessMap[args.freshness] : undefined;
        const body: UnknownRecord = { q: query, num: count };
        if (country) body.gl = country;
        if (language) body.hl = language;
        if (freshness) body.tbs = freshness;

        const startedAt = Date.now();
        const payload = await postTrustedWebToolsJson<unknown>(
          {
            url: YIBU_SEARCH_URL,
            timeoutSeconds: searchTimeoutSeconds(ctx.config),
            apiKey: requiredApiKey(ctx.config, ctx.searchConfig),
            body,
            errorLabel: "Yibu Search",
            signal: executionContext?.signal,
          },
          async (response) => response.json(),
        );
        const items = parseYibuSearchPayload(payload).slice(0, count);
        return {
          query,
          provider: YIBU_PROVIDER_ID,
          count: items.length,
          tookMs: Date.now() - startedAt,
          externalContent: { untrusted: true, source: "web_search", provider: YIBU_PROVIDER_ID, wrapped: true },
          results: items.map((item) => ({
            title: wrapWebContent(item.title, "web_search"),
            url: item.url,
            ...(item.description ? { description: wrapWebContent(item.description, "web_search") } : {}),
            ...(item.published ? { published: item.published } : {}),
            ...(item.siteName ? { siteName: item.siteName } : {}),
          })),
        };
      },
    }),
  };
}

export function createYibuWebFetchProvider(): WebFetchProviderPlugin {
  return {
    id: YIBU_PROVIDER_ID,
    label: "Yibu Reader",
    hint: "Rendered page extraction through Yibu Jina Reader",
    requiresCredential: true,
    credentialLabel: "Yibu API key",
    envVars: YIBU_ENV_VARS,
    placeholder: "sk-...",
    signupUrl: "https://yibuapi.com/",
    docsUrl: "https://yibuapi.com/",
    autoDetectOrder: 20,
    ...yibuCredentialFields,
    createTool: (ctx) => ({
      description: "Fetch and extract a public web page through Yibu Jina Reader.",
      parameters: {},
      execute: async (args) => {
        const url = assertPublicHttpUrl(args.url);
        const extractMode = args.extractMode === "text" ? "text" : "markdown";
        const maxChars = typeof args.maxChars === "number" && Number.isFinite(args.maxChars) && args.maxChars > 0
          ? Math.min(DEFAULT_FETCH_MAX_CHARS, Math.floor(args.maxChars))
          : DEFAULT_FETCH_MAX_CHARS;
        const payload = await postTrustedWebToolsJson<unknown>(
          {
            url: YIBU_READ_URL,
            timeoutSeconds: fetchTimeoutSeconds(ctx.config),
            apiKey: requiredApiKey(ctx.config),
            body: { url },
            errorLabel: "Yibu Reader",
          },
          async (response) => response.json(),
        );
        const parsed = parseYibuReadPayload(payload, url);
        const rawText = extractMode === "text" ? markdownToText(parsed.content) : parsed.content;
        const truncated = truncateText(rawText, maxChars);
        const wrappedText = wrapExternalContent(truncated.text, { source: "web_fetch", includeWarning: false });
        return {
          url,
          finalUrl: parsed.finalUrl,
          ...(parsed.status ? { status: parsed.status } : {}),
          ...(parsed.title
            ? { title: wrapExternalContent(parsed.title, { source: "web_fetch", includeWarning: false }) }
            : {}),
          extractor: "yibu-jina-reader",
          extractMode,
          externalContent: { untrusted: true, source: "web_fetch", wrapped: true },
          truncated: truncated.truncated,
          rawLength: rawText.length,
          wrappedLength: wrappedText.length,
          text: wrappedText,
        };
      },
    }),
  };
}
