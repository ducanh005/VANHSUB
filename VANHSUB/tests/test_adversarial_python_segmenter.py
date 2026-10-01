#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Adversarial Stress Test Suite for Faster-Whisper Python Natural Word Segmenter.
Target: main/asr/python/faster_whisper_server.py: segment_words_naturally, wrap_visual_lines, format_words_text, count_units.
"""

import sys
import os
import unittest

# Ensure main/asr/python is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "main", "asr", "python")))

import faster_whisper_server as fws

class TestFasterWhisperPythonSegmenter(unittest.TestCase):

    def test_01_silence_splitting(self):
        """Test pause >= 350ms and major pause >= 700ms"""
        words = [
            {"word": "Xin", "startMs": 0, "endMs": 200},
            {"word": "chào", "startMs": 220, "endMs": 400},
            # Gap: 750 - 400 = 350ms -> MUST SPLIT
            {"word": "các", "startMs": 750, "endMs": 950},
            {"word": "bạn", "startMs": 970, "endMs": 1200},
            # Gap: 1950 - 1200 = 750ms >= 700ms -> MUST SPLIT
            {"word": "hôm", "startMs": 1950, "endMs": 2150},
            {"word": "nay", "startMs": 2170, "endMs": 2400},
        ]
        segments = fws.segment_words_naturally(words)
        self.assertEqual(len(segments), 3, f"Expected 3 segments, got {len(segments)}")
        self.assertEqual(segments[0]["text"], "Xin chào")
        self.assertEqual(segments[1]["text"], "các bạn")
        self.assertEqual(segments[2]["text"], "hôm nay")
        self.assertEqual(segments[0]["startMs"], 0)
        self.assertEqual(segments[0]["endMs"], 400)
        self.assertEqual(segments[1]["startMs"], 750)
        self.assertEqual(segments[1]["endMs"], 1200)
        self.assertEqual(segments[2]["startMs"], 1950)
        self.assertEqual(segments[2]["endMs"], 2400)

    def test_02_terminal_punctuation_splitting(self):
        """Test terminal punctuation (. ? ! 。 ？ ！ …) with >= 1500ms or >= 4 units"""
        # Case A: 4 units and terminal punct -> split
        words = [
            {"word": "Đây", "startMs": 0, "endMs": 300},
            {"word": "là", "startMs": 310, "endMs": 500},
            {"word": "câu", "startMs": 510, "endMs": 700},
            {"word": "một.", "startMs": 710, "endMs": 1000}, # 4 units, dot
            {"word": "Còn", "startMs": 1050, "endMs": 1300},
            {"word": "đây", "startMs": 1310, "endMs": 1500},
            {"word": "là", "startMs": 1510, "endMs": 1700},
            {"word": "hai!", "startMs": 1710, "endMs": 2000},
        ]
        segments = fws.segment_words_naturally(words)
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["text"], "Đây là câu một.")
        self.assertEqual(segments[1]["text"], "Còn đây là hai!")

        # Case B: short utterance (< 1500ms, < 4 units, pause < 200ms) -> keep together
        short_words = [
            {"word": "Dạ!", "startMs": 0, "endMs": 200},
            {"word": "Em", "startMs": 250, "endMs": 400},
            {"word": "hiểu.", "startMs": 450, "endMs": 700},
        ]
        short_segments = fws.segment_words_naturally(short_words)
        self.assertEqual(len(short_segments), 1)
        self.assertEqual(short_segments[0]["text"], "Dạ! Em hiểu.")

    def test_03_clause_punctuation_splitting(self):
        """Test clause punctuation (, ; : ， ； ： 、) with >= 2000ms or >= 6 units (12 CJK)"""
        # Latin 6 units + comma -> split
        words = [
            {"word": "Một", "startMs": 0, "endMs": 300},
            {"word": "hai", "startMs": 310, "endMs": 600},
            {"word": "ba", "startMs": 610, "endMs": 900},
            {"word": "bốn", "startMs": 910, "endMs": 1200},
            {"word": "năm", "startMs": 1210, "endMs": 1500},
            {"word": "sáu,", "startMs": 1510, "endMs": 1800}, # 6 units, comma
            {"word": "bảy", "startMs": 1850, "endMs": 2100},
            {"word": "tám", "startMs": 2110, "endMs": 2400},
            {"word": "chín.", "startMs": 2410, "endMs": 2700},
        ]
        segments = fws.segment_words_naturally(words)
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["text"], "Một hai ba bốn năm sáu,")
        self.assertEqual(segments[1]["text"], "bảy tám chín.")

    def test_04_hard_max_duration_ceiling(self):
        """Hard ceiling <= 6.0s must NEVER be breached even in monologues without pauses"""
        words = []
        for i in range(25): # 25 words * 300ms = 7.5s continuous
            words.append({
                "word": f"word{i}",
                "startMs": i * 300,
                "endMs": i * 300 + 280,
            })
        segments = fws.segment_words_naturally(words)
        self.assertGreaterEqual(len(segments), 2)
        for idx, seg in enumerate(segments):
            dur = seg["endMs"] - seg["startMs"]
            self.assertLessEqual(dur, 6000, f"Segment {idx} exceeded 6000ms ceiling: {dur}ms")

    def test_05_cjk_spaceless_formatting(self):
        """CJK characters must be joined without spaces, while CJK-Latin boundary gets space"""
        cjk_words = [
            {"word": "今", "startMs": 0, "endMs": 200},
            {"word": "天", "startMs": 210, "endMs": 400},
            {"word": "天", "startMs": 410, "endMs": 600},
            {"word": "气", "startMs": 610, "endMs": 800},
            {"word": "很", "startMs": 810, "endMs": 1000},
            {"word": "好", "startMs": 1010, "endMs": 1200},
            {"word": "。", "startMs": 1210, "endMs": 1300},
        ]
        segments = fws.segment_words_naturally(cjk_words)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["text"], "今天天气很好。")

        # CJK + Latin mixed
        mixed_words = [
            {"word": "使用", "startMs": 0, "endMs": 300},
            {"word": "Python", "startMs": 310, "endMs": 600},
            {"word": "编写", "startMs": 610, "endMs": 900},
        ]
        text = fws.format_words_text(mixed_words)
        self.assertEqual(text, "使用 Python 编写")

    def test_06_speaker_flips_on_every_word(self):
        """Adversarial Diarization: Speaker flips on every single word"""
        words = [
            {"word": "Hello", "startMs": 0, "endMs": 200, "speaker": "SPEAKER_00"},
            {"word": "Hi", "startMs": 210, "endMs": 400, "speaker": "SPEAKER_01"},
            {"word": "How", "startMs": 410, "endMs": 600, "speaker": "SPEAKER_00"},
            {"word": "Fine", "startMs": 610, "endMs": 800, "speaker": "SPEAKER_01"},
            {"word": "Thanks", "startMs": 810, "endMs": 1000, "speaker": "SPEAKER_00"},
            {"word": "Bye", "startMs": 1010, "endMs": 1200, "speaker": "SPEAKER_01"},
        ]
        segments = fws.segment_words_naturally(words)
        self.assertEqual(len(segments), 6, f"Expected 6 segments for alternating speakers, got {len(segments)}")
        expected_speakers = ["SPEAKER_00", "SPEAKER_01", "SPEAKER_00", "SPEAKER_01", "SPEAKER_00", "SPEAKER_01"]
        for i, seg in enumerate(segments):
            self.assertEqual(seg["speaker"], expected_speakers[i])
            self.assertEqual(seg["text"], words[i]["word"])
            self.assertEqual(seg["startMs"], words[i]["startMs"])
            self.assertEqual(seg["endMs"], words[i]["endMs"])

    def test_07_speaker_undefined_and_null_edge_cases(self):
        """Speaker undefined / None / empty string edge cases"""
        # All undefined
        words_undef = [
            {"word": "Một", "startMs": 0, "endMs": 300},
            {"word": "hai", "startMs": 310, "endMs": 600},
        ]
        segments = fws.segment_words_naturally(words_undef)
        self.assertEqual(len(segments), 1)
        self.assertIsNone(segments[0]["speaker"])

        # Word 0 undefined, Word 1 defined
        words_partial1 = [
            {"word": "Một", "startMs": 0, "endMs": 300},
            {"word": "hai", "startMs": 310, "endMs": 600, "speaker": "SPEAKER_01"},
        ]
        segments1 = fws.segment_words_naturally(words_partial1)
        # Because cur_word.get('speaker') is None, no speaker transition is triggered -> 1 segment
        self.assertEqual(len(segments1), 1)
        self.assertIsNone(segments1[0]["speaker"])

        # Word 0 defined, Word 1 undefined
        words_partial2 = [
            {"word": "Một", "startMs": 0, "endMs": 300, "speaker": "SPEAKER_00"},
            {"word": "hai", "startMs": 310, "endMs": 600},
        ]
        segments2 = fws.segment_words_naturally(words_partial2)
        # Because next_word.get('speaker') is None, no speaker transition is triggered -> 1 segment
        self.assertEqual(len(segments2), 1)
        self.assertEqual(segments2[0]["speaker"], "SPEAKER_00")

        # Speaker is empty string ""
        words_empty_spk = [
            {"word": "Một", "startMs": 0, "endMs": 300, "speaker": ""},
            {"word": "hai", "startMs": 310, "endMs": 600, "speaker": "SPEAKER_01"},
        ]
        segments3 = fws.segment_words_naturally(words_empty_spk)
        self.assertEqual(len(segments3), 1)

    def test_08_empty_and_abnormal_inputs(self):
        """Empty inputs, None, 0 duration, inverted timestamps"""
        self.assertEqual(fws.segment_words_naturally([]), [])
        self.assertEqual(fws.segment_words_naturally(None), [])

        # Non-dict or empty word items
        words_corrupt = [
            None,
            {},
            {"word": ""},
            {"word": "   "},
            {"word": "Valid", "startMs": 100, "endMs": 300},
        ]
        segments = fws.segment_words_naturally(words_corrupt)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["text"], "Valid")

        # Inverted timestamps: endMs < startMs (e.g. 500ms to 400ms)
        # Should sanitize endMs >= startMs + 30
        inverted = [{"word": "Test", "startMs": 500, "endMs": 400}]
        seg_inv = fws.segment_words_naturally(inverted)
        self.assertEqual(len(seg_inv), 1)
        self.assertEqual(seg_inv[0]["startMs"], 500)
        self.assertGreaterEqual(seg_inv[0]["endMs"], 530)

    def test_09_exact_timestamps_no_gaps(self):
        """Exact startMs and endMs from acoustic words, no artificial Netflix gap dilation"""
        words = [
            {"word": "A", "startMs": 1000, "endMs": 1300},
            {"word": "B", "startMs": 1320, "endMs": 1600},
            # silence gap = 400ms >= 350ms
            {"word": "C", "startMs": 2000, "endMs": 2300},
            {"word": "D", "startMs": 2310, "endMs": 2600},
        ]
        segments = fws.segment_words_naturally(words)
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["startMs"], 1000)
        self.assertEqual(segments[0]["endMs"], 1600)
        self.assertEqual(segments[1]["startMs"], 2000)
        self.assertEqual(segments[1]["endMs"], 2600)
        # Gap between segments is 2000 - 1600 = 400ms exactly
        self.assertEqual(segments[1]["startMs"] - segments[0]["endMs"], 400)

if __name__ == "__main__":
    unittest.main(verbosity=2)
