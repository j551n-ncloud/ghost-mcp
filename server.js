#!/usr/bin/env node
// Ghost MCP server (stdio): search and read posts, create and edit drafts.
// Publishing, scheduling and deleting are deliberately not exposed; that stays a manual step in Ghost admin.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { marked } from "marked";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient, buildFilter } from "./lib.js";

const URL_ = process.env.GHOST_URL;
const ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
if (!URL_ || !ADMIN_KEY) {
  console.error("Set GHOST_URL (e.g. https://blog.example.com or http://10.0.0.5:2368) and GHOST_ADMIN_KEY");
  console.error("(Ghost admin > Settings > Integrations > custom integration)");
  process.exit(1);
}
// Public host name of the blog. Defaults to the host of GHOST_URL; set it when GHOST_URL is an internal address.
const HOST = process.env.GHOST_HOST ?? new URL(URL_).hostname;

const ghost = createClient({
  url: URL_,
  host: HOST,
  adminKey: ADMIN_KEY,
});

const editorUrl = (id) => `https://${HOST}/ghost/#/editor/post/${id}`;
const summary = (p) => ({
  id: p.id,
  title: p.title,
  slug: p.slug,
  status: p.status,
  url: p.status === "published" ? p.url : undefined,
  editor: editorUrl(p.id),
  published_at: p.published_at,
  feature_image: p.feature_image ?? undefined,
  updated_at: p.updated_at,
  tags: p.tags?.map((t) => t.name),
  excerpt: p.custom_excerpt ?? undefined,
});
const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ content: [{ type: "text", text: String(err.message ?? err) }], isError: true });
const tool = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

const server = new McpServer({ name: "ghost", version: "0.1.0" });

server.registerTool(
  "search_posts",
  {
    title: "Search posts",
    description: "List blog posts, newest change first. Optional filters: title contains text, status, tag slug.",
    inputSchema: {
      query: z.string().optional().describe("Text the post title must contain"),
      status: z.enum(["all", "published", "draft", "scheduled"]).default("all"),
      tag: z.string().optional().describe("Tag slug, see list_tags"),
      limit: z.number().int().min(1).max(50).default(15),
    },
  },
  tool(async ({ query, status, tag, limit }) => {
    const qs = new URLSearchParams({ limit: String(limit), include: "tags", order: "updated_at desc" });
    const filter = buildFilter({ query, status, tag });
    if (filter) qs.set("filter", filter);
    const res = await ghost.get(`posts/?${qs}`);
    return { total: res.meta?.pagination?.total, posts: res.posts.map(summary) };
  }),
);

server.registerTool(
  "get_post",
  {
    title: "Get post",
    description: "Read one post (any status) by id or slug, including its HTML content.",
    inputSchema: {
      id: z.string().optional(),
      slug: z.string().optional(),
    },
  },
  tool(async ({ id, slug }) => {
    if (!id && !slug) throw new Error("Pass id or slug");
    const path = id ? `posts/${encodeURIComponent(id)}/` : `posts/slug/${encodeURIComponent(slug)}/`;
    const { posts: [p] } = await ghost.get(`${path}?formats=html&include=tags`);
    return { ...summary(p), feature_image: p.feature_image, html: p.html };
  }),
);

server.registerTool(
  "list_tags",
  {
    title: "List tags",
    description: "All tags with slug and number of posts.",
    inputSchema: {},
  },
  tool(async () => {
    const res = await ghost.get("tags/?limit=all&include=count.posts&order=name%20asc");
    return res.tags.map((t) => ({ name: t.name, slug: t.slug, posts: t.count?.posts }));
  }),
);

const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

server.registerTool(
  "upload_image",
  {
    title: "Upload image",
    description: "Upload a local image file to Ghost and return its URL, to use in a draft as ![alt](url).",
    inputSchema: {
      file: z.string().describe("Absolute path to a local png, jpg, gif, webp or svg file"),
    },
  },
  tool(async ({ file }) => {
    const mime = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`Unsupported image type: ${path.extname(file) || "no extension"}`);
    const data = await fs.readFile(file);
    const { images: [img] } = await ghost.upload("images/upload/", path.basename(file), data, mime);
    return { url: img.url };
  }),
);

const draftFields = {
  title: z.string().min(1),
  markdown: z.string().describe("Post body in Markdown, converted to HTML for Ghost"),
  tags: z.array(z.string()).optional().describe("Tag names; unknown tags are created"),
  excerpt: z.string().max(300).optional().describe("Custom excerpt shown in lists and previews"),
  feature_image: z.string().url().optional().describe("Cover image URL, e.g. from upload_image"),
};

server.registerTool(
  "create_draft",
  {
    title: "Create draft",
    description: "Create a new post as a draft. It is never published; review and publish it in Ghost admin.",
    inputSchema: draftFields,
  },
  tool(async ({ title, markdown, tags, excerpt, feature_image }) => {
    const post = {
      title,
      ...(feature_image && { feature_image }),
      html: await marked.parse(markdown),
      status: "draft",
      ...(tags && { tags: tags.map((name) => ({ name })) }),
      ...(excerpt !== undefined && { custom_excerpt: excerpt }),
    };
    const { posts: [p] } = await ghost.post("posts/?source=html&include=tags", { posts: [post] });
    return summary(p);
  }),
);

server.registerTool(
  "update_draft",
  {
    title: "Update draft",
    description: "Change a draft's title, body, tags or excerpt. Refuses published or scheduled posts, and never changes status.",
    inputSchema: {
      id: z.string(),
      title: draftFields.title.optional(),
      markdown: draftFields.markdown.optional(),
      tags: draftFields.tags.describe("Replaces the full tag list"),
      excerpt: draftFields.excerpt,
      feature_image: draftFields.feature_image,
    },
  },
  tool(async ({ id, title, markdown, tags, excerpt, feature_image }) => {
    const { posts: [current] } = await ghost.get(`posts/${encodeURIComponent(id)}/`);
    if (current.status !== "draft") {
      throw new Error(`Post is ${current.status}; only drafts can be edited through this server`);
    }
    // updated_at is Ghost's collision check: the edit fails if someone saved the post in between
    const post = {
      updated_at: current.updated_at,
      ...(title !== undefined && { title }),
      ...(markdown !== undefined && { html: await marked.parse(markdown) }),
      ...(tags && { tags: tags.map((name) => ({ name })) }),
      ...(excerpt !== undefined && { custom_excerpt: excerpt }),
      ...(feature_image && { feature_image }),
    };
    const { posts: [p] } = await ghost.put(`posts/${encodeURIComponent(id)}/?source=html&include=tags`, { posts: [post] });
    return summary(p);
  }),
);

await server.connect(new StdioServerTransport());
