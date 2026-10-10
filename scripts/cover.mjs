#!/usr/bin/env node
// Blog cover image: optional background photo, dark gradient, white text.
// Renders an HTML template in headless Chromium (Playwright) and saves a 1920x1080 JPEG.
//
//   node scripts/cover.mjs "Title" ["Subtitle"] ["Tag · Tag"] [--out file.jpg] [--bg image.jpg] [--brand "Name · blog.example.com"]
//
// Upload the result with the MCP tool upload_image and set it via feature_image.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
};
const out = flag("--out");
const bgPath = flag("--bg") ?? process.env.COVER_BG;
const brand = flag("--brand") ?? process.env.COVER_BRAND ?? "";
const [title, subtitle = "", kicker = ""] = args;

if (!title) {
  console.error('usage: node scripts/cover.mjs "Title" ["Subtitle"] ["Tag · Tag"] [--out file.jpg] [--bg image.jpg] [--brand text]');
  process.exit(1);
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const file = path.resolve(out ?? `cover-${slug}.jpg`);
const bgMime = path.extname(bgPath ?? "").toLowerCase() === ".png" ? "image/png" : "image/jpeg";
const bg = bgPath ? `data:${bgMime};base64,${fs.readFileSync(bgPath).toString("base64")}` : "";

const html = `<html><body style="margin:0">
<div style="width:1920px;height:1080px;position:relative;overflow:hidden;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff">
  ${bg ? `<img src="${bg}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : `<div style="position:absolute;inset:0;background:#0b1013"></div>`}
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,.15))"></div>
  ${brand ? `<div style="position:absolute;left:140px;top:110px;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${esc(brand)}</div>` : ""}
  <div style="position:absolute;left:140px;right:200px;bottom:170px">
    ${kicker ? `<div style="display:inline-block;border:2px solid rgba(255,255,255,.4);background:rgba(255,255,255,.1);padding:14px 26px;font-size:30px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:48px">${esc(kicker)}</div>` : ""}
    <div style="font-size:112px;font-weight:800;letter-spacing:-.035em;line-height:1.02;margin-bottom:36px">${esc(title)}</div>
    ${subtitle ? `<div style="font-size:46px;color:rgba(255,255,255,.8);line-height:1.3">${esc(subtitle)}</div>` : ""}
  </div>
</div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(html);
  await page.screenshot({ path: file, type: "jpeg", quality: 88 });
} finally {
  await browser.close();
}
console.log(file);
