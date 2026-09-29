/**
 * Build photoreal-mockup calibrations for shop products.
 *
 *   npm run build && npm run merch-calibrate -- [--render] --dir=<folder> <productKey ...>
 *
 * --render  asks Printful to render three images per product through its product-photo
 *           style (paced to the 2 tasks/min account limit): white (lighting), black
 *           (print coverage), and a dot grid at known positions (geometry). Without it,
 *           the renders already in --dir are used.
 * Then, per product: fit the (x, y) -> (u, v) map, check it, upload the photo and mask
 * to S3, and write src/constants/merch_calibrations.json (the registry the preview
 * service reads). Run with the SOURCE registry path so the change can be committed.
 *
 * A product only belongs in the registry after its mockups pass the 5-pet check against
 * Printful's own mockups of the real print file (tile-shift NCC: 95% of tiles <= 1.5 px,
 * none > 3 px). Evidence: specs/merch-m4-shop-showroom-architecture.md.
 */
import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { outputSize, PRINT_PRODUCTS } from "@/constants/print_products";
import { uploadFileToS3 } from "@/services/aws_service";
import { mapBasis, MockupCalibration } from "@/services/merch_mockup_service";

const REGISTRY_PATH = path.join(
  process.cwd(),
  "src",
  "constants",
  "merch_calibrations.json",
);
const API = "https://api.printful.com";
const headers = () => ({
  Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
  "X-PF-Store-Id": "18796047",
  "Content-Type": "application/json",
});

/** Which Printful photo style each product is shown in. Clean product shots, one per product. */
const TARGETS: Record<
  string,
  {
    pid: number;
    vid: number;
    placement: string;
    technique: string;
    category: string;
    options?: Array<{ name: string; value: string }>;
    /** Pin the photo style instead of choosing it by category. */
    styleId?: number;
    /**
     * Dot-grid override for unusual shapes. The pet bowl is an 8:1 band on a curved face: it needs
     * many columns (only the front third shows), larger dots (the photo shrinks them), and a
     * distinctive oversized MARKER dot at [i, j] so the grid position can't be ambiguous on a
     * periodic cylinder.
     */
    grid?: {
      NX: number;
      NY: number;
      margin: number;
      radiusFrac: number;
      marker: [number, number];
    };
    /**
     * Mask (and gate) only |u - 0.5| <= this; the fit also uses dots one column beyond it. Beyond
     * about 0.15 the cylinder foreshortens too hard for the polynomial (bowl, measured: fitting to
     * |u - 0.5| <= 0.154 gives rms 0.99 px; to 0.132 gives 0.38 px).
     */
    fitDomainU?: number;
  }
> = {
  pet_bowl: {
    pid: 678,
    vid: 16785,
    placement: "default",
    technique: "sublimation",
    category: "Flat / Front",
    styleId: 6558,
    grid: { NX: 41, NY: 5, margin: 0.06, radiusFrac: 0.03, marker: [20, 2] },
    fitDomainU: 0.125,
  },
  mug_11oz: {
    pid: 19,
    vid: 1320,
    placement: "default",
    technique: "sublimation",
    category: "Default / Front view",
  },
  poster_8x10: {
    pid: 1,
    vid: 4463,
    placement: "default",
    technique: "digital",
    category: "Transparent / Transparent",
  },
  framed_8x10: {
    pid: 2,
    vid: 4651,
    placement: "default",
    technique: "digital",
    category: "Flat / Front",
  },
  canvas_16x20: {
    pid: 3,
    vid: 6,
    placement: "default",
    technique: "digital",
    category: "Wall / Wall",
  },
  coaster_4x4: {
    pid: 611,
    vid: 15662,
    placement: "default",
    technique: "sublimation",
    category: "Flat / Front",
  },
  can_cooler: {
    pid: 764,
    vid: 19461,
    placement: "front",
    technique: "sublimation",
    category: "Flat / Front",
  },
  pillow_18x18: {
    pid: 83,
    vid: 4532,
    placement: "front",
    technique: "cut-sew",
    category: "Default / Front",
    options: [{ name: "stitch_color", value: "white" }],
  },
  ornament_ceramic_circle: {
    pid: 900,
    vid: 23133,
    placement: "front",
    technique: "sublimation",
    category: "Flat / Front",
  },
  ornament_metal_oval: {
    pid: 901,
    vid: 23135,
    placement: "front",
    technique: "sublimation",
    category: "Flat / Front",
  },
  card_4x6: {
    pid: 568,
    vid: 14457,
    placement: "front",
    technique: "digital",
    category: "Flat 3 / Front",
  },
};

const sha = (b: Buffer) =>
  crypto.createHash("sha256").update(b).digest("hex").slice(0, 12);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Dot layout in VISIBLE-area coordinates, ~13 across with roughly square spacing, 6% margin. */
const grid = (key: string) => {
  const p = PRINT_PRODUCTS[key],
    o = TARGETS[key]?.grid,
    NX = o?.NX ?? 13,
    NY = o?.NY ?? Math.max(5, Math.round((13 * p.heightIn) / p.widthIn)),
    M = o?.margin ?? 0.06;
  const dots: Array<{ u: number; v: number }> = [];
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      dots.push({
        u: M + ((1 - 2 * M) * i) / (NX - 1),
        v: M + ((1 - 2 * M) * j) / (NY - 1),
      });
    }
  }
  return { NX, NY, dots };
};

// ---------------------------------------------------------------- Printful renders

/** Style ids for this variant; pick the one whose print-area shape matches the file (never mix portrait and landscape). */
const styleFor = async (key: string) => {
  if (TARGETS[key].styleId) {
    return TARGETS[key].styleId as number;
  }
  const t = TARGETS[key],
    s = outputSize(PRINT_PRODUCTS[key]);
  const res = await fetch(
    `${API}/v2/catalog-products/${t.pid}/mockup-styles?placements=${t.placement}&limit=100`,
    { headers: headers() },
  );
  const json: any = await res.json();
  const want = s.fullW / s.fullH;
  const groups = (json.data ?? []) as any[];
  const candidates = groups.flatMap((g) =>
    (g.mockup_styles ?? [])
      .filter(
        (m: any) =>
          `${m.category_name} / ${m.view_name}` === t.category &&
          (!m.restricted_to_variants?.length ||
            m.restricted_to_variants.includes(t.vid)),
      )
      .map((m: any) => ({
        id: m.id as number,
        shape: Math.abs(
          Math.log(g.print_area_width / g.print_area_height / want),
        ),
      })),
  );
  candidates.sort((a, b) => a.shape - b.shape);
  if (!candidates.length) {
    throw new Error(`${key}: no "${t.category}" style for variant ${t.vid}`);
  }
  return candidates[0].id;
};

let lastSubmit = 0;
const renderOnce = async (
  key: string,
  styleId: number,
  url: string,
): Promise<Buffer> => {
  const t = TARGETS[key];
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastSubmit + 31_000 - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastSubmit = Date.now();
    const body = {
      format: "png",
      products: [
        {
          source: "catalog",
          catalog_product_id: t.pid,
          catalog_variant_ids: [t.vid],
          mockup_style_ids: [styleId],
          placements: [
            {
              placement: t.placement,
              technique: t.technique,
              layers: [{ type: "file", url }],
            },
          ],
          ...(t.options ? { product_options: t.options } : {}),
        },
      ],
    };
    const res = await fetch(`${API}/v2/mockup-tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(62_000);
      continue;
    }
    const json: any = await res.json();
    if (res.status >= 300) {
      throw new Error(
        `${key}: mockup task ${res.status} ${JSON.stringify(json).slice(0, 300)}`,
      );
    }
    const id = json.data[0].id;
    // Printful occasionally leaves a task pending for many minutes; resubmit instead of waiting.
    for (let k = 0; k < 60; k++) {
      await sleep(2000);
      const polled: any = await (
        await fetch(`${API}/v2/mockup-tasks?id=${id}`, { headers: headers() })
      ).json();
      const d = polled.data?.[0];
      if (!d || d.status === "pending") {
        continue;
      }
      const mk = d.catalog_variant_mockups?.[0]?.mockups?.[0];
      if (!mk) {
        throw new Error(
          `${key}: task ${id} ${d.status} ${JSON.stringify(d.failure_reasons).slice(0, 300)}`,
        );
      }
      return Buffer.from(await (await fetch(mk.mockup_url)).arrayBuffer());
    }
  }
  throw new Error(`${key}: Printful did not finish the mockup task`);
};

const render = async (key: string, dir: string) => {
  const p = PRINT_PRODUCTS[key],
    s = outputSize(p),
    styleId = await styleFor(key);
  const { NX, dots } = grid(key),
    o = TARGETS[key].grid,
    r = Math.round(Math.min(s.visibleW, s.visibleH) * (o?.radiusFrac ?? 0.012));
  const circles = dots
    .map((d, k) => {
      const isMarker = o && k === o.marker[1] * NX + o.marker[0];
      return `<circle cx="${(s.bleedPx + d.u * s.visibleW).toFixed(1)}" cy="${(s.bleedPx + d.v * s.visibleH).toFixed(1)}" r="${isMarker ? Math.round(r * 1.7) : r}" fill="#000"/>`;
    })
    .join("");
  const images: Record<string, ReturnType<typeof sharp>> = {
    white: sharp({
      create: {
        width: s.fullW,
        height: s.fullH,
        channels: 3,
        background: "#fff",
      },
    }),
    black: sharp({
      create: {
        width: s.fullW,
        height: s.fullH,
        channels: 3,
        background: "#000",
      },
    }),
    grid: sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${s.fullW}" height="${s.fullH}"><rect width="100%" height="100%" fill="#fff"/>${circles}</svg>`,
      ),
    ).flatten({ background: "#fff" }),
  };
  for (const [kind, img] of Object.entries(images)) {
    const buf = await img
      .withMetadata({ density: p.dpi })
      .jpeg({ quality: 97, chromaSubsampling: "4:4:4" })
      .toBuffer();
    // Content-addressed URL: Printful caches files by URL, so reusing one serves the OLD file.
    const url = await uploadFileToS3({
      Key: `merch/calibration/v2/${key}-${kind}-${sha(buf)}.jpg`,
      buffer: buf,
      fileType: "image/jpeg",
    });
    if (!url) {
      throw new Error(`${key}: upload failed`);
    }
    fs.writeFileSync(
      path.join(dir, `${key}-${kind}.png`),
      await renderOnce(key, styleId, url),
    );
    console.log(`[merch-calibrate] ${key} ${kind} rendered (style ${styleId})`);
  }
  return styleId;
};

// ---------------------------------------------------------------- fitting

const lum = (d: Buffer, o: number) =>
  0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

const solve = (A: number[][], b: number[]) => {
  const n = A[0].length,
    M = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let r = 0; r < A.length; r++) {
    for (let i = 0; i < n; i++) {
      M[i][n] += A[r][i] * b[r];
      for (let j = 0; j < n; j++) {
        M[i][j] += A[r][i] * A[r][j];
      }
    }
  }
  for (let i = 0; i < n; i++) {
    M[i][i] += 1e-9;
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) {
        p = r;
      }
    }
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r !== c) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) {
          M[r][k] -= f * M[c][k];
        }
      }
    }
  }
  return M.map((row, i) => row[n] / row[i]);
};

const homography = (src: number[][], dst: number[][]) => {
  const A: number[][] = [],
    b: number[] = [];
  for (let k = 0; k < 4; k++) {
    const [u, v] = src[k],
      [x, y] = dst[k];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  const h = solve(A, b);
  return (u: number, v: number) => {
    const w = h[6] * u + h[7] * v + 1;
    return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
  };
};

const fit = async (key: string, dir: string) => {
  const load = async (kind: string) =>
    sharp(path.join(dir, `${key}-${kind}.png`))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  const wh = await load("white"),
    bk = await load("black"),
    gr = await load("grid");
  const W = wh.info.width,
    H = wh.info.height;

  // Coverage: where print lands = how much darker black prints than white.
  const diff = new Float32Array(W * H),
    vals: number[] = [];
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (wh.data[o + 3] < 128) {
      continue;
    }
    diff[i] = Math.max(0, lum(wh.data, o) - lum(bk.data, o));
    if (diff[i] > 20) {
      vals.push(diff[i]);
    }
  }
  vals.sort((a, b) => a - b);
  const ref = vals[Math.floor(vals.length * 0.9)] || 1;
  const alpha = new Float32Array(W * H);
  let x0 = W,
    y0 = H,
    x1 = 0,
    y1 = 0;
  for (let i = 0; i < W * H; i++) {
    const a = Math.min(1, diff[i] / (ref * 0.85));
    alpha[i] = a < 0.04 ? 0 : a;
    if (alpha[i] > 0) {
      const x = i % W,
        y = (i / W) | 0;
      if (x < x0) {
        x0 = x;
      }
      if (x > x1) {
        x1 = x;
      }
      if (y < y0) {
        y0 = y;
      }
      if (y > y1) {
        y1 = y;
      }
    }
  }

  // Dots: dark relative to the white render, inside solid coverage.
  const dark = new Float32Array(W * H),
    lab = new Int32Array(W * H),
    found: Array<{ x: number; y: number; cut: boolean; cnt: number }> = [];
  for (let i = 0; i < W * H; i++) {
    if (alpha[i] > 0.5) {
      dark[i] = Math.max(
        0,
        1 - lum(gr.data, i * 4) / Math.max(1, lum(wh.data, i * 4)),
      );
    }
  }
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (dark[i] < 0.35 || lab[i]) {
        continue;
      }
      n++;
      lab[i] = n;
      const st = [i];
      let sw = 0,
        sx = 0,
        sy = 0,
        cnt = 0,
        cut = false;
      while (st.length) {
        const k = st.pop() as number,
          kx = k % W,
          ky = (k / W) | 0;
        cnt++;
        if (
          alpha[k - 1] <= 0.5 ||
          alpha[k + 1] <= 0.5 ||
          alpha[k - W] <= 0.5 ||
          alpha[k + W] <= 0.5
        ) {
          cut = true;
        }
        sw += dark[k];
        sx += dark[k] * kx;
        sy += dark[k] * ky;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const q = k + dy * W + dx;
            if (q >= 0 && q < W * H && dark[q] >= 0.35 && !lab[q]) {
              lab[q] = n;
              st.push(q);
            }
          }
        }
      }
      if (cnt >= 6) {
        found.push({ x: sx / sw + 0.5, y: sy / sw + 0.5, cut, cnt });
      }
    }
  }
  const { NX, NY, dots } = grid(key);
  const d = (i: number, j: number) => [dots[j * NX + i].u, dots[j * NX + i].v];
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    sxn = (x1 - x0) / 2,
    syn = (y1 - y0) / 2;
  const basisAt = (x: number, y: number) =>
    mapBasis((x - cx) / sxn, (y - cy) / syn);
  const evAt = (c: number[], x: number, y: number) =>
    basisAt(x, y).reduce((acc, t, k) => acc + t * c[k], 0);
  const fitPairs = (
    ps: Array<{ x: number; y: number; u: number; v: number }>,
  ) => {
    const A = ps.map((p) => basisAt(p.x, p.y));
    return {
      cu: solve(
        A,
        ps.map((p) => p.u),
      ),
      cv: solve(
        A,
        ps.map((p) => p.v),
      ),
    };
  };
  // Where the printed shape's outline meets the centre row/column, in art coords. For a
  // rectangle these are the art's edges (0 and 1); for a centred disc/oval they're symmetric.
  const row = Math.round(cy),
    col = Math.round(cx);
  const firstX = (from: number, to: number) => {
    for (let x = from; from < to ? x <= to : x >= to; x += from < to ? 1 : -1) {
      if (alpha[row * W + x] > 0.5) {
        return x;
      }
    }
    return from;
  };
  const firstY = (from: number, to: number) => {
    for (let y = from; from < to ? y <= to : y >= to; y += from < to ? 1 : -1) {
      if (alpha[y * W + col] > 0.5) {
        return y;
      }
    }
    return from;
  };
  const edgesFor = (cu: number[], cv: number[]) => [
    evAt(cu, firstX(x0, x1), row),
    1 - evAt(cu, firstX(x1, x0), row),
    evAt(cv, col, firstY(y0, y1)),
    1 - evAt(cv, col, firstY(y1, y0)),
  ];
  const centring = (e: number[]) =>
    Math.abs(e[0] - e[1]) + Math.abs(e[2] - e[3]);

  // Rectangular prints show every dot: the four corner dots anchor identity.
  // Shaped prints (disc, oval) hide the square file's corners: label every dot by walking the
  // lattice from the centre dot, then choose the grid offset that leaves the shape centred on
  // the art. Several offsets fit equally well; only the true one is centred (measured: 0.000 vs
  // >= 0.147 on the ceramic disc), so an ambiguous choice is rejected, never guessed.
  const cornersVisible = found.length >= NX * NY * 0.95;
  let pairs: Array<{ x: number; y: number; u: number; v: number }> = [];
  if (cornersVisible) {
    const pick = (f: (p: { x: number; y: number }) => number) =>
      found.reduce((b, p) => (f(p) > f(b) ? p : b));
    const tl = pick((p) => -(p.x + p.y)),
      br = pick((p) => p.x + p.y),
      tr = pick((p) => p.x - p.y),
      bl = pick((p) => p.y - p.x);
    const Hm = homography(
      [d(0, 0), d(NX - 1, 0), d(NX - 1, NY - 1), d(0, NY - 1)],
      [
        [tl.x, tl.y],
        [tr.x, tr.y],
        [br.x, br.y],
        [bl.x, bl.y],
      ],
    );
    const spacing = Math.hypot(tr.x - tl.x, tr.y - tl.y) / (NX - 1);
    for (const dot of dots) {
      const [px, py] = Hm(dot.u, dot.v);
      let best = null as null | { x: number; y: number },
        bd = Infinity;
      for (const p of found) {
        const dd = Math.hypot(p.x - px, p.y - py);
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      if (best && bd < spacing * 0.45) {
        pairs.push({ x: best.x, y: best.y, u: dot.u, v: dot.v });
      }
    }
  } else {
    const whole = found.filter((p) => !p.cut); // dots clipped by the outline have biased centroids
    const N = whole.length;
    const target = TARGETS[key];
    if (N < (target.grid ? 30 : NX * NY * 0.4)) {
      throw new Error(
        `${key}: only ${N} whole dots visible — too little of the print shows to calibrate`,
      );
    }
    const nn = whole.map((p, a) => {
      let b = Infinity;
      for (let k = 0; k < N; k++) {
        if (k !== a) {
          b = Math.min(b, Math.hypot(whole[k].x - p.x, whole[k].y - p.y));
        }
      }
      return b;
    });
    const sp = [...nn].sort((a, b) => a - b)[N >> 1];
    const ax: number[][] = [],
      ay: number[][] = [];
    for (let a = 0; a < N; a++) {
      for (let k = 0; k < N; k++) {
        const dx = whole[k].x - whole[a].x,
          dy = whole[k].y - whole[a].y;
        if (k === a || Math.hypot(dx, dy) > 1.4 * sp) {
          continue;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) {
            ax.push([dx, dy]);
          }
        } else if (dy > 0) {
          ay.push([dx, dy]);
        }
      }
    }
    const med = (v: number[][], c: number) =>
      v.map((q) => q[c]).sort((a, b) => a - b)[v.length >> 1];
    const mx = whole.reduce((t, p) => t + p.x, 0) / N,
      my = whole.reduce((t, p) => t + p.y, 0) / N;
    // A marker grid anchors identity on its oversized dot (the largest blob, well above median).
    let markerStart = -1;
    if (target.grid) {
      const sizes = whole.map((p) => p.cnt).sort((a, b) => a - b);
      const medianCnt = sizes[sizes.length >> 1];
      let big = 0;
      for (let k = 1; k < N; k++) {
        if (whole[k].cnt > whole[big].cnt) {
          big = k;
        }
      }
      if (whole[big].cnt < medianCnt * 2) {
        throw new Error(
          `${key}: marker dot not found (largest blob ${whole[big].cnt}px vs median ${medianCnt}px)`,
        );
      }
      markerStart = big;
    }
    let start = 0;
    for (let k = 1; k < N; k++) {
      if (
        Math.hypot(whole[k].x - mx, whole[k].y - my) <
        Math.hypot(whole[start].x - mx, whole[start].y - my)
      ) {
        start = k;
      }
    }
    if (markerStart >= 0) {
      start = markerStart;
    }
    const lab: Array<[number, number] | null> = new Array(N).fill(null);
    const vecA: number[][] = new Array(N),
      vecB: number[][] = new Array(N);
    lab[start] = [0, 0];
    vecA[start] = [med(ax, 0), med(ax, 1)];
    vecB[start] = [med(ay, 0), med(ay, 1)];
    if (target.grid) {
      // A foreshortened grid has no single spacing: the median nearest-neighbour distance comes
      // from the squeezed dots near the silhouette, and the vertical step can exceed 1.4x that, so
      // global medians give wrong seed vectors (measured on the bowl: the walk labelled only the
      // marker). Seed from the marker's own nearest right and lower neighbours instead.
      const near = (want: (dx: number, dy: number) => boolean) => {
        let b = -1,
          bd = Infinity;
        for (let k = 0; k < N; k++) {
          const dx = whole[k].x - whole[start].x,
            dy = whole[k].y - whole[start].y,
            dd = Math.hypot(dx, dy);
          if (k !== start && want(dx, dy) && dd < bd) {
            bd = dd;
            b = k;
          }
        }
        if (b < 0) {
          throw new Error(
            `${key}: marker has no neighbour to seed the lattice`,
          );
        }
        return [whole[b].x - whole[start].x, whole[b].y - whole[start].y];
      };
      vecA[start] = near((dx, dy) => dx > 0 && Math.abs(dx) > Math.abs(dy));
      vecB[start] = near((dx, dy) => dy > 0 && Math.abs(dy) > Math.abs(dx));
    }
    const queue = [start],
      taken = new Set(["0,0"]);
    while (queue.length) {
      const a = queue.shift() as number,
        [li, lj] = lab[a] as [number, number];
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const tag = `${li + di},${lj + dj}`;
        if (taken.has(tag)) {
          continue;
        }
        const px = whole[a].x + di * vecA[a][0] + dj * vecB[a][0],
          py = whole[a].y + di * vecA[a][1] + dj * vecB[a][1];
        let best = -1,
          bd = Infinity;
        for (let k = 0; k < N; k++) {
          const dd = Math.hypot(whole[k].x - px, whole[k].y - py);
          if (dd < bd) {
            bd = dd;
            best = k;
          }
        }
        // Marker grids: tolerance scales with the local step, which shrinks toward the silhouette.
        const tol = target.grid
          ? 0.3 * Math.hypot(px - whole[a].x, py - whole[a].y)
          : 0.3 * sp;
        if (best < 0 || bd > tol || lab[best]) {
          continue;
        }
        lab[best] = [li + di, lj + dj];
        taken.add(tag);
        const obs = [whole[best].x - whole[a].x, whole[best].y - whole[a].y];
        vecA[best] = di ? [obs[0] * di, obs[1] * di] : vecA[a];
        vecB[best] = dj ? [obs[0] * dj, obs[1] * dj] : vecB[a];
        queue.push(best);
      }
    }
    const L = whole.flatMap((p, k) =>
      lab[k]
        ? [
            {
              x: p.x,
              y: p.y,
              i: (lab[k] as number[])[0],
              j: (lab[k] as number[])[1],
            },
          ]
        : [],
    );
    const imin = Math.min(...L.map((p) => p.i)),
      imax = Math.max(...L.map((p) => p.i)),
      jmin = Math.min(...L.map((p) => p.j)),
      jmax = Math.max(...L.map((p) => p.j));
    const scored: Array<{
      oi: number;
      oj: number;
      score: number;
      ps: typeof pairs;
    }> = [];
    const offsets: Array<[number, number]> = [];
    if (target.grid) {
      offsets.push(target.grid.marker); // the marker was labelled (0,0)
    } else {
      for (let oi = -imin; oi + imax <= NX - 1; oi++) {
        for (let oj = -jmin; oj + jmax <= NY - 1; oj++) {
          offsets.push([oi, oj]);
        }
      }
    }
    for (const [oi, oj] of offsets) {
      if (
        imin + oi < 0 ||
        imax + oi > NX - 1 ||
        jmin + oj < 0 ||
        jmax + oj > NY - 1
      ) {
        throw new Error(
          `${key}: labelled dots fall outside the grid at offset ${oi},${oj}`,
        );
      }
      {
        const ps = L.map((p) => {
          const g = dots[(p.j + oj) * NX + (p.i + oi)];
          return { x: p.x, y: p.y, u: g.u, v: g.v };
        });
        const f = fitPairs(ps);
        scored.push({ oi, oj, score: centring(edgesFor(f.cu, f.cv)), ps });
      }
    }
    scored.sort((a, b) => a.score - b.score);
    if (target.grid) {
      scored.splice(1); // the marker fixed the offset; nothing to disambiguate
    }
    if (
      !target.grid &&
      (!scored.length ||
        scored[0].score > 0.02 ||
        (scored[1] && scored[1].score < 0.05))
    ) {
      throw new Error(
        `${key}: grid position ambiguous (best centring ${scored[0]?.score.toFixed(3)}, next ${scored[1]?.score.toFixed(3)})`,
      );
    }
    pairs = scored[0].ps;
  }
  const du = dots[1].u - dots[0].u,
    dv = dots[NX].v - dots[0].v;
  // Refine: fit, then re-identify every usable dot through the fitted map. For shaped prints,
  // dots clipped by the outline are left out — their centroids are pulled inward.
  const usable = cornersVisible ? found : found.filter((p) => !p.cut);
  const domainU = TARGETS[key].fitDomainU ?? Infinity;
  const inDomain = (u: number) => Math.abs(u - 0.5) <= domainU + du;
  pairs = pairs.filter((p) => inDomain(p.u));
  let cu: number[] = [],
    cv: number[] = [];
  for (let pass = 0; pass < 3; pass++) {
    ({ cu, cv } = fitPairs(pairs));
    if (pass === 2) {
      break;
    }
    pairs = usable.flatMap((p) => {
      const u = evAt(cu, p.x, p.y),
        v = evAt(cv, p.x, p.y),
        i = Math.round((u - dots[0].u) / du),
        j = Math.round((v - dots[0].v) / dv);
      if (i < 0 || i >= NX || j < 0 || j >= NY) {
        return [];
      }
      const g = dots[j * NX + i];
      return inDomain(g.u) &&
        Math.abs(u - g.u) < du * 0.3 &&
        Math.abs(v - g.v) < dv * 0.3
        ? [{ x: p.x, y: p.y, u: g.u, v: g.v }]
        : [];
    });
  }
  const res = pairs.map((p) =>
    Math.hypot(
      (evAt(cu, p.x, p.y) - p.u) * sxn * 2,
      (evAt(cv, p.x, p.y) - p.v) * syn * 2,
    ),
  );
  const rms = Math.sqrt(res.reduce((acc, r) => acc + r * r, 0) / res.length),
    max = Math.max(...res);

  // Identity guard. Rectangles: the covered area's edges must map to the art's edges (0 and 1);
  // a grid matched one column off still fits tightly but fails this. Canvas edges include its
  // mirrored wrap. Shaped prints: the outline must sit centred on the art (the edges themselves
  // are inset by the product's shape — that inset is a real print crop, reported below).
  const edges = edgesFor(cu, cv);
  const edgeTol = PRINT_PRODUCTS[key].bleedIn > 0 ? 0.25 : 0.05;
  const need = cornersVisible
    ? NX * NY
    : // Judge the domain on the dot's grid column (as the pairing does), not its fitted u: a dot
      // just outside the domain whose fitted u lands just inside can never be paired.
      usable.filter((p) => {
        const i = Math.round((evAt(cu, p.x, p.y) - dots[0].u) / du);
        return inDomain(dots[Math.min(NX - 1, Math.max(0, i))].u);
      }).length;
  // A marker grid is anchored by its marker; its outline is the bowl's silhouette, not the art edge.
  const identityOk = TARGETS[key].grid
    ? true
    : cornersVisible
      ? edges.every((e) => Math.abs(e) <= edgeTol)
      : centring(edges) <= 0.02;
  if (Number.isFinite(domainU)) {
    // Beyond the legible range the mockup keeps the blank photo rather than a badly fitted print.
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (alpha[y * W + x] > 0 && Math.abs(evAt(cu, x, y) - 0.5) > domainU) {
          alpha[y * W + x] = 0;
        }
      }
    }
  }
  if (pairs.length < need * 0.95 || rms > 0.5 || max > 2.5 || !identityOk) {
    throw new Error(
      `${key}: calibration rejected (dots ${pairs.length}/${need}, rms ${rms.toFixed(2)}px, max ${max.toFixed(2)}px, edges ${edges.map((e) => e.toFixed(3)).join("/")}${cornersVisible ? "" : `, centring ${centring(edges).toFixed(3)}`})`,
    );
  }

  const alpha8 = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) {
    alpha8[i] = Math.round(alpha[i] * 255);
  }
  return {
    W,
    H,
    bbox: [x0, y0, x1, y1] as [number, number, number, number],
    norm: [cx, cy, sxn, syn] as [number, number, number, number],
    cu,
    cv,
    photo: await sharp(path.join(dir, `${key}-white.png`))
      .png({ compressionLevel: 9 })
      .toBuffer(),
    mask: await sharp(alpha8, { raw: { width: W, height: H, channels: 1 } })
      .png({ compressionLevel: 9 })
      .toBuffer(),
    stats: `dots ${pairs.length}/${need}${cornersVisible ? "" : " (shape-limited)"}, rms ${rms.toFixed(2)}px, max ${max.toFixed(2)}px, edges ${edges.map((e) => e.toFixed(3)).join("/")}`,
  };
};

// ---------------------------------------------------------------- main

const main = async () => {
  const args = process.argv.slice(2);
  const dir = args.find((a) => a.startsWith("--dir="))?.slice(6);
  const doRender = args.includes("--render");
  const keys = args.filter((a) => !a.startsWith("--"));
  if (!dir || !keys.length) {
    throw new Error(
      "usage: npm run merch-calibrate -- [--render] --dir=<folder> <productKey ...>",
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  const registry: Record<string, MockupCalibration> = fs.existsSync(
    REGISTRY_PATH,
  )
    ? JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"))
    : {};

  for (const key of keys) {
    if (!TARGETS[key]) {
      throw new Error(`unknown product ${key}`);
    }
    const styleId = doRender
      ? await render(key, dir)
      : registry[key]?.styleId ?? (await styleFor(key));
    const f = await fit(key, dir);
    const photoUrl = await uploadFileToS3({
      Key: `merch/calibration/assets/${key}-photo-${sha(f.photo)}.png`,
      buffer: f.photo,
      fileType: "image/png",
    });
    const alphaUrl = await uploadFileToS3({
      Key: `merch/calibration/assets/${key}-mask-${sha(f.mask)}.png`,
      buffer: f.mask,
      fileType: "image/png",
    });
    if (!photoUrl || !alphaUrl) {
      throw new Error(`${key}: asset upload failed`);
    }
    const id = sha(
      Buffer.from(JSON.stringify([photoUrl, alphaUrl, f.cu, f.cv, f.norm])),
    );
    registry[key] = {
      id,
      styleId,
      width: f.W,
      height: f.H,
      bbox: f.bbox,
      norm: f.norm,
      cu: f.cu,
      cv: f.cv,
      photoUrl,
      alphaUrl,
    };
    console.log(`[merch-calibrate] ${key}: ${f.stats} -> ${id}`);
  }
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 1)}\n`);
  console.log(`[merch-calibrate] wrote ${REGISTRY_PATH}`);
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
