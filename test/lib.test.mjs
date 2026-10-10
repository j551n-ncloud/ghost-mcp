import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { adminToken, buildFilter } from "../lib.js";

const key = "abc123:" + "ab".repeat(32);

test("adminToken is a valid HS256 JWT for the admin audience", () => {
  const token = adminToken(key, 1000);
  const [h, p, sig] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "HS256", typ: "JWT", kid: "abc123" });
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url")), { iat: 1000, exp: 1300, aud: "/admin/" });
  const expected = crypto.createHmac("sha256", Buffer.from("ab".repeat(32), "hex")).update(`${h}.${p}`).digest("base64url");
  assert.equal(sig, expected);
});

test("adminToken rejects malformed keys", () => {
  assert.throws(() => adminToken("nocolon"));
  assert.throws(() => adminToken("id:not-hex"));
});

test("buildFilter combines and escapes", () => {
  assert.equal(buildFilter({}), "");
  assert.equal(buildFilter({ status: "all" }), "");
  assert.equal(buildFilter({ status: "draft", tag: "linux", query: "it's" }), "status:draft+tag:'linux'+title:~'it\\'s'");
});
