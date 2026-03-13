const express = require('express');
const router = express.Router();
const { getProfile, upsertProfile, getProgress } = require('../services/profileService');

// GET /api/profile
router.get('/', async (req, res) => {
  try {
    const profile = await getProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST /api/profile — create or update
router.post('/', async (req, res) => {
  try {
    const { name, grade, subject, language, avatar } = req.body;

    if (!grade || !subject) {
      return res.status(400).json({ error: 'Grade and subject are required' });
    }

    const profile = await upsertProfile(req.user.id, {
      name,
      grade,
      subject,
      language,
      avatar,
    });

    res.json({ profile });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// GET /api/profile/progress
router.get('/progress', async (req, res) => {
  try {
    const progress = await getProgress(req.user.id);
    res.json({ progress });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

module.exports = router;
