const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment, getSubscription, PLANS } = require('../services/paymentService');

// GET /api/payment/plans
router.get('/plans', (req, res) => {
  const plans = Object.entries(PLANS).map(([id, p]) => ({
    id, name: p.name, amount: p.amount, currency: p.currency,
    period: p.period, displayPrice: `₹${(p.amount / 100).toFixed(0)}`,
  }));
  res.json({ plans });
});

// GET /api/payment/subscription
router.get('/subscription', async (req, res) => {
  try {
    const sub = await getSubscription(req.user.id);
    res.json({ subscription: sub });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch subscription' }); }
});

// POST /api/payment/create-order
router.post('/create-order', async (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: 'planId is required' });
    const order = await createOrder(req.user.id, planId);
    res.json(order);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// POST /api/payment/verify
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment fields' });
    }
    const result = await verifyPayment(req.user.id, req.body);
    res.json(result);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;
