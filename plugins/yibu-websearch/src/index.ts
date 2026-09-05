import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import { createYibuWebFetchProvider, createYibuWebSearchProvider } from "./yibu-web.js";

const plugin = defineToolPlugin({
  id: "yibu-websearch",
  name: "Yibu Web Search",
  description: "Yibu Serper-compatible web search and Jina Reader providers for OpenClaw.",
  configSchema: Type.Object(
    {
      yibuFetchTimeoutSeconds: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 300, description: "Timeout for Yibu Jina Reader calls. Default: 120 seconds." }),
      ),
    },
    { additionalProperties: false },
  ),
  tools: () => [],
});

const registerTools = plugin.register;
plugin.register = (api) => {
  registerTools(api);
  api.registerWebSearchProvider(createYibuWebSearchProvider());
  api.registerWebFetchProvider(createYibuWebFetchProvider());
};

export default plugin;
