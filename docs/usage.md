# Usage Guide for CBSE Answer Parser

This document walks through typical workflows:

## 1. Install the library
```bash
pip install .   # run in the project root
```

## 2. Use the Python API
```python
from cbse_parser.generator import generate_answer

question = "Explain Ohm’s law and why current decreases when resistance increases."
answer_md = generate_answer(question)
print(answer_md)
```

The output is markdown formatted according to the CBSE style (headings, bullet points, underlined keywords).

## 3. Use the CLI
```bash
python cbse_cli.py "Explain Ohm’s law and why current decreases when resistance increases."
```

You can also provide a custom markdown template:
```bash
python cbse_cli.py "Define photosynthesis." -t my_template.md
```

## 4. Extending
- **Add more NCERT keywords** – edit `cbse_parser/utils.py`.
- **Create richer templates** – modify `cbse_parser/templates.py`.
- **Swap the heuristics** – replace `parser.estimate_marks` with a more sophisticated model.

## 5. Running Tests
```bash
pytest -q
```
All tests should pass, confirming that parsing, generation, and CLI integration work correctly.

---
*Generated with the CBSE Answer Parsing & Generation Framework.*
