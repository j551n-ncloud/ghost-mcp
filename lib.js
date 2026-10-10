import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

// Ghost Admin API token: HS256 JWT, kid = key id, signed with the hex-decoded secret, valid 5 minutes.
export function adminToken(adminKey, now = Math.floor(Date.now() / 1000)) {
  const [id, secret] = String(adminKey).split(":");
  if (!id || !/^[0-9a-f]+$/i.test(secret ?? "")) throw new Error("GHOST_ADMIN_KEY must look like <id>:<hex secret>");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "HS256", typ: "JWT", kid: id })}.${b64({ iat: now, exp: now + 300, aud: "/admin/" })}`;
  const sig = crypto.createHmac("sha256", Buffer.from(secret, "hex")).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

// NQL string literal, single quotes and backslashes escaped
const nql = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function buildFilter({ query, status, tag } = {}) {
  const parts = [];
  if (status && status !== "all") parts.push(`status:${status}`);
  if (tag) parts.push(`tag:${nql(tag)}`);
  if (query) parts.push(`title:~${nql(query)}`);
  return parts.join("+");
}

// Can talk to Ghost directly on the LAN. Ghost's configured url is usually https://<host>, so it would 301
// plain http requests; sending Host and X-Forwarded-Proto makes it answer as if it came through the proxy.
export function createClient({ url, host, adminKey, acceptVersion = "v6.0" }) {
  const base = new URL(url);
  const mod = base.protocol === "https:" ? https : http;

  // body: undefined, a JSON-serialisable object, or { raw: Buffer, contentType } for multipart uploads
  function request(method, path, body) {
    const raw = body?.raw;
    const payload = body === undefined ? undefined : raw ?? JSON.stringify(body);
    const contentType = raw ? body.contentType : "application/json";
    return new Promise((resolve, reject) => {
      const req = mod.request(
        {
          hostname: base.hostname,
          port: base.port || (base.protocol === "https:" ? 443 : 80),
          path: `/ghost/api/admin/${path}`,
          method,
          timeout: 15000,
          headers: {
            Host: host,
            "X-Forwarded-Proto": "https",
            "Accept-Version": acceptVersion,
            Authorization: `Ghost ${adminToken(adminKey)}`,
            ...(payload && { "Content-Type": contentType, "Content-Length": Buffer.byteLength(payload) }),
          },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            let json;
            try { json = data ? JSON.parse(data) : {}; } catch { json = { raw: data.slice(0, 500) }; }
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
            const msg = json.errors?.map((e) => [e.message, e.context].filter(Boolean).join(": ")).join("; ")
              || json.raw || `HTTP ${res.statusCode}`;
            reject(new Error(`Ghost ${method} ${path} failed (${res.statusCode}): ${msg}`));
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error(`Ghost ${method} ${path} timed out`)));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    // Ghost images/upload expects multipart/form-data with a "file" field
    upload: (path, filename, data, mime) => {
      const boundary = `----ghostmcp${crypto.randomBytes(12).toString("hex")}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nimage\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, "")}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
      );
      const raw = Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      return request("POST", path, { raw, contentType: `multipart/form-data; boundary=${boundary}` });
    },
  };
}
