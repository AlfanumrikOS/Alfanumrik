from .parser import parse_question
from .templates import get_template
from .utils import underline_keywords

def generate_answer(question: str, custom_template: str = None) -> str:
    """Generate a CBSE‑style answer for *question*.

    Steps:
    1. Detect the question type and estimate marks.
    2. Retrieve a markdown template matching the marks.
    3. Build a *definition* section – for “define” questions we extract the term;
       otherwise we fall back to using the full question text so that keywords appear.
    4. Produce placeholder points (one per expected mark).
    5. Underline NCERT keywords, except for pure definition answers.
    """
    qtype, marks = parse_question(question)
    template = custom_template or get_template(marks)

    # Extract definition for define questions
    definition = ""
    if qtype == "define":
        import re
        m = re.search(r"Define\s+([^\.]+)", question, re.IGNORECASE)
        if m:
            definition = f"**{m.group(1).strip()}** is defined as ..."
    # Fallback: use the whole question as definition/introduction
    if not definition:
        definition = question.strip()

    # Generate placeholder points, one per expected mark
    points = [f"**Point {i}**: Explain the concept here." for i in range(1, marks + 1)]
    points_md = "\n- ".join(points)

    answer = template.format(definition=definition, points=points_md)

    # Underline keywords unless this is a pure definition answer
    if qtype != "define":
        answer = underline_keywords(answer)

    return answer
