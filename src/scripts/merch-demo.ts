/**
 * Render shop previews for the demo pet shown to logged-out visitors (Max).
 *
 *   npm run build && npm run merch-demo -- [--name=Max] <image URL or local path> [...more]
 *
 * Prints each image's manifest as JSON. Paste the result into the frontend's
 * src/constants/merch_demo.ts so the logged-out shop makes zero backend calls.
 */
import "dotenv/config";

import fs from "node:fs";

import {
  ensurePreviews,
  PreviewManifest,
} from "@/services/merch_preview_service";

const load = async (src: string) => {
  if (!/^https?:\/\//.test(src)) {
    return fs.readFileSync(src);
  }
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} for ${src}`);
  }
  return Buffer.from(await res.arrayBuffer());
};

const main = async () => {
  // --name= is the pet's display name, for products that print it (pet bowl).
  const name =
    process.argv.find((a) => a.startsWith("--name="))?.slice(7) ?? null;
  const sources = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!sources.length) {
    throw new Error("usage: npm run merch-demo -- <image URL or path> [...]");
  }
  const out: Array<{ source: string } & PreviewManifest> = [];
  for (const source of sources) {
    const buf = await load(source);
    let m = await ensurePreviews(buf, { displayName: name });
    // Wait for everything the shop shows: flat previews AND photoreal mockups. Ask the service
    // (as the shop does) rather than the saved manifest, whose `complete` can be stale when a
    // product gains a calibration after the manifest was written.
    for (let i = 0; i < 120 && m.complete !== true; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      m = await ensurePreviews(buf, { displayName: name });
    }
    const notReady = m.entries.filter((e) => e.status !== "ready");
    if (notReady.length) {
      console.error(
        `[merch-demo] ${source}: ${notReady.length} not ready`,
        notReady,
      );
    }
    out.push({ source, ...m });
  }
  console.log(JSON.stringify(out, null, 2));
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
