const anthropic = require('../config/anthropic');
const supabase = require('../config/supabase');

async function generateQuiz({ topic, grade, subject, difficulty = 'medium', count = 5 }) {
  const prompt = `Generate ${count} multiple-choice quiz questions for a Grade ${grade} student studying ${subject}.

Topic: ${topic}
Difficulty: ${difficulty}

Return ONLY valid JSON in this exact format, no other text:
{
  "questions": [
    {
      "id": 1,
      "question": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0,
      "explanation": "Brief explanation of why this is correct"
    }
  ]
}

Rules:
- "correct" is the 0-based index of the right answer
- Questions must be appropriate for Grade ${grade}
- Make questions engaging and educational
- Explanations should be simple and clear`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const quiz = JSON.parse(cleaned);

  return quiz;
}

async function saveQuizResult({ userId, topic, subject, grade, score, total, answers }) {
  const percentage = Math.round((score / total) * 100);

  const { data, error } = await supabase
    .from('quiz_results')
    .insert({
      user_id: userId,
      topic,
      subject,
      grade,
      score,
      total,
      percentage,
      answers: JSON.stringify(answers),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getQuizHistory(userId, limit = 10) {
  const { data, error } = await supabase
    .from('quiz_results')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

module.exports = { generateQuiz, saveQuizResult, getQuizHistory };
