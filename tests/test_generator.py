import unittest
from cbse_parser.generator import generate_answer

class TestGenerator(unittest.TestCase):
    def test_one_mark(self):
        q = "Define photosynthesis."
        ans = generate_answer(q)
        # Should contain a definition line and no bullet list
        self.assertIn("**photosynthesis**", ans.lower() or "")
        self.assertNotIn("- Point", ans)

    def test_three_mark(self):
        q = "Explain Ohm’s law and why current decreases when resistance increases."
        ans = generate_answer(q)
        # Should contain at least three bullet points
        self.assertGreaterEqual(ans.count("- **Point"), 3)
        # Should underline keywords like "current" and "resistance"
        self.assertIn("<u>current</u>", ans.lower())
        self.assertIn("<u>resistance</u>", ans.lower())

if __name__ == '__main__':
    unittest.main()
