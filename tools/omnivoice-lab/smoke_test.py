#!/usr/bin/env python3
"""Generate a small OmniVoice sample and report basic performance."""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import time

import numpy as np
import soundfile as sf
import torch
from omnivoice import OmniVoice


ROOT = pathlib.Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "outputs"
SAMPLES = {
    "zh": "你好，这是一个中文发音测试。",
    "th": "สวัสดีครับ นี่คือการทดสอบเสียงภาษาไทย",
    "cardify": "爱 ài ความรัก",
    "en": "Hello, this is a quick local text to speech test.",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one OmniVoice smoke test.")
    parser.add_argument("--model", default="k2-fsa/OmniVoice")
    parser.add_argument("--device", default="mps")
    parser.add_argument("--dtype", default="float16", choices=["float16", "bfloat16", "float32"])
    parser.add_argument("--sample", default="zh", choices=sorted(SAMPLES))
    parser.add_argument("--text", default=None)
    parser.add_argument("--language", default="Auto")
    parser.add_argument("--mode", default="design", choices=["auto", "design"])
    parser.add_argument("--instruct", default="female, moderate pitch")
    parser.add_argument("--num-step", type=int, default=16)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--duration", type=float, default=None)
    return parser.parse_args()


def dtype_from_name(name: str) -> torch.dtype:
    if name == "float16":
        return torch.float16
    if name == "bfloat16":
        return torch.bfloat16
    return torch.float32


def main() -> int:
    args = parse_args()
    text = args.text or SAMPLES[args.sample]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading {args.model} on {args.device} ({args.dtype})")
    load_started = time.perf_counter()
    model = OmniVoice.from_pretrained(args.model, device_map=args.device, dtype=dtype_from_name(args.dtype))
    load_elapsed = time.perf_counter() - load_started

    kwargs = {
        "text": text,
        "num_step": args.num_step,
        "speed": args.speed,
    }
    if args.language.lower() not in {"auto", "none"}:
        kwargs["language"] = args.language
    if args.duration and args.duration > 0:
        kwargs["duration"] = args.duration
    if args.mode == "design":
        kwargs["instruct"] = args.instruct

    print(f"Generating {len(text)} chars with steps={args.num_step}")
    gen_started = time.perf_counter()
    audio = model.generate(**kwargs)
    gen_elapsed = time.perf_counter() - gen_started

    samples = np.asarray(audio[0])
    sample_rate = int(getattr(model, "sampling_rate", 24000))
    output_seconds = len(samples) / sample_rate
    rtf = gen_elapsed / output_seconds if output_seconds > 0 else float("inf")
    output_path = OUTPUT_DIR / f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-smoke-{args.sample}.wav"
    sf.write(output_path, samples, sample_rate)

    print(f"Saved: {output_path}")
    print(f"Load time: {load_elapsed:.2f}s")
    print(f"Generation time: {gen_elapsed:.2f}s")
    print(f"Output duration: {output_seconds:.2f}s")
    print(f"RTF: {rtf:.3f}")
    print(f"Sample rate: {sample_rate}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
