import { describe, expect, it } from "vitest";

import plugin from "./index.js";
import {
  assertPublicHttpUrl,
  createYibuWebFetchProvider,
  createYibuWebSearchProvider,
  parseYibuReadPayload,
  parseYibuSearchPayload,
} from "./yibu-web.js";

describe("Yibu web providers", () => {
  it("registers search and fetch providers without tools or hooks", () => {
    const searchIds: string[] = [];
    const fetchIds: string[] = [];
    plugin.register({
      registerWebSearchProvider(provider: { id: string }) { searchIds.push(provider.id); },
      registerWebFetchProvider(provider: { id: string }) { fetchIds.push(provider.id); },
    } as never);
    expect(searchIds).toEqual(["yibu"]);
    expect(fetchIds).toEqual(["yibu"]);
  });

  it("declares the shared Yibu credential path", () => {
    expect(createYibuWebSearchProvider()).toMatchObject({ id: "yibu", credentialPath: "tools.web.search.yibu.apiKey" });
    expect(createYibuWebFetchProvider()).toMatchObject({ id: "yibu", credentialPath: "tools.web.search.yibu.apiKey" });
  });

  it("normalizes Serper organic results", () => {
    expect(parseYibuSearchPayload({
      organic: [{ title: "Hong Kong MTR", link: "https://www.mtr.com.hk/", snippet: "Rail information", date: "2026-09-01" }],
    })).toEqual([{
      title: "Hong Kong MTR",
      url: "https://www.mtr.com.hk/",
      description: "Rail information",
      published: "2026-09-01",
      siteName: "mtr.com.hk",
    }]);
  });

  it("normalizes Jina Reader responses", () => {
    expect(parseYibuReadPayload(
      { code: 200, data: { title: "Example", url: "https://example.com/final", content: "# Page" } },
      "https://example.com/start",
    )).toEqual({
      url: "https://example.com/start",
      finalUrl: "https://example.com/final",
      title: "Example",
      content: "# Page",
      status: 200,
    });
  });

  it("blocks local Reader targets", () => {
    expect(() => assertPublicHttpUrl("http://127.0.0.1/private")).toThrow("blocks local");
    expect(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).toThrow("blocks local");
    expect(assertPublicHttpUrl("https://example.com/article")).toBe("https://example.com/article");
  });
});
