const anthropic = require('../config/anthropic');
const supabase = require('../config/supabase');
const logger = require('../config/logger');

// Generate embedding for a query using Claude (or OpenAI if preferred)
// We use a simple keyword-based retrieval as a fallback when pgvector isn't available
async function retrieveContext(query, { grade, subject }, limit = 3) {
  try {
    // Try vector search first (requires pgvector + embeddings pre-loaded)
    const { data: chunks, error } = await supabase.rpc('match_syllabus', {
      query_text: query,
      filter_grade: grade,
      filter_subject: subject,
      match_count: limit,
    });

    if (!error && chunks?.length) {
      return chunks.map(c => c.content).join('\n\n---\n\n');
    }
  } catch (e) {
    logger.debug('Vector search unavailable, using keyword fallback');
  }

  // Keyword fallback — full-text search on syllabus_topics
  try {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
    const { data } = await supabase
      .from('syllabus_topics')
      .select('title, description, content')
      .eq('grade', grade)
      .eq('subject', subject)
      .textSearch('content', keywords.join(' | '))
      .limit(limit);

    if (data?.length) {
      return data.map(t => `${t.title}\n${t.content || t.description}`).join('\n\n---\n\n');
    }
  } catch (e) {
    logger.debug('Keyword fallback also failed, proceeding without RAG context');
  }

  return null;
}

// Enhanced chat with RAG context injected into system prompt
async function ragChat({ userId, sessionId, message, studentProfile, history }) {
  const context = await retrieveContext(message, studentProfile);

  const systemPrompt = buildRagSystemPrompt(studentProfile, context);

  const messages = [
    ...(history || []).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  return {
    message: response.content[0].text,
    usedRag: !!context,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

function buildRagSystemPrompt(profile, context) {
  const base = `You are MIGA (Foxy), the AI tutor for Alfanumrik. Student: ${profile.name || 'Student'}, ${profile.grade}, studying ${profile.subject} in ${profile.language || 'English'}.

Personality: warm, encouraging fox. Use simple language. End with a check-question. Celebrate correct answers. Gently correct mistakes. Use Indian examples (cricket, festivals, food).`;

  if (context) {
    return `${base}

CURRICULUM CONTEXT (use this as your primary source):
${context}

Answer based on the curriculum context above when relevant. If the question goes beyond the context, use your general knowledge but stay age-appropriate.`;
  }

  return base;
}

// Index a syllabus topic (called when adding curriculum content)
async function indexTopic({ grade, subject, title, description, content, chapterId }) {
  const { data, error } = await supabase.from('syllabus_topics').upsert({
    grade, subject, title, description, content,
    chapter_id: chapterId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'grade,subject,title' }).select().single();

  if (error) throw error;
  return data;
}

module.exports = { ragChat, retrieveContext, indexTopic };
