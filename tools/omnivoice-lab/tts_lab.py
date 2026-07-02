#!/usr/bin/env python3
"""Small local OmniVoice tester for Cardify TTS experiments."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import pathlib
import time
from typing import Any

import gradio as gr
import numpy as np
import soundfile as sf
import torch

from omnivoice import OmniVoice


ROOT = pathlib.Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "outputs"
DEFAULT_TEXT = "你好，这是一个中文发音测试。"
THAI_TEXT = "สวัสดีครับ นี่คือการทดสอบเสียงภาษาไทย"
CARDIFY_TEXT = "爱 ài ความรัก"

MODEL: OmniVoice | None = None
MODEL_CONFIG: dict[str, Any] | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a local OmniVoice TTS test UI.")
    parser.add_argument("--model", default=os.environ.get("OMNIVOICE_MODEL", "k2-fsa/OmniVoice"))
    parser.add_argument("--device", default=os.environ.get("OMNIVOICE_DEVICE", "mps"))
    parser.add_argument("--dtype", default=os.environ.get("OMNIVOICE_DTYPE", "float16"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--share", action="store_true")
    return parser.parse_args()


def dtype_from_name(name: str) -> torch.dtype:
    normalized = (name or "float16").lower()
    if normalized in {"float16", "fp16", "half"}:
        return torch.float16
    if normalized in {"bfloat16", "bf16"}:
        return torch.bfloat16
    if normalized in {"float32", "fp32"}:
        return torch.float32
    raise ValueError(f"Unsupported dtype: {name}")


def get_model(model_name: str, device: str, dtype_name: str) -> OmniVoice:
    global MODEL, MODEL_CONFIG
    config = {"model": model_name, "device": device, "dtype": dtype_name}
    if MODEL is not None and MODEL_CONFIG == config:
        return MODEL

    dtype = dtype_from_name(dtype_name)
    started = time.perf_counter()
    MODEL = OmniVoice.from_pretrained(model_name, device_map=device, dtype=dtype)
    MODEL_CONFIG = config
    elapsed = time.perf_counter() - started
    print(f"Loaded {model_name} on {device} with {dtype_name} in {elapsed:.1f}s")
    return MODEL


def generate_audio(
    text: str,
    mode: str,
    language: str,
    instruct: str,
    ref_audio: str | None,
    ref_text: str,
    num_step: int,
    guidance_scale: float,
    speed: float,
    duration: float | None,
    denoise: bool,
    postprocess_output: bool,
    model_name: str,
    device: str,
    dtype_name: str,
) -> tuple[str | None, str]:
    text = (text or "").strip()
    if not text:
        return None, "Enter text first."

    model = get_model(model_name, device, dtype_name)
    kwargs: dict[str, Any] = {
        "text": text,
        "num_step": int(num_step),
        "guidance_scale": float(guidance_scale),
        "speed": float(speed),
        "denoise": bool(denoise),
        "postprocess_output": bool(postprocess_output),
    }

    if language and language.strip().lower() not in {"auto", "none"}:
        kwargs["language"] = language.strip()
    if duration is not None and float(duration) > 0:
        kwargs["duration"] = float(duration)

    clean_mode = mode.lower().replace(" ", "-")
    if clean_mode == "voice-design":
        if instruct and instruct.strip():
            kwargs["instruct"] = instruct.strip()
    elif clean_mode == "voice-cloning":
        if not ref_audio:
            return None, "Voice cloning needs a 3-10 second reference audio file."
        kwargs["ref_audio"] = ref_audio
        if ref_text and ref_text.strip():
            kwargs["ref_text"] = ref_text.strip()

    started = time.perf_counter()
    audio = model.generate(**kwargs)
    elapsed = time.perf_counter() - started

    samples = np.asarray(audio[0])
    sample_rate = int(getattr(model, "sampling_rate", 24000))
    output_seconds = len(samples) / sample_rate if sample_rate else 0
    rtf = elapsed / output_seconds if output_seconds > 0 else float("inf")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    output_path = OUTPUT_DIR / f"{stamp}-{clean_mode}.wav"
    sf.write(output_path, samples, sample_rate)

    status = "\n".join(
        [
            f"Saved: {output_path}",
            f"Text chars: {len(text)}",
            f"Output: {output_seconds:.2f}s at {sample_rate} Hz",
            f"Elapsed: {elapsed:.2f}s",
            f"RTF: {rtf:.3f}",
            f"Device: {device}, dtype: {dtype_name}, steps: {num_step}",
        ]
    )
    return str(output_path), status


def build_ui(args: argparse.Namespace) -> gr.Blocks:
    with gr.Blocks(title="Cardify OmniVoice TTS Lab") as demo:
        gr.Markdown("# Cardify OmniVoice TTS Lab\nGenerate local speech samples before Cardify integration.")
        with gr.Row():
            with gr.Column(scale=2):
                text = gr.Textbox(
                    label="Text",
                    value=DEFAULT_TEXT,
                    lines=5,
                    placeholder="Enter Chinese, Thai, English, or mixed Cardify text.",
                )
                with gr.Row():
                    gr.Button("Chinese sample").click(lambda: DEFAULT_TEXT, outputs=text)
                    gr.Button("Thai sample").click(lambda: THAI_TEXT, outputs=text)
                    gr.Button("Cardify sample").click(lambda: CARDIFY_TEXT, outputs=text)
                mode = gr.Radio(
                    ["Auto voice", "Voice design", "Voice cloning"],
                    value="Voice design",
                    label="Mode",
                )
                language = gr.Textbox(label="Language", value="Auto", placeholder="Auto, Chinese, Thai, English, zh, th, en")
                instruct = gr.Textbox(
                    label="Voice design instruction",
                    value="female, moderate pitch",
                    lines=2,
                    placeholder="female, low pitch, british accent",
                )
                ref_audio = gr.Audio(label="Reference audio for voice cloning", type="filepath")
                ref_text = gr.Textbox(label="Reference text", lines=2)
            with gr.Column(scale=1):
                model_name = gr.Textbox(label="Model", value=args.model)
                device = gr.Textbox(label="Device", value=args.device)
                dtype_name = gr.Dropdown(["float16", "bfloat16", "float32"], value=args.dtype, label="dtype")
                num_step = gr.Slider(4, 64, value=16, step=1, label="Inference steps")
                guidance_scale = gr.Slider(0.0, 4.0, value=2.0, step=0.1, label="Guidance scale")
                speed = gr.Slider(0.5, 1.5, value=1.0, step=0.05, label="Speed")
                duration = gr.Number(label="Fixed duration seconds", value=None)
                denoise = gr.Checkbox(label="Denoise", value=True)
                postprocess_output = gr.Checkbox(label="Postprocess output", value=True)

        generate = gr.Button("Generate voice", variant="primary")
        audio_output = gr.Audio(label="Generated audio", type="filepath")
        status = gr.Textbox(label="Status", lines=8)
        generate.click(
            generate_audio,
            inputs=[
                text,
                mode,
                language,
                instruct,
                ref_audio,
                ref_text,
                num_step,
                guidance_scale,
                speed,
                duration,
                denoise,
                postprocess_output,
                model_name,
                device,
                dtype_name,
            ],
            outputs=[audio_output, status],
        )
    return demo


def main() -> int:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    demo = build_ui(args)
    demo.queue().launch(server_name=args.host, server_port=args.port, share=args.share)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
