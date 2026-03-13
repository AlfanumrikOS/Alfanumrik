const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { chat, chatStream } = require('../services/migaService');
const { getProfile } = require('../services/profileService');
const supabase = require('../config/supabase');

// POST /api/chat — single request/response
router.post('/', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const userId = req.user.id;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get student profile for personalization
    const profile = await getProfile(userId);

    if (!profile) {
      return res.status(400).json({ error: 'Student profile not found. Please complete onboarding.' });
    }

    // Create or reuse session
    const activeSessionId = sessionId || uuidv4();

    if (!sessionId) {
      await supabase.from('chat_sessions').insert({
        id: activeSessionId,
        user_id: userId,
      });
    }

    const result = await chat({
      userId,
      sessionId: activeSessionId,
      message: message.trim(),
      studentProfile: profile,
    });

    res.json(result);
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to get response from MIGA' });
  }
});

// POST /api/chat/stream — streaming SSE response
router.post('/stream', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const userId = req.user.id;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const profile = await getProfile(userId);
    if (!profile) {
      return res.status(400).json({ error: 'Student profile not found.' });
    }

    const activeSessionId = sessionId || uuidv4();

    if (!sessionId) {
      await supabase.from('chat_sessions').insert({
        id: activeSessionId,
        user_id: userId,
      });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await chatStream({
      userId,
      sessionId: activeSessionId,
      message: message.trim(),
      studentProfile: profile,
      onChunk: (text) => {
        res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
      },
      onDone: (fullMessage) => {
        res.write(`data: ${JSON.stringify({ done: true, sessionId: activeSessionId })}\n\n`);
        res.end();
      },
    });
  } catch (err) {
    console.error('Stream error:', err);
    res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
    res.end();
  }
});

// GET /api/chat/sessions — list user's sessions
router.get('/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ sessions: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// GET /api/chat/history/:sessionId — get messages in a session
router.get('/history/:sessionId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('session_id', req.params.sessionId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
