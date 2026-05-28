import re

# For demonstration we keep a short list of common NCERT keywords.
NCERT_KEYWORDS = {
    "photosynthesis",
    "ohm’s law",
    "resistance",
    "current",
    "voltage",
    "acceleration",
    "force",
    "mass",
    "kinetic energy",
    "potential energy",
    "conduction",
    "convection",
    "radiation",
    "entropy",
    "enthalpy",
    "stoichiometry",
    "atom",
    "molecule",
    "cell",
    "ecosystem",
}

def underline_keywords(text: str) -> str:
    """Underline any occurrence of a known NCERT keyword.
    Uses markdown underline syntax (HTML <u>) because plain markdown lacks underline.
    """
    def repl(match):
        word = match.group(0)
        return f"<u>{word}</u>"
    # Build a regex alternating pattern of the keywords, case‑insensitive
    pattern = r"(?i)\b(" + "|".join(map(re.escape, NCERT_KEYWORDS)) + r")\b"
    return re.sub(pattern, repl, text)
