import unittest
from unittest.mock import AsyncMock, patch
from cbse_parser.generator import generate_answer

class TestGenerator(unittest.IsolatedAsyncioTestCase):
    async def test_one_mark(self):
        q = "Define photosynthesis."
        ans = await generate_answer(q)
        # Should contain a definition line and no bullet list
        self.assertIn("**photosynthesis**", ans.lower() or "")
        self.assertNotIn("- Point", ans)

    async def test_three_mark(self):
        q = "Explain Ohm’s law and why current decreases when resistance increases."
        ans = await generate_answer(q)
        # Should contain at least three bullet points
        self.assertGreaterEqual(ans.count("- **Point"), 3)
        # Should underline keywords like "current" and "resistance"
        self.assertIn("<u>current</u>", ans.lower())
        self.assertIn("<u>resistance</u>", ans.lower())

    @patch("cbse_parser.generator.generate_response")
    async def test_generator_llm_success(self, mock_generate):
        mock_result = AsyncMock()
        mock_result.text = "This is a mock answer from the LLM about photosynthesis and resistance."
        mock_generate.return_value = mock_result

        q = "Explain Ohm's law."
        ans = await generate_answer(q)

        # Verify generate_response was called
        mock_generate.assert_called_once()
        req = mock_generate.call_args[0][0]

        # Assertions on Request
        self.assertEqual(req.task_type, "explanation")
        self.assertEqual(req.input.question, q)
        self.assertIn("CBSE", req.config.system_prompt_override)

        # Assertions on Response
        self.assertIn("mock answer", ans)
        # Should underline resistance
        self.assertIn("<u>resistance</u>", ans.lower())

if __name__ == '__main__':
    unittest.main()

