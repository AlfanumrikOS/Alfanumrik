const express = require('express');
const router = express.Router();
const { generateQuiz, saveQuizResult, getQuizHistory } = require('../services/quizService');
const { getProfile } = require('../services/profileService');

// POST /api/quiz/generate
router.post('/generate', async (req, res) => {
  try {
    const { topic, difficulty, count } = req.body;

    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    const profile = await getProfile(req.user.id);
    if (!profile) {
      return res.status(400).json({ error: 'Profile not found' });
    }

    const quiz = await generateQuiz({
      topic,
      grade: profile.grade,
      subject: profile.subject,
      difficulty: difficulty || 'medium',
      count: Math.min(count || 5, 10), // max 10 questions
    });

    res.json(quiz);
  } catch (err) {
    console.error('Quiz generation error:', err);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

// POST /api/quiz/result — save quiz result
router.post('/result', async (req, res) => {
  try {
    const { topic, score, total, answers } = req.body;

    if (score === undefined || total === undefined) {
      return res.status(400).json({ error: 'Score and total are required' });
    }

    const profile = await getProfile(req.user.id);

    const result = await saveQuizResult({
      userId: req.user.id,
      topic,
      subject: profile?.subject,
      grade: profile?.grade,
      score,
      total,
      answers,
    });

    res.json({ success: true, result });
  } catch (err) {
    console.error('Save result error:', err);
    res.status(500).json({ error: 'Failed to save result' });
  }
});

// GET /api/quiz/history
router.get('/history', async (req, res) => {
  try {
    const history = await getQuizHistory(req.user.id);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch quiz history' });
  }
});

module.exports = router;
