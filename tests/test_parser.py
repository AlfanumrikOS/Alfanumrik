import unittest
from cbse_parser.parser import detect_question_type, estimate_marks, parse_question

class TestParser(unittest.TestCase):
    def test_detect_define(self):
        self.assertEqual(detect_question_type("Define photosynthesis."), "define")

    def test_detect_explain(self):
        self.assertEqual(detect_question_type("Explain Ohm’s law."), "explain")

    def test_estimate_marks_define_short(self):
        marks = estimate_marks("Define photosynthesis.")
        self.assertIn(marks, [1, 2])

    def test_estimate_marks_explain_long(self):
        q = "Explain the process of photosynthesis in detail, including the light‑dependent and light‑independent reactions."
        self.assertGreaterEqual(estimate_marks(q), 3)

    def test_parse_question(self):
        qtype, marks = parse_question("Define atom.")
        self.assertEqual(qtype, "define")
        self.assertIsInstance(marks, int)

if __name__ == '__main__':
    unittest.main()
