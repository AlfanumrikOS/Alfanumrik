# MIGA Tutor API — Alfanumrik Backend

MIGA (My Intelligent Guide & Advisor) is the AI tutor backend for the Alfanumrik adaptive learning platform. Built with Node.js + Express, powered by Anthropic Claude.

## Stack

- **Runtime:** Node.js 18+
- **Framework:** Express 4
- **AI:** Anthropic Claude (claude-sonnet-4-20250514)
- **Database:** Supabase (PostgreSQL + Auth)
- **Payments:** Razorpay
- **Push Notifications:** Firebase Cloud Messaging (FCM)
- **Hosting:** Vercel

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| POST | `/api/chat` | JWT | Send message to Foxy |
| POST | `/api/chat/stream` | JWT | Streaming SSE chat |
| GET | `/api/chat/sessions` | JWT | List chat sessions |
| GET | `/api/chat/history/:id` | JWT | Session message history |
| POST | `/api/quiz/generate` | JWT | Generate quiz with Claude |
| POST | `/api/quiz/result` | JWT | Save quiz result |
| GET | `/api/quiz/history` | JWT | Past quiz results |
| GET | `/api/profile` | JWT | Get student profile |
| POST | `/api/profile` | JWT | Create/update profile |
| GET | `/api/profile/progress` | JWT | Stats & streak |
| GET | `/api/payment/plans` | JWT | Available plans |
| GET | `/api/payment/subscription` | JWT | Current subscription |
| POST | `/api/payment/create-order` | JWT | Create Razorpay order |
| POST | `/api/payment/verify` | JWT | Verify payment |
| POST | `/api/notification/token` | JWT | Register FCM token |
| DELETE | `/api/notification/token` | JWT | Remove FCM token |
| POST | `/api/notification/test` | JWT | Send test push |
| GET | `/api/admin/leaderboard` | JWT | Public leaderboard |
| GET | `/api/admin/stats` | Admin | Platform stats |
| GET | `/api/admin/users` | Admin | User list |
| GET | `/api/admin/revenue` | Admin | Revenue report |

## Local Setup

```bash
git clone <repo>
cd miga-tutor-api
npm install
cp .env.example .env
# Fill in .env with your keys
npm run dev
```

## Environment Variables

See `.env.example` for all required variables.

## Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
# Add all env vars in Vercel dashboard
```

## Database

Run `supabase-schema.sql` in your Supabase SQL Editor before first deploy.

## Tests

```bash
npm test
```
