/**
 * Render shop previews for the demo pet shown to logged-out visitors (Max).
 *
 *   npm run build && npm run merch-demo -- <image URL or local path> [...more]
 *
 * Prints each image's manifest as JSON. Paste the result into the frontend's
 * src/constants/merch_demo.ts so the logged-out shop makes zero backend calls.
 */
import "dotenv/config";
import fs from "node:fs";

import { getObjectFromS3 } from "@/services/aws_service";
import { ensurePreviews, PreviewManifest } from "@/services/merch_preview_service";

const load = async (src: string) => {
  if (!/^https?:\/\//.test(src)) return fs.readFileSync(src);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${src}`);
  return Buffer.from(await res.arrayBuffer());
};

const main = async () => {
  const sources = process.argv.slice(2);
  if (!sources.length) throw new Error("usage: npm run merch-demo -- <image URL or path> [...]");
  const out: Array<{ source: string } & PreviewManifest> = [];
  for (const source of sources) {
    let m = await ensurePreviews(await load(source));
    for (let i = 0; i < 120 && m.entries.some((e) => e.status === "pending"); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const raw = await getObjectFromS3(`merch/previews/${m.srcSha}/${m.version}/manifest.json`);
      if (raw) m = JSON.parse(raw.toString("utf8"));
    }
    const notReady = m.entries.filter((e) => e.status !== "ready");
    if (notReady.length) console.error(`[merch-demo] ${source}: ${notReady.length} not ready`, notReady);
    out.push({ source, ...m });
  }
  console.log(JSON.stringify(out, null, 2));
};

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
