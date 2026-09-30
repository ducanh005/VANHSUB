#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Faster-Whisper & Speaker Diarization Sidecar Server for Vanhsub.
Performs CTranslate2-accelerated speech-to-text with word-level timestamps
and optional speaker diarization (Pyannote or acoustic clustering fallback).
Communicates with Node.js via newline-delimited JSON messages on stdout.
"""

import argparse
import json
import math
import os
import sys
import wave

# Compatibility fix: PyAV >= 14.0.0 / 19.0.0 removed the `metadata_errors` keyword argument
# from `av.open()`, but faster-whisper (v1.x) still passes `metadata_errors="ignore"` in `decode_audio()`.
try:
    import av
    _orig_av_open = av.open
    def _patched_av_open(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return _orig_av_open(*args, **kwargs)
    av.open = _patched_av_open
    try:
        import faster_whisper.audio
        faster_whisper.audio.av.open = _patched_av_open
    except Exception:
        pass
except Exception:
    pass

def emit(msg_type, **kwargs):
    payload = {"type": msg_type, **kwargs}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def format_timestamp(seconds: float) -> str:
    clamped = max(0.0, float(seconds))
    total_ms = int(round(clamped * 1000.0))
    h = total_ms // 3600000
    m = (total_ms % 3600000) // 60000
    s = (total_ms % 60000) // 1000
    ms = total_ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def get_audio_duration_sec(audio_path: str) -> float:
    try:
        with wave.open(audio_path, 'rb') as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate > 0:
                return float(frames) / float(rate)
    except Exception:
        pass
    return 0.0

def run_diarization_pyannote(audio_path: str, hf_token: str, num_speakers: int = None):
    try:
        from pyannote.audio import Pipeline
        auth_param = {"use_auth_token": hf_token} if hf_token else {}
        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", **auth_param)
        if pipeline is None:
            return None
        
        params = {}
        if num_speakers and num_speakers > 0:
            params["num_speakers"] = int(num_speakers)
        
        diarization = pipeline(audio_path, **params)
        intervals = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            intervals.append({
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": str(speaker)
            })
        return intervals
    except Exception as e:
        emit("warning", msg=f"Pyannote diarization unavailable: {str(e)}")
        return None

def extract_simple_acoustic_features(audio_path: str, start_sec: float, end_sec: float):
    """
    Extracts lightweight acoustic features (RMS energy, zero-crossing rate)
    from WAV chunk to separate speakers by voice characteristics when Pyannote is absent.
    """
    try:
        with wave.open(audio_path, 'rb') as wf:
            rate = wf.getframerate()
            sampwidth = wf.getsampwidth()
            nchannels = wf.getnchannels()
            start_frame = int(start_sec * rate)
            end_frame = int(end_sec * rate)
            count = max(1, end_frame - start_frame)
            wf.setpos(min(start_frame, wf.getnframes() - 1))
            raw = wf.readframes(count)
            if not raw or sampwidth != 2:
                return [0.0, 0.0]
            
            import struct
            fmt = f"<{len(raw)//2}h"
            samples = struct.unpack(fmt, raw)
            if nchannels > 1:
                samples = samples[::nchannels]
            
            if not samples:
                return [0.0, 0.0]
            
            # RMS Energy
            sq_sum = sum(s * s for s in samples)
            rms = math.sqrt(sq_sum / len(samples))
            
            # Zero-Crossing Rate
            zcr = 0
            for i in range(1, len(samples)):
                if (samples[i] >= 0 and samples[i - 1] < 0) or (samples[i] < 0 and samples[i - 1] >= 0):
                    zcr += 1
            zcr_rate = float(zcr) / float(len(samples))
            return [rms, zcr_rate]
    except Exception:
        return [0.0, 0.0]

def run_standalone_clustering(audio_path: str, segments_data: list, num_speakers: int = 2):
    """
    Clusters segments into speakers using acoustic features.
    """
    if not segments_data:
        return []
    
    n_speakers = max(1, min(len(segments_data), num_speakers or 2))
    features = [extract_simple_acoustic_features(audio_path, seg["start"], seg["end"]) for seg in segments_data]
    
    try:
        from sklearn.cluster import KMeans
        import numpy as np
        X = np.array(features)
        # Normalize features
        std = np.std(X, axis=0)
        std[std == 0] = 1.0
        X_norm = (X - np.mean(X, axis=0)) / std
        kmeans = KMeans(n_clusters=n_speakers, random_state=42, n_init='auto')
        labels = kmeans.fit_predict(X_norm)
        return [f"SPEAKER_{label:02d}" for label in labels]
    except Exception:
        # Fallback without sklearn: sort by RMS energy and partition into 2 groups
        if n_speakers > 1 and len(features) > 1:
            energies = [f[0] for f in features]
            median_e = sorted(energies)[len(energies) // 2]
            return [f"SPEAKER_{0:02d}" if f[0] >= median_e else f"SPEAKER_{1:02d}" for f in features]
        return ["SPEAKER_00"] * len(segments_data)

def match_speaker_to_segment(seg_start: float, seg_end: float, intervals: list) -> str:
    """Finds speaker with greatest temporal overlap with segment [seg_start, seg_end]."""
    if not intervals:
        return "SPEAKER_00"
    
    best_speaker = "SPEAKER_00"
    max_overlap = 0.0
    for it in intervals:
        overlap = max(0.0, min(seg_end, it["end"]) - max(seg_start, it["start"]))
        if overlap > max_overlap:
            max_overlap = overlap
            best_speaker = it["speaker"]
    return best_speaker

def main():
    parser = argparse.ArgumentParser(description="Faster-Whisper & Diarization Sidecar")
    parser.add_argument("--audio", required=True, help="Input audio WAV file")
    parser.add_argument("--output", required=True, help="Output SRT file path")
    parser.add_argument("--model", default="base", help="Model name: tiny, base, small, medium, large-v3-turbo")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"], help="Compute device")
    parser.add_argument("--compute_type", default="auto", help="Compute type: float16, int8, int8_float16, float32")
    parser.add_argument("--language", default="vi", help="Audio language code (e.g. vi, en, auto)")
    parser.add_argument("--word_timestamps", action="store_true", default=True, help="Generate word-level timestamps")
    parser.add_argument("--diarize", action="store_true", default=False, help="Enable speaker diarization")
    parser.add_argument("--num_speakers", type=int, default=None, help="Hint for number of speakers")
    parser.add_argument("--hf_token", default="", help="HuggingFace token for gated diarization models")
    parser.add_argument("--models_dir", default=None, help="Directory to store downloaded models")
    args = parser.parse_args()

    audio_path = os.path.abspath(args.audio)
    output_path = os.path.abspath(args.output)

    if not os.path.exists(audio_path):
        emit("error", message=f"Audio file not found: {audio_path}")
        sys.exit(1)

    # 1. Device and Compute Type Resolution
    device = args.device
    compute_type = args.compute_type

    if device == "auto":
        has_cuda = False
        try:
            import torch
            has_cuda = torch.cuda.is_available()
        except Exception:
            pass

        if has_cuda:
            device = "cuda"
            if compute_type == "auto":
                compute_type = "float16"
        else:
            device = "cpu"
            if compute_type == "auto":
                compute_type = "int8"
    else:
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"

    # 2. Instantiate Faster-Whisper Model with fallback to CPU
    model = None
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        emit("error", message=f"Gói faster-whisper chưa được cài đặt trong môi trường Python: {str(e)}")
        sys.exit(2)

    download_root = args.models_dir or os.path.join(os.path.expanduser("~"), ".cache", "vanhsub-whisper")
    os.makedirs(download_root, exist_ok=True)

    try:
        emit("progress", percent=5, stage=f"Đang tải model {args.model} ({device} / {compute_type})...")
        model = WhisperModel(args.model, device=device, compute_type=compute_type, download_root=download_root)
    except Exception as e:
        if device == "cuda":
            emit("warning", msg=f"Lỗi khởi tạo CUDA ({str(e)}), tự động chuyển sang CPU int8...")
            device = "cpu"
            compute_type = "int8"
            try:
                model = WhisperModel(args.model, device="cpu", compute_type="int8", download_root=download_root)
            except Exception as e2:
                emit("error", message=f"Không thể khởi tạo WhisperModel trên CPU: {str(e2)}")
                sys.exit(3)
        else:
            emit("error", message=f"Không thể khởi tạo WhisperModel: {str(e)}")
            sys.exit(3)

    emit("ready", device=device, compute_type=compute_type, model=args.model)

    # 3. Transcribe Audio
    duration_sec = get_audio_duration_sec(audio_path)
    emit("progress", percent=10, stage="Đang nhận diện giọng nói...")

    lang_opt = None if args.language == "auto" else args.language

    try:
        segments_gen, info = model.transcribe(
            audio_path,
            language=lang_opt,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            word_timestamps=args.word_timestamps
        )
        total_duration = info.duration if info.duration and info.duration > 0 else duration_sec

        collected_segments = []
        all_words = []

        for seg in segments_gen:
            words_data = []
            if seg.words:
                for w in seg.words:
                    word_obj = {
                        "word": w.word.strip(),
                        "startMs": int(round(w.start * 1000.0)),
                        "endMs": int(round(w.end * 1000.0)),
                        "probability": float(getattr(w, 'probability', 1.0))
                    }
                    words_data.append(word_obj)
                    all_words.append(word_obj)

            collected_segments.append({
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip(),
                "words": words_data
            })

            if total_duration > 0:
                pct = min(85, 10 + int((seg.end / total_duration) * 75))
                emit("progress", percent=pct, stage=f"Đang phiên âm: {format_timestamp(seg.end)} / {format_timestamp(total_duration)}")

    except Exception as e:
        emit("error", message=f"Lỗi trong quá trình phiên âm Faster-Whisper: {str(e)}")
        sys.exit(4)

    # 4. Speaker Diarization if requested
    distinct_speakers = set()
    if args.diarize and collected_segments:
        emit("progress", percent=88, stage="Đang phân tích và gắn nhãn người nói (Diarization)...")
        intervals = None
        if args.hf_token:
            intervals = run_diarization_pyannote(audio_path, args.hf_token, args.num_speakers)

        if intervals:
            for seg in collected_segments:
                spk = match_speaker_to_segment(seg["start"], seg["end"], intervals)
                seg["speaker"] = spk
                distinct_speakers.add(spk)
                for w in seg["words"]:
                    w["speaker"] = spk
        else:
            # Standalone acoustic clustering fallback
            cluster_labels = run_standalone_clustering(audio_path, collected_segments, args.num_speakers or 2)
            for i, seg in enumerate(collected_segments):
                spk = cluster_labels[i] if i < len(cluster_labels) else "SPEAKER_00"
                seg["speaker"] = spk
                distinct_speakers.add(spk)
                for w in seg["words"]:
                    w["speaker"] = spk
    elif collected_segments:
        # Default single speaker if not diarizing
        distinct_speakers.add("SPEAKER_00")

    # 5. Write SRT File
    emit("progress", percent=95, stage="Đang xuất file phụ đề SRT...")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as srt_file:
        for idx, seg in enumerate(collected_segments):
            start_str = format_timestamp(seg["start"])
            end_str = format_timestamp(seg["end"])
            text = seg["text"]
            
            if args.diarize and "speaker" in seg and seg["speaker"]:
                line_content = f"[{seg['speaker']}]: {text}"
            else:
                line_content = text

            srt_file.write(f"{idx + 1}\n{start_str} --> {end_str}\n{line_content}\n\n")

    emit(
        "done",
        srtPath=output_path,
        speakers=sorted(list(distinct_speakers)),
        segmentCount=len(collected_segments),
        words=all_words
    )
    sys.exit(0)

if __name__ == "__main__":
    main()
