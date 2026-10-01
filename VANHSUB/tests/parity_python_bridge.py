#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Helper bridge to run Faster-Whisper Python segment_words_naturally from Node.js.
Reads JSON array of words from stdin, outputs JSON array of segments to stdout.
"""

import sys
import os
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "main", "asr", "python")))
import faster_whisper_server as fws

def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            sys.stdout.write("[]\n")
            return
        data = json.loads(raw_input)
        words = data.get("words", [])
        max_chars = data.get("maxCharsPerLine", 37)
        segments = fws.segment_words_naturally(words, max_chars_per_line=max_chars)
        sys.stdout.write(json.dumps(segments, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write(f"Bridge Error: {str(e)}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
