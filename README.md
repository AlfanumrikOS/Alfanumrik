# CBSE Answer Parser & Generator

A tiny Python library that parses exam questions, estimates the mark allocation, and produces answers formatted exactly in the CBSE board evaluation style.

## Features
- Detects question type (define, explain, differentiate, etc.)
- Rough estimate of marks based on question wording and length
- Markdown templates for 1‑6 marks with headings, bullet points and underlined NCERT keywords
- Simple CLI: `python cbse_cli.py "Define photosynthesis."`
- Extensible – add custom templates or plug into your own LLM workflow

## Installation
```bash
# From the project root (where `setup.py` would be if you publish)
pip install .  # or just add the folder to PYTHONPATH
```

## Usage (Python)
```python
from cbse_parser.generator import generate_answer

q = "Explain Ohm’s law and why current decreases when resistance increases."
print(generate_answer(q))
```

## Usage (CLI)
```bash
python cbse_cli.py "Explain Ohm’s law and why current decreases when resistance increases."
```

You can also supply a custom markdown template via `-t path/to/template.md`.

## Development
Run the test suite:
```bash
pytest
```

## Extending
- Add more NCERT keywords in `utils.NCERT_KEYWORDS`.
- Provide richer templates in `templates.TEMPLATES`.
- Replace the simple heuristic in `parser.estimate_marks` with a trained model if desired.

---
*Generated with the CBSE Answer Parsing & Generation Framework.*