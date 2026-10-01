#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Challenger M1 Round 2 Python Adversarial Test Suite
Verify faster_whisper_server.py against the 3 Round 1 failure modes.
"""

import sys
import os
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "main", "asr", "python")))
import faster_whisper_server as fws

class TestChallengerM1R2Python(unittest.TestCase):

    def test_invariant_short_word(self):
        """1. Contract invariant segment.endMs == words[-1].endMs under short duration (< 50ms)"""
        words = [{"word": "Ơ!", "startMs": 1000, "endMs": 1030}]
        segs = fws.segment_words_naturally(words)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0]["endMs"], segs[0]["words"][-1]["endMs"])
        self.assertEqual(segs[0]["startMs"], 1000)
        self.assertEqual(segs[0]["endMs"], 1030)

    def test_speaker_transition_no_overlap(self):
        """2. Speaker transition after short word does NOT cause subtitle overlap"""
        words = [
            {"word": "Ơ!", "startMs": 1000, "endMs": 1030, "speaker": "SPEAKER_00"},
            {"word": "Gì?", "startMs": 1040, "endMs": 1200, "speaker": "SPEAKER_01"},
        ]
        segs = fws.segment_words_naturally(words)
        self.assertEqual(len(segs), 2)
        self.assertLessEqual(segs[0]["endMs"], segs[1]["startMs"])
        self.assertEqual(segs[0]["endMs"], segs[0]["words"][-1]["endMs"])
        self.assertEqual(segs[1]["endMs"], segs[1]["words"][-1]["endMs"])

    def test_mixed_cjk_latin_no_word_slicing(self):
        """3. Mixed CJK + Latin visual line wrapping must NOT slice English word in half"""
        mixed = "We are testing word segmentation with 你 here today"
        wrapped = fws.wrap_visual_lines(mixed, max_chars_per_line=37)
        lines = wrapped.split("\n")
        self.assertEqual(len(lines), 2)
        for line in lines:
            self.assertLessEqual(len(line), 37)
        self.assertNotIn("segme\nntation", wrapped)
        self.assertIn("segmentation", wrapped)

    def test_overlapping_words_within_chunk(self):
        """4. Overlapping words within a chunk take the maximum endMs"""
        words = [
            {"word": "Thứ", "startMs": 1000, "endMs": 2000},
            {"word": "nhất", "startMs": 1200, "endMs": 1500},
        ]
        segs = fws.segment_words_naturally(words)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0]["startMs"], 1000)
        self.assertEqual(segs[0]["endMs"], 2000)
        self.assertEqual(segs[0]["words"][-1]["endMs"], 2000)

if __name__ == "__main__":
    unittest.main()
