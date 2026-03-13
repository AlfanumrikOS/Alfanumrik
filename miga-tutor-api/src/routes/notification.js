const express = require('express');
const router = express.Router();
const { saveToken, removeToken, sendToUser } = require('../services/notificationService');

// POST /api/notification/token — register FCM token
router.post('/token', async (req, res) => {
  try {
    const { token, platform } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    await saveToken(req.user.id, token, platform || 'web');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to save token' }); }
});

// DELETE /api/notification/token — unregister
router.delete('/token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    await removeToken(req.user.id, token);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to remove token' }); }
});

// POST /api/notification/test — send test push to self
router.post('/test', async (req, res) => {
  try {
    const result = await sendToUser(req.user.id, {
      title: '🦊 Test notification',
      body: 'Alfanumrik push notifications are working!',
      data: { screen: 'home' },
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Failed to send notification' }); }
});

module.exports = router;
