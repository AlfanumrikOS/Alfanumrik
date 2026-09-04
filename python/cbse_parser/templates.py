# Templates for different mark ranges
# Each template is a markdown string with placeholders {definition} and {points}

TEMPLATES = {
    1: "{definition}\n",
    2: "{definition}\n- {points}\n",
    3: "{definition}\n- {points}\n",
    4: "## Answer\n\n{definition}\n\n### Points\n- {points}\n",
    5: "## Answer\n\n{definition}\n\n### Detailed Points\n- {points}\n",
    6: "## Answer\n\n{definition}\n\n### Comprehensive Explanation\n- {points}\n",
}

def get_template(marks: int) -> str:
    """Return a markdown template for the given *marks*.
    If marks exceed the highest defined, use the largest template.
    """
    if marks in TEMPLATES:
        return TEMPLATES[marks]
    # fallback to highest available
    max_key = max(TEMPLATES.keys())
    return TEMPLATES[max_key]
