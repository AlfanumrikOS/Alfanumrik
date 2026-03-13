const Razorpay = require('razorpay');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const logger = require('../config/logger');

let razorpay;
function getRazorpay() {
  if (!razorpay) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpay;
}

const PLANS = {
  monthly: { amount: 19900, currency: 'INR', period: 'monthly', days: 30, name: 'Alfanumrik Pro Monthly' },
  quarterly: { amount: 49900, currency: 'INR', period: 'quarterly', days: 90, name: 'Alfanumrik Pro Quarterly' },
  yearly: { amount: 149900, currency: 'INR', period: 'yearly', days: 365, name: 'Alfanumrik Pro Yearly' },
};

async function createOrder(userId, planId) {
  const plan = PLANS[planId];
  if (!plan) throw Object.assign(new Error('Invalid plan'), { status: 400 });

  const order = await getRazorpay().orders.create({
    amount: plan.amount,
    currency: plan.currency,
    receipt: `order_${userId}_${Date.now()}`,
    notes: { userId, planId },
  });

  // Store pending order
  await supabase.from('payment_orders').insert({
    user_id: userId,
    razorpay_order_id: order.id,
    plan_id: planId,
    amount: plan.amount,
    currency: plan.currency,
    status: 'pending',
  });

  return { orderId: order.id, amount: plan.amount, currency: plan.currency, planName: plan.name, keyId: process.env.RAZORPAY_KEY_ID };
}

async function verifyPayment(userId, { razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  // Verify signature
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');

  if (expectedSignature !== razorpay_signature) {
    throw Object.assign(new Error('Payment verification failed'), { status: 400 });
  }

  // Get order details to find plan
  const { data: order } = await supabase.from('payment_orders').select('*').eq('razorpay_order_id', razorpay_order_id).single();
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });

  const plan = PLANS[order.plan_id];
  const expiresAt = new Date(Date.now() + plan.days * 86400 * 1000).toISOString();

  // Update order
  await supabase.from('payment_orders').update({ status: 'paid', razorpay_payment_id }).eq('razorpay_order_id', razorpay_order_id);

  // Upsert subscription
  await supabase.from('subscriptions').upsert({
    user_id: userId,
    plan_id: order.plan_id,
    status: 'active',
    razorpay_payment_id,
    razorpay_order_id,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  logger.info(`Payment verified for user ${userId}, plan ${order.plan_id}`);
  return { success: true, plan: order.plan_id, expiresAt };
}

async function getSubscription(userId) {
  const { data } = await supabase.from('subscriptions').select('*').eq('user_id', userId).single();
  if (!data) return { plan: 'free', status: 'free', expiresAt: null };

  const isActive = data.status === 'active' && new Date(data.expires_at) > new Date();
  return { plan: isActive ? data.plan_id : 'free', status: isActive ? 'active' : 'expired', expiresAt: data.expires_at };
}

module.exports = { createOrder, verifyPayment, getSubscription, PLANS };
