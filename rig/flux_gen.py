#!/usr/bin/env python
"""Generate ad plates with FLUX.2 on the workstation, then send them back.

Runs ON the rig via the bridge. The rig is inbound-closed, so finished PNGs are
POSTed to the ad-generator Worker, which is the only channel that reaches both
sides.

Node names and the CLIP type string are read from ComfyUI's own /object_info
rather than hard-coded — the graph is built to whatever this install actually
exposes, so a ComfyUI update cannot silently break it.
"""

import base64, io, json, os, sys, time, urllib.request, urllib.error

COMFY = "http://127.0.0.1:8188"
DROP = "https://ad-generator.fleet-fefsba.workers.dev/rig"
RIG_TOKEN = os.environ.get("RIG_TOKEN", "")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"


def get(url, timeout=120):
    r = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.load(urllib.request.urlopen(r, timeout=timeout))


def post(url, obj, timeout=120):
    r = urllib.request.Request(url, data=json.dumps(obj).encode(),
                               headers={"Content-Type": "application/json", "User-Agent": UA})
    return json.load(urllib.request.urlopen(r, timeout=timeout))


def put_bytes(name, data, ctype="image/png"):
    r = urllib.request.Request(f"{DROP}/{name}", data=data, method="POST",
                               headers={"Content-Type": ctype, "User-Agent": UA,
                                        "x-rig-token": RIG_TOKEN})
    return json.load(urllib.request.urlopen(r, timeout=180))


# ----------------------------------------------------------------- graph ---
info = get(f"{COMFY}/object_info")


def enum_of(node, field):
    try:
        return info[node]["input"]["required"][field][0]
    except Exception:
        return []


def pick(options, *needles):
    for n in needles:
        for o in options:
            if n.lower() in str(o).lower():
                return o
    return options[0] if options else None


UNET = pick(enum_of("UNETLoader", "unet_name"), "flux2_dev")
CLIPF = pick(enum_of("CLIPLoader", "clip_name"), "mistral_3_small_flux2_fp8", "mistral_3_small_flux2")
CLIPT = pick(enum_of("CLIPLoader", "type"), "flux2", "flux")
VAE = pick(enum_of("VAELoader", "vae_name"), "flux2-vae", "flux2")
LATENT = "EmptySD3LatentImage" if "EmptySD3LatentImage" in info else "EmptyLatentImage"
SAMPLERS = enum_of("KSampler", "sampler_name")
SCHEDS = enum_of("KSampler", "scheduler")
SAMPLER = pick(SAMPLERS, "euler")
SCHED = pick(SCHEDS, "simple", "normal")
print(f"[graph] unet={UNET} clip={CLIPF} type={CLIPT} vae={VAE} latent={LATENT} "
      f"sampler={SAMPLER}/{SCHED}", flush=True)
if not (UNET and CLIPF and VAE):
    print("MISSING MODEL — aborting"); sys.exit(2)


def graph(prompt, w, h, seed, steps=28, cfg=3.5):
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": UNET, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": CLIPF, "type": CLIPT}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"clip": ["2", 0], "text": prompt}},
        "5": {"class_type": "CLIPTextEncode",
              "inputs": {"clip": ["2", 0], "text": ""}},
        "6": {"class_type": LATENT,
              "inputs": {"width": w, "height": h, "batch_size": 1}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0],
                         "latent_image": ["6", 0], "seed": seed, "steps": steps,
                         "cfg": cfg, "sampler_name": SAMPLER, "scheduler": SCHED,
                         "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": "adplate"}},
    }


def run(g, label, budget=900):
    r = post(f"{COMFY}/prompt", {"prompt": g})
    pid = r["prompt_id"]
    t0 = time.time()
    while time.time() - t0 < budget:
        time.sleep(4)
        try:
            h = get(f"{COMFY}/history/{pid}", timeout=60)
        except Exception:
            continue
        if pid in h:
            outs = h[pid].get("outputs", {})
            for _, v in outs.items():
                for im in v.get("images", []):
                    q = (f"{COMFY}/view?filename={im['filename']}"
                         f"&subfolder={im.get('subfolder','')}&type={im.get('type','output')}")
                    rq = urllib.request.Request(q, headers={"User-Agent": UA})
                    data = urllib.request.urlopen(rq, timeout=180).read()
                    print(f"[done] {label} {len(data)} bytes in {int(time.time()-t0)}s", flush=True)
                    return data
            print(f"[empty] {label}", flush=True)
            return None
    print(f"[timeout] {label}", flush=True)
    return None


def crop_to(data, tw, th):
    """FLUX prefers multiples of 16; the ad sizes are exact. Centre-crop down."""
    try:
        from PIL import Image
    except ImportError:
        return data
    im = Image.open(io.BytesIO(data)).convert("RGB")
    if im.size == (tw, th):
        return data
    sc = max(tw / im.width, th / im.height)
    im = im.resize((max(tw, int(im.width * sc + 0.5)), max(th, int(im.height * sc + 0.5))),
                   Image.LANCZOS)
    left = (im.width - tw) // 2
    top = (im.height - th) // 2
    im = im.crop((left, top, left + tw, top + th))
    b = io.BytesIO(); im.save(b, "PNG")
    return b.getvalue()


# ------------------------------------------------------------------ jobs ---
JOBS = json.loads(os.environ.get("ADPLATE_JOBS", "[]"))
if not JOBS:
    print("no jobs"); sys.exit(1)

made = []
for i, j in enumerate(JOBS):
    gw = (j["w"] + 15) // 16 * 16
    gh = (j["h"] + 15) // 16 * 16
    print(f"[{i+1}/{len(JOBS)}] {j['name']} gen {gw}x{gh} -> {j['w']}x{j['h']}", flush=True)
    data = run(graph(j["prompt"], gw, gh, j.get("seed", 1000 + i)), j["name"])
    if not data:
        continue
    data = crop_to(data, j["w"], j["h"])
    try:
        res = put_bytes(j["name"], data)
        print(f"   uploaded {res}", flush=True)
        made.append(j["name"])
    except Exception as e:
        print(f"   upload failed: {e}", flush=True)

try:
    put_bytes("manifest.json", json.dumps({"made": made, "at": int(time.time())}).encode(),
              "application/json")
except Exception:
    pass
print("MADE:", made, flush=True)
