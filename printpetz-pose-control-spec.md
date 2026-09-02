# PrintPetz — Baseball Pose Control via ControlNet (flux-general)

Goal: transfer **geometry only** from pose references, so Wizard stays black
and George keeps his muzzle, while limbs/props follow a known-good structure.

⚠️ Field names below are best-effort from fal's public docs. Before wiring in,
verify the exact schema at https://fal.ai/models/fal-ai/flux-general/api —
fal renames fields occasionally. The *architecture* is the deliverable here.

---

## Step 1 — Preprocess reference images into control maps (offline, once)

Do NOT pass raw photos of athletes as control images. Preprocess each
baseball reference into a **pose skeleton (OpenPose)** or **depth map**, and
host *that* in Supabase Storage. A skeleton/depth map contains zero color or
texture information — appearance bleed becomes impossible by construction.

- fal has preprocessor endpoints (search "openpose" / "depth" under
  fal-ai/image-preprocessors), or run locally with controlnet_aux (Python).
- Naming: keep your plan — `baseball_batter_pose.png`,
  `baseball_fielder_glove_pose.png`, etc. Store the map URL in the same
  pose-reference config you already built.

Recommendation: start with **depth** maps for anthropomorphic pets.
OpenPose skeletons assume human proportions and joint detection can fail on
stylized poses; depth maps are more forgiving and still lock limb count and
prop placement.

## Step 2 — Generation request shape

```jsonc
// POST fal-ai/flux-general
{
  "prompt": "<your existing role prompt, unchanged>",
  "loras": [
    { "path": "<trained pet LoRA url>", "scale": 0.95 }
  ],
  "controlnets": [
    {
      // union controlnet with mode, or a control-lora with
      // path set to "depth" / "pose" — check current schema
      "control_image_url": "https://<supabase>/baseball_batter_DEPTH.png",
      "conditioning_scale": 0.7,
      "start_percentage": 0,
      "end_percentage": 0.8
    }
  ],
  "num_inference_steps": 28,        // was 24; endpoint default is 28
  "guidance_scale": 4.0,
  "image_size": { "width": 820, "height": 1024 },
  "output_format": "jpeg"

  // IMPORTANT: omit reference_image_url / reference_strength entirely.
  // Reference-only guidance is the appearance-bleed path. If you keep it
  // at all, keep strength ≤ 0.3 — but try pure ControlNet first.
}
```

## Step 3 — Tuning ladder for conditioning_scale

Run the same prompt + same seed across a small grid before touching code:

| conditioning_scale | expect |
|---|---|
| 0.4 | loose — pose suggested, model still improvises limbs |
| 0.6–0.8 | **start here** — pose locked, identity/style free |
| 1.0+ | rigid — pet may contort to match the map exactly |

Also grid `end_percentage` at 0.6 / 0.8 / 1.0 — ending control early
(~0.6–0.8) lets final steps refine fur/face without fighting the map.

## Step 4 — A/B validation (one afternoon)

Same seed, same prompt, 10 generations per arm:

- **A**: current reference-only path (as-is today)
- **B**: ControlNet depth, reference-only removed

Score each image on: limb count correct / paws not hands / coat color
matches source photo / muzzle recognizable. If the appearance-bleed theory
is right, B should fix Wizard's color immediately and cut anatomy failures.

While you're in there: run one pair with and without your negative prompt
on flux-lora (same seed). If outputs are identical, the negative-prompt
section of the backend is a no-op on FLUX and can be deleted (keep it for
the Qwen fallback, where it works).

## Step 5 — Name plates move to post (separate task)

Drop GEORGE from generation prompts once compositing exists:
generate → rembg (already in pipeline) → composite warped text overlay
at the role's placement slot → Kontext finish. Deterministic spelling,
no fake-logo pollution.

## Order of operations

1. Preprocess + host 5 baseball depth maps
2. Swap reference-only → controlnets in the baseball path only
3. Run the A/B grid, pick conditioning_scale + end_percentage
4. Ship baseball; copy the pattern to Football next
5. Nameplate compositing as an independent workstream
