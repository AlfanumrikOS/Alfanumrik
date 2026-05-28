import re
from typing import List, Optional, Literal, Set, Dict, Any, Union
from pydantic import BaseModel
import math

VALID_BLOOM_LEVELS = {
    'remember',
    'understand',
    'apply',
    'analyze',
    'evaluate',
    'create',
}

VALID_CBSE_SUBJECTS = {
    'math',
    'science',
    'english',
    'hindi',
    'social_studies',
    'social studies',
    'physics',
    'chemistry',
    'biology',
    'economics',
    'accountancy',
    'business_studies',
    'business studies',
    'history',
    'geography',
    'political_science',
    'political science',
}

VALID_GRADE_RE = re.compile(r"^[6-9]$|^1[0-2]$")
PLACEHOLDER_RE = re.compile(r"\{\{|\[BLANK\]", re.IGNORECASE)
NUMERIC_RE = re.compile(r"-?\d+(?:\.\d+)?")

class CandidateQuestion(BaseModel):
    question_text: str
    options: List[str]
    correct_answer_index: int
    explanation: str
    hint: Optional[str] = None
    difficulty: Optional[Literal['easy', 'medium', 'hard']] = None
    bloom_level: Optional[str] = None
    grade: Optional[str] = None
    subject: Optional[str] = None

OracleVerdict = Literal['consistent', 'mismatch', 'ambiguous']

class LlmGradeResult(BaseModel):
    verdict: OracleVerdict
    reasoning: str
    suggested_correct_index: Optional[Literal[0, 1, 2, 3]] = None

OracleRejectionCategory = Literal[
    'p6_text_empty_or_placeholder',
    'p6_options_not_4',
    'p6_options_not_distinct',
    'p6_correct_index_out_of_range',
    'p6_explanation_empty',
    'p6_invalid_difficulty',
    'p6_invalid_bloom',
    'p5_invalid_grade',
    'invalid_subject',
    'options_overlap_semantic',
    'numeric_inconsistency',
    'llm_mismatch',
    'llm_ambiguous',
    'llm_grader_unavailable'
]

class OracleAcceptResult(BaseModel):
    ok: Literal[True]
    llm_calls: int

class OracleRejectResult(BaseModel):
    ok: Literal[False]
    category: OracleRejectionCategory
    reason: str
    suggested_correct_index: Optional[Literal[0, 1, 2, 3]] = None
    llm_calls: int

OracleResult = Union[OracleAcceptResult, OracleRejectResult]

def normalise_digits(s: str) -> str:
    res = []
    for c in s:
        if '\u0966' <= c <= '\u096f':
            res.append(chr(ord(c) - 0x0966 + 0x30))
        else:
            res.append(c)
    return "".join(res)

def tokenize(s: str) -> List[str]:
    # Unicode-aware tokenization: Python's \w includes letters and numbers in any script, plus underscore.
    s = s.lower()
    s = re.sub(r'[^\w\s]', ' ', s)
    s = s.replace('_', ' ')
    return [t for t in s.split() if t]

def jaccard_word_overlap(a: str, b: str) -> float:
    set_a = set(tokenize(a))
    set_b = set(tokenize(b))
    if not set_a and not set_b:
        return 1.0
    inter = len(set_a & set_b)
    union = len(set_a) + len(set_b) - inter
    if union == 0:
        return 0.0
    return inter / union

def extract_numbers(s: str) -> List[float]:
    normalised = normalise_digits(s)
    out = []
    matches = NUMERIC_RE.findall(normalised)
    for m in matches:
        try:
            n = float(m)
            if math.isfinite(n):
                out.append(n)
        except ValueError:
            pass
    return out

def check_numeric_consistency(question_text: str, correct_option_text: str, explanation: str) -> Optional[str]:
    opt_numbers = extract_numbers(correct_option_text)
    if not opt_numbers:
        return None
    exp_numbers = extract_numbers(explanation)
    if not exp_numbers:
        return None
    
    given_in_question = set(str(n) for n in extract_numbers(question_text))
    
    for n in opt_numbers:
        if str(n) in given_in_question:
            continue
        present = any(abs(m - n) < 1e-6 for m in exp_numbers)
        if not present:
            return f"correct option has number {n} but explanation contains no matching value (explanation numbers: {', '.join(map(str, exp_numbers))})"
    return None

def reject_det(category: OracleRejectionCategory, reason: str) -> OracleRejectResult:
    return OracleRejectResult(ok=False, category=category, reason=reason, llm_calls=0)

def run_deterministic_checks(q: CandidateQuestion) -> Optional[OracleRejectResult]:
    text = q.question_text.strip() if isinstance(q.question_text, str) else ''
    if not text:
        return reject_det('p6_text_empty_or_placeholder', 'question_text is empty')
    if PLACEHOLDER_RE.search(text):
        return reject_det('p6_text_empty_or_placeholder', 'question_text contains {{ or [BLANK] placeholder')
    
    if not isinstance(q.options, list) or len(q.options) != 4:
        return reject_det('p6_options_not_4', f"expected exactly 4 options, got {len(q.options) if isinstance(q.options, list) else 'non-array'}")
    
    clean_opts = []
    for i in range(4):
        raw = q.options[i]
        if not isinstance(raw, str) or not raw.strip():
            return reject_det('p6_options_not_4', f"option at index {i} is empty or not a string")
        clean_opts.append(raw.strip())
    
    lower_opts = [o.lower() for o in clean_opts]
    distinct = set(lower_opts)
    if len(distinct) != 4:
        return reject_det('p6_options_not_distinct', 'options are not all distinct (case-insensitive)')
        
    idx = q.correct_answer_index
    if not isinstance(idx, int) or idx < 0 or idx > 3:
        return reject_det('p6_correct_index_out_of_range', f"correct_answer_index must be integer 0..3, got {idx}")
        
    exp = q.explanation.strip() if isinstance(q.explanation, str) else ''
    if not exp:
        return reject_det('p6_explanation_empty', 'explanation is empty')
        
    if q.difficulty is not None:
        d = q.difficulty
        if not isinstance(d, str) or d.lower() not in ['easy', 'medium', 'hard']:
            return reject_det('p6_invalid_difficulty', f"difficulty must be one of easy|medium|hard, got {d}")
            
    if q.bloom_level is not None:
        if not isinstance(q.bloom_level, str) or q.bloom_level.lower() not in VALID_BLOOM_LEVELS:
            return reject_det('p6_invalid_bloom', f"bloom_level must be one of remember|understand|apply|analyze|evaluate|create, got {q.bloom_level}")
            
    if q.grade is not None:
        if not isinstance(q.grade, str) or not VALID_GRADE_RE.match(q.grade):
            return reject_det('p5_invalid_grade', f"grade must be a string \"6\"..\"12\", got {q.grade}")
            
    if q.subject is not None:
        if not isinstance(q.subject, str) or q.subject.lower().strip() not in VALID_CBSE_SUBJECTS:
            return reject_det('invalid_subject', f"subject must be a known CBSE subject, got {q.subject}")
            
    for i in range(4):
        for j in range(i + 1, 4):
            a = clean_opts[i]
            b = clean_opts[j]
            overlap = jaccard_word_overlap(a, b)
            a_tokens = len(tokenize(a))
            b_tokens = len(tokenize(b))
            if (a_tokens <= 6 and b_tokens <= 6 and overlap >= 0.7) or overlap >= 0.85:
                return reject_det('options_overlap_semantic', f'options {i} and {j} overlap (Jaccard={overlap:.2f}): "{a}" vs "{b}"')
                
    numeric_fail = check_numeric_consistency(q.question_text, clean_opts[idx], exp)
    if numeric_fail:
        return reject_det('numeric_inconsistency', numeric_fail)
        
    return None
