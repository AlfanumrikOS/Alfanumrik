'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

const PLANS = [
  { id: 'monthly',   label: 'Monthly',   price: '₹199', period: '/month', badge: '',         savings: '' },
  { id: 'quarterly', label: 'Quarterly', price: '₹499', period: '/3 months', badge: 'Popular', savings: 'Save ₹98' },
  { id: 'yearly',    label: 'Yearly',    price: '₹1,499', period: '/year',  badge: 'Best Value', savings: 'Save ₹889' },
]

const PRO_FEATURES = [
  '🦊 Unlimited Foxy AI chats',
  '📝 Unlimited quiz generation',
  '🎯 All subjects & grades',
  '📊 Advanced progress analytics',
  '🏆 Exclusive badges',
  '🔔 Daily study reminders',
  '📚 Curriculum-aligned content',
]

declare global { interface Window { Razorpay: any } }

export default function SubscriptionScreen({ profile, token, onBack }: {
  profile: any
  token: string
  onBack: () => void
}) {
  const [selectedPlan, setSelectedPlan] = useState('quarterly')
  const [loading, setLoading] = useState(false)
  const [subscription, setSubscription] = useState<any>(null)

  useEffect(() => {
    api.getSubscription(token).then(d => setSubscription(d.subscription)).catch(() => {})
    // Load Razorpay script
    if (!document.getElementById('razorpay-script')) {
      const script = document.createElement('script')
      script.id = 'razorpay-script'
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      document.body.appendChild(script)
    }
  }, [token])

  const handleSubscribe = async () => {
    setLoading(true)
    try {
      const order = await api.createPaymentOrder(token, selectedPlan)

      const options = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Alfanumrik',
        description: order.planName,
        order_id: order.orderId,
        prefill: { name: profile?.name, email: '' },
        theme: { color: '#FF6B00' },
        handler: async (response: any) => {
          try {
            await api.verifyPayment(token, response)
            setSubscription({ plan: selectedPlan, status: 'active' })
            alert('🎉 You are now Alfanumrik Pro! Welcome!')
          } catch (e) {
            alert('Payment verification failed. Contact support.')
          }
        },
      }

      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', () => alert('Payment failed. Please try again.'))
      rzp.open()
    } catch (e: any) {
      alert(e.message || 'Failed to start payment')
    } finally {
      setLoading(false)
    }
  }

  const isPro = subscription?.status === 'active'

  return (
    <div className="screen overflow-y-auto pb-8">
      <div className="bg-forest px-5 pt-12 pb-6 relative overflow-hidden">
        <div className="absolute top-[-30px] right-[-30px] w-32 h-32 bg-saffron/15 rounded-full" />
        <button onClick={onBack} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-white text-lg mb-4">←</button>
        <div className="text-4xl mb-2">👑</div>
        <h1 className="font-display text-3xl font-extrabold text-white">Go Pro</h1>
        <p className="text-cream/60 mt-1">Unlock Foxy's full power</p>
      </div>

      <div className="px-5 mt-5">
        {isPro ? (
          <div className="card border-2 border-saffron text-center py-8">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="font-display text-2xl font-extrabold text-forest">You're Pro!</h2>
            <p className="text-forest/60 mt-2">Plan: <strong>{subscription.plan}</strong></p>
            {subscription.expiresAt && (
              <p className="text-forest/40 text-sm mt-1">Renews {new Date(subscription.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            )}
          </div>
        ) : (
          <>
            {/* Features */}
            <div className="card mb-5">
              <p className="font-bold text-forest mb-3">Everything in Pro</p>
              <div className="space-y-2.5">
                {PRO_FEATURES.map(f => (
                  <div key={f} className="flex items-center gap-3">
                    <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-green-600 text-xs">✓</span>
                    </div>
                    <span className="text-sm text-forest/80 font-medium">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Plan selector */}
            <div className="space-y-3 mb-5">
              {PLANS.map(plan => (
                <button key={plan.id} onClick={() => setSelectedPlan(plan.id)}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all relative ${selectedPlan === plan.id ? 'border-saffron bg-saffron/5' : 'border-black/10 bg-white'}`}>
                  {plan.badge && (
                    <span className="absolute -top-2.5 right-3 bg-saffron text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                      {plan.badge}
                    </span>
                  )}
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-extrabold text-forest">{plan.label}</p>
                      {plan.savings && <p className="text-xs text-green-600 font-bold mt-0.5">{plan.savings}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-extrabold text-xl text-forest">{plan.price}</p>
                      <p className="text-xs text-forest/40">{plan.period}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <button onClick={handleSubscribe} disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 mb-3">
              {loading ? <><div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Processing...</>
                : '👑 Subscribe Now'}
            </button>

            <p className="text-center text-xs text-forest/30 mb-2">Secure payment via Razorpay · Cancel anytime</p>
          </>
        )}
      </div>
    </div>
  )
}
