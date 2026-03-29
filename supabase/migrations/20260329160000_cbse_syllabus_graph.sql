-- CBSE Syllabus Graph: structured curriculum knowledge base
-- Each row = one concept with formulas, rules, answer patterns, common mistakes

CREATE TABLE IF NOT EXISTS cbse_syllabus_graph (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL DEFAULT 'CBSE',
  grade text NOT NULL,
  subject text NOT NULL,
  chapter_number integer NOT NULL,
  chapter_title text NOT NULL,
  concept text NOT NULL,
  sub_concept text,
  learning_objective text,
  formulas jsonb DEFAULT '[]',
  rules jsonb DEFAULT '[]',
  key_terms jsonb DEFAULT '[]',
  common_mistakes jsonb DEFAULT '[]',
  question_types jsonb DEFAULT '[]',
  typical_marks jsonb DEFAULT '[]',
  answer_pattern text,
  prerequisite_concepts jsonb DEFAULT '[]',
  bloom_level text DEFAULT 'understand',
  difficulty integer DEFAULT 2,
  search_vector tsvector,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_syllabus_subject_grade ON cbse_syllabus_graph(subject, grade);
CREATE INDEX IF NOT EXISTS idx_syllabus_chapter ON cbse_syllabus_graph(subject, grade, chapter_number);
CREATE INDEX IF NOT EXISTS idx_syllabus_search ON cbse_syllabus_graph USING gin(search_vector);

ALTER TABLE cbse_syllabus_graph ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS syllabus_read ON cbse_syllabus_graph FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS syllabus_service ON cbse_syllabus_graph FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Syllabus concept retrieval RPC
CREATE OR REPLACE FUNCTION match_syllabus_concept(
  p_query TEXT, p_subject TEXT, p_grade TEXT, p_match_count INTEGER DEFAULT 3
)
RETURNS TABLE(
  id UUID, concept TEXT, sub_concept TEXT, chapter_title TEXT, chapter_number INTEGER,
  formulas JSONB, rules JSONB, key_terms JSONB, common_mistakes JSONB,
  answer_pattern TEXT, question_types JSONB, learning_objective TEXT, bloom_level TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_db_subject TEXT; v_db_grade TEXT; v_query tsquery; v_count INTEGER; v_words TEXT[];
BEGIN
  v_db_subject := CASE p_subject
    WHEN 'math' THEN 'Mathematics' WHEN 'science' THEN 'Science'
    WHEN 'physics' THEN 'Physics' WHEN 'chemistry' THEN 'Chemistry'
    WHEN 'biology' THEN 'Biology' WHEN 'english' THEN 'English'
    WHEN 'hindi' THEN 'Hindi' WHEN 'social_studies' THEN 'Social Studies'
    WHEN 'computer_science' THEN 'Computer Science'
    ELSE initcap(replace(p_subject, '_', ' '))
  END;
  v_db_grade := CASE WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade END;
  v_query := plainto_tsquery('english', p_query);

  RETURN QUERY SELECT g.id, g.concept, g.sub_concept, g.chapter_title, g.chapter_number,
    g.formulas, g.rules, g.key_terms, g.common_mistakes, g.answer_pattern,
    g.question_types, g.learning_objective, g.bloom_level
  FROM cbse_syllabus_graph g
  WHERE g.is_active = true AND g.subject = v_db_subject AND g.grade = v_db_grade AND g.search_vector @@ v_query
  ORDER BY ts_rank(g.search_vector, v_query) DESC LIMIT p_match_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    v_words := string_to_array(lower(p_query), ' ');
    RETURN QUERY SELECT g.id, g.concept, g.sub_concept, g.chapter_title, g.chapter_number,
      g.formulas, g.rules, g.key_terms, g.common_mistakes, g.answer_pattern,
      g.question_types, g.learning_objective, g.bloom_level
    FROM cbse_syllabus_graph g
    WHERE g.is_active = true AND g.subject = v_db_subject AND g.grade = v_db_grade
      AND (lower(g.concept) LIKE '%' || v_words[1] || '%' OR lower(g.chapter_title) LIKE '%' || v_words[1] || '%')
    LIMIT p_match_count;
  END IF;
END;
$$;
