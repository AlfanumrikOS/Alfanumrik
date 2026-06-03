import sys
import os
import re

# Resolve imports for services
try:
    from python.services.ai.mol.orchestrator import generate_response
    from python.services.ai.mol.types import GenerateRequest, GenerateInput, StudentContext, GenerateConfig
except ImportError:
    python_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python")
    if python_dir not in sys.path:
        sys.path.append(python_dir)
    from services.ai.mol.orchestrator import generate_response
    from services.ai.mol.types import GenerateRequest, GenerateInput, StudentContext, GenerateConfig

from .parser import parse_question
from .templates import get_template
from .utils import underline_keywords

def build_cbse_system_prompt(qtype: str, marks: int) -> str:
    """Build a detailed CBSE system prompt based on detected question type and marks."""
    prompt = (
        "Act as a CBSE board-paper evaluator following official marking scheme methodology. "
        "Parse the question into probable mark-distribution units and generate the answer in examiner-friendly format.\n\n"
        "Ensure:\n"
        f"- The answer is structured for exactly {marks} marks.\n"
        f"- Use exactly {marks} visible, visually separable value points/units. Each unit should be capable of independently receiving a tick.\n"
        "- Use strict NCERT terminology. Avoid casual wording (e.g. write 'resistance increases, current decreases according to Ohm's law' instead of 'current becomes less').\n"
        "- State scientific/mathematical laws and cause-and-effect chains explicitly.\n"
        "- Balance evaluator readability with a warm, teacher-like explanatory tone.\n"
        "- Avoid: abstract philosophical explanations, skipping formulas/units, and implicit reasoning.\n\n"
    )

    # Add question-type specific instructions
    prompt += "### Question Type Guidelines:\n"
    if qtype == "define":
        prompt += (
            "- This is a definition question. Provide a concise, exact NCERT definition in 1 crisp line.\n"
            "- Avoid elaboration or explanation unless explicitly asked.\n"
        )
    elif qtype == "explain":
        prompt += (
            "- This is an explanation question. Structure as: concept explanation + reasoning + concrete example.\n"
        )
    elif qtype == "differentiate":
        prompt += (
            "- This is a differentiation/comparison question. A point-by-point comparative markdown table is MANDATORY.\n"
            "- Do not write in prose; use a table to compare key features side-by-side.\n"
        )
    elif qtype == "why":
        prompt += (
            "- This is a 'why' question. Explicitly outline a clear cause-effect chain.\n"
        )
    elif qtype == "how":
        prompt += (
            "- This is a 'how' question. Present the process sequence in clear chronological or procedural steps.\n"
        )
    elif qtype == "discuss":
        prompt += (
            "- This is a discussion question. Provide a balanced multi-point structure with headings/subheadings.\n"
        )
    elif qtype == "enumerate":
        prompt += (
            "- This is an enumeration/list question. Use bullet points ONLY. Do not write paragraphs.\n"
        )
    elif qtype == "derive":
        prompt += (
            "- This is a derivation. Show stepwise mathematical or scientific derivation line-by-line.\n"
        )
    elif qtype == "calculate":
        prompt += (
            "- This is a numerical/calculation question. Show stepwise working using this exact line-by-line format:\n"
            "  Given: <values with units>\n"
            "  Formula: <formula first>\n"
            "  Substitution: <step-by-step substitution>\n"
            "  Calculation: <intermediate calculation steps>\n"
            "  Final Answer: <emphasized/boxed final answer with correct units>\n"
            "- Never skip intermediate steps, show formulas first, and include units everywhere.\n"
        )
    else:
        prompt += (
            "- Structure the answer clearly according to CBSE value points.\n"
        )

    # Add mark-specific formatting guidelines
    prompt += f"\n### Mark-Specific Layout Guidelines ({marks} Marks):\n"
    if marks == 1:
        prompt += (
            "- Output exactly 1 crisp, concise line or sentence containing the key NCERT definition/fact.\n"
            "- No storytelling, no introduction, no explanation.\n"
        )
    elif marks in {2, 3}:
        prompt += (
            f"- Output exactly {marks} distinct, self-contained bullet points.\n"
            "- Each bullet should correspond to one mark and express one key examinable idea.\n"
            "- Keep sentences short and direct.\n"
        )
    elif marks >= 4:
        prompt += (
            f"- Output an introduction block followed by {marks} structured bullet points or steps.\n"
            "- Use clear headings and subheadings for separate points.\n"
            "- Avoid giant paragraphs.\n"
        )

    # Subject-specific formatting guidelines if we can detect it, or general preferences:
    prompt += (
        "\n### Presentation & Underlining Guidelines:\n"
        "- STRICTLY NO ASTERISKS (**). Do not use markdown bold (**) for emphasis anywhere in your response.\n"
        "- Highlight or underline critical NCERT keywords and key terms using HTML underline <u>keyword</u> tags or [KEY: keyword] tags.\n"
        "- Use spacing between points to make the answer easy to scan.\n"
    )

    return prompt

async def generate_answer(question: str, custom_template: str = None) -> str:
    """Generate a CBSE‑style answer for *question* using the MoL.
    
    If the LLM generation fails, it falls back to a template-based mock answer.
    """
    qtype, marks = parse_question(question)
    
    # 1. Build system prompt
    system_prompt = build_cbse_system_prompt(qtype, marks)
    
    # 2. Build GenerateRequest
    # Synthetic student context with grade 10 (common CBSE grade)
    student_ctx = StudentContext(
        student_id="cbse-parser-tutor",
        grade="10",
        language="en",
        subject="science",
    )
    
    mol_request = GenerateRequest(
        task_type="explanation",
        input=GenerateInput(question=question),
        student_context=student_ctx,
        config=GenerateConfig(
            surface="foxy",
            max_tokens_override=800,
            system_prompt_override=system_prompt,
        ),
    )
    
    answer = None
    
    # 3. Call generate_response
    try:
        mol_result = await generate_response(mol_request)
        answer = mol_result.text
    except Exception as exc:
        # Graceful fallback to template-based mock generation
        template = custom_template or get_template(marks)
        definition = ""
        if qtype == "define":
            m = re.search(r"Define\s+([^\.]+)", question, re.IGNORECASE)
            if m:
                definition = f"**{m.group(1).strip()}** is defined as ..."
        if not definition:
            definition = question.strip()
            
        points = [f"**Point {i}**: Explain the concept here." for i in range(1, marks + 1)]
        points_md = "\n- ".join(points)
        answer = template.format(definition=definition, points=points_md)
        
    # 4. Underline keywords if not define
    if qtype != "define":
        answer = underline_keywords(answer)
        
    return answer

