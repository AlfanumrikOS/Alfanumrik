const anthropic = require('../config/anthropic');
const supabase = require('../config/supabase');

// System prompt for MIGA — Alfanumrik's AI tutor (Foxy)
function buildSystemPrompt(studentProfile) {
  const { grade, subject, language, name } = studentProfile;

  return `You are MIGA (My Intelligent Guide & Advisor), the AI tutor for Alfanumrik — an adaptive learning platform. Your persona is "Foxy", a warm, encouraging fox who loves teaching.

STUDENT PROFILE:
- Name: ${name || 'Student'}
- Grade: ${grade || 'Not specified'}
- Subject: ${subject || 'General'}
- Preferred Language: ${language || 'English'}

YOUR TEACHING STYLE:
- Be warm, encouraging, and patient
- Use simple language appropriate for Grade ${grade || 'school'} students
- If the student prefers ${language || 'English'}, communicate in that language
- Break complex concepts into small, digestible steps
- Always end your explanation with a question to check understanding
- Celebrate correct answers with enthusiasm
- When a student is wrong, gently correct and re-explain without discouraging them
- Use relatable examples from everyday Indian student life (cricket, festivals, food, etc.)
- Keep responses concise — max 3-4 short paragraphs

SUBJECT FOCUS: ${subject || 'General academics'}
- Only teach concepts relevant to the student's grade and subject
- If asked off-topic questions, gently redirect back to learning

RESPONSE FORMAT:
- Use simple markdown (bold for key terms, bullet points for steps)
- Emojis are welcome to make learning fun 🦊
- Never use complex jargon without explaining it first`;
}

// Build conversation history from DB records
function buildMessages(history, userMessage) {
  const messages = history.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// Main chat function
async function chat({ userId, sessionId, message, studentProfile }) {
  // 1. Fetch recent conversation history (last 10 messages for context)
  const { data: history, error: historyError } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(10);

  if (historyError) {
    console.error('History fetch error:', historyError);
  }

  const messages = buildMessages(history || [], message);
  const systemPrompt = buildSystemPrompt(studentProfile);

  // 2. Call Claude API
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const assistantMessage = response.content[0].text;

  // 3. Store both user and assistant messages in Supabase
  const messagesToInsert = [
    {
      session_id: sessionId,
      user_id: userId,
      role: 'user',
      content: message,
    },
    {
      session_id: sessionId,
      user_id: userId,
      role: 'assistant',
      content: assistantMessage,
    }
  ];

  await supabase.from('chat_messages').insert(messagesToInsert);

  return {
    message: assistantMessage,
    sessionId,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

// Streaming chat — for real-time response
async function chatStream({ userId, sessionId, message, studentProfile, onChunk, onDone }) {
  const { data: history } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(10);

  const messages = buildMessages(history || [], message);
  const systemPrompt = buildSystemPrompt(studentProfile);

  let fullResponse = '';

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  stream.on('text', (text) => {
    fullResponse += text;
    onChunk(text);
  });

  await stream.finalMessage();

  // Store messages after stream completes
  await supabase.from('chat_messages').insert([
    { session_id: sessionId, user_id: userId, role: 'user', content: message },
    { session_id: sessionId, user_id: userId, role: 'assistant', content: fullResponse },
  ]);

  onDone(fullResponse);
}

module.exports = { chat, chatStream };
