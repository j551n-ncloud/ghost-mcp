# ghost-mcp

MCP server (stdio) for the [Ghost](https://ghost.org) Admin API. Lets an MCP
client such as Claude Code search and read posts, write drafts and upload
images on your Ghost blog.

## Tools

| Tool | What it does |
|---|---|
| `search_posts` | List posts, newest change first; filter by title, status, tag |
| `get_post` | Read one post by id or slug, with HTML |
| `list_tags` | All tags with slug and post count |
| `create_draft` | New post from Markdown, always a draft |
| `update_draft` | Edit a draft; refuses published or scheduled posts |
| `upload_image` | Upload a local image, returns its URL |

Publishing, scheduling and deleting are deliberately not tools. That stays a
manual step in Ghost admin, so nothing goes live without you looking at it.

## Setup

Needs Node.js 20 or newer.

```bash
git clone https://github.com/j551n-ncloud/ghost-mcp.git
cd ghost-mcp
npm install
```

1. In Ghost admin, **Settings → Integrations → Add custom integration**, and
   copy its **Admin API key** (`<id>:<secret>`).
2. Register the server with your MCP client. For Claude Code:

```bash
claude mcp add ghost --scope user \
  -e GHOST_URL=https://blog.example.com \
  -e GHOST_ADMIN_KEY=<id:secret> \
  -- node /path/to/ghost-mcp/server.js
```

| Variable | Required | Meaning |
|---|---|---|
| `GHOST_URL` | yes | Where to reach Ghost: the public URL, or an internal address like `http://10.0.0.5:2368` |
| `GHOST_ADMIN_KEY` | yes | Admin API key of the custom integration |
| `GHOST_HOST` | no | Public host name of the blog. Defaults to the host of `GHOST_URL`; set it when `GHOST_URL` is an internal address |

### Talking to Ghost on the LAN

Ghost redirects plain-http requests to its configured https URL. When
`GHOST_URL` points straight at the container (for example to skip a
reverse proxy or Cloudflare), the server sends `Host: <GHOST_HOST>` and
`X-Forwarded-Proto: https`, so Ghost answers as if the request came through
the proxy.

## Cover images

```bash
npx playwright install chromium     # once
npm run cover -- "Title" "Subtitle" "Tag · Tag" --bg background.jpg --brand "Your Name · blog.example.com"
```

Renders a 1920x1080 JPEG with Playwright: optional background photo, dark
gradient, white text. `COVER_BG` and `COVER_BRAND` work as environment
variables too. Upload the result with `upload_image` and pass the URL as
`feature_image`.

## Tests

```bash
npm test
```

## License

MIT
