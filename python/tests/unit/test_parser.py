import unittest
from cbse_parser.parser import detect_question_type, estimate_marks, parse_question, extract_marks

class TestParser(unittest.TestCase):
    def test_detect_define(self):
        self.assertEqual(detect_question_type("Define photosynthesis."), "define")
        self.assertEqual(detect_question_type("What is photosynthesis?"), "define")
        self.assertEqual(detect_question_type("What are atoms?"), "define")

    def test_detect_explain(self):
        self.assertEqual(detect_question_type("Explain Ohm’s law."), "explain")

    def test_detect_differentiate(self):
        self.assertEqual(detect_question_type("Differentiate between speed and velocity."), "differentiate")
        self.assertEqual(detect_question_type("Compare metals and non-metals."), "differentiate")

    def test_detect_enumerate(self):
        self.assertEqual(detect_question_type("List out the properties of a solid."), "enumerate")
        self.assertEqual(detect_question_type("Enumerate the advantages of friction."), "enumerate")

    def test_detect_calculate(self):
        self.assertEqual(detect_question_type("Calculate the current."), "calculate")
        self.assertEqual(detect_question_type("Solve 2x + 5 = 15."), "calculate")

    def test_extract_marks(self):
        self.assertEqual(extract_marks("Define photosynthesis. [3 marks]"), 3)
        self.assertEqual(extract_marks("Explain Ohm's law (5 Marks)"), 5)
        self.assertEqual(extract_marks("What is an atom? - 2m"), 2)
        self.assertEqual(extract_marks("Differentiate between speed and velocity - worth 4 marks"), 4)
        self.assertIsNone(extract_marks("What is photosynthesis?"))

    def test_estimate_marks_explicit(self):
        self.assertEqual(estimate_marks("Explain Ohm's law (5 Marks)"), 5)
        self.assertEqual(estimate_marks("Define atom [2m]"), 2)

    def test_estimate_marks_define_short(self):
        marks = estimate_marks("Define photosynthesis.")
        self.assertEqual(marks, 1)

    def test_estimate_marks_explain_long(self):
        q = "Explain the process of photosynthesis in detail, including the light‑dependent and light‑independent reactions."
        self.assertGreaterEqual(estimate_marks(q), 3)

    def test_parse_question(self):
        qtype, marks = parse_question("Define atom.")
        self.assertEqual(qtype, "define")
        self.assertEqual(marks, 1)

if __name__ == '__main__':
    unittest.main()

