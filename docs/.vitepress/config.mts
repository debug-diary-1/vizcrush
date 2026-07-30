import { defineConfig } from "vitepress";

export default defineConfig({
  title: "vizcrush",
  description:
    "High-performance data primitives for browser visualization — downsampling, binning, spatial indexing, and streaming aggregation in Rust/WASM with a pure-JS fallback",
  base: "/vizcrush/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["**/ARCHITECTURE.md", "**/site/**"],

  head: [
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  ],

  themeConfig: {
    logo: undefined,
    siteTitle: "vizcrush",

    nav: [
      { text: "Guide", link: "/user-guide/getting-started" },
      { text: "Packages", link: "/packages/" },
      { text: "Reference", link: "/reference/algorithms" },
    ],

    sidebar: {
      "/user-guide/": [
        {
          text: "User Guide",
          items: [
            { text: "Getting Started", link: "/user-guide/getting-started" },
            { text: "Installation", link: "/user-guide/installation" },
            { text: "Quickstart", link: "/user-guide/quickstart" },
            {
              text: "Backends & Capabilities",
              link: "/user-guide/backends",
            },
            { text: "React Integration", link: "/user-guide/react" },
            {
              text: "MCP Server (Claude / Cursor)",
              link: "/user-guide/mcp",
            },
            { text: "Three.js Integration", link: "/user-guide/three-js" },
            { text: "Streaming Data", link: "/user-guide/streaming" },
            { text: "AI Features", link: "/user-guide/ai" },
          ],
        },
      ],

      "/packages/": [
        {
          text: "Packages",
          items: [
            { text: "Overview", link: "/packages/" },
            { text: "@vizcrush/core", link: "/packages/core" },
            { text: "@vizcrush/downsample", link: "/packages/downsample" },
            { text: "@vizcrush/aggregate", link: "/packages/aggregate" },
            { text: "@vizcrush/transform", link: "/packages/transform" },
            { text: "@vizcrush/bin", link: "/packages/bin" },
            { text: "@vizcrush/bin3d", link: "/packages/bin3d" },
            { text: "@vizcrush/spatial", link: "/packages/spatial" },
            { text: "@vizcrush/spatial3d", link: "/packages/spatial3d" },
            { text: "@vizcrush/ai", link: "/packages/ai" },
          ],
        },
      ],

      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Algorithms", link: "/reference/algorithms" },
            { text: "Examples Gallery", link: "/reference/examples" },
          ],
        },
      ],

      "/developer-guide/": [
        {
          text: "Developer Guide",
          items: [
            { text: "Architecture", link: "/developer-guide/architecture" },
            {
              text: "Building from Source",
              link: "/developer-guide/building",
            },
            { text: "Packages Layout", link: "/developer-guide/packages" },
            { text: "Contributing", link: "/developer-guide/contributing" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/pallavL01/vizcrush" }],

    editLink: {
      pattern: "https://github.com/pallavL01/vizcrush/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    search: {
      provider: "local",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2026 vizcrush contributors",
    },
  },
});
