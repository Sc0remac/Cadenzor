# Production Deployment Guide

## Overview

This guide outlines the recommended approach for deploying Kazador to production using a **scheduled worker** pattern for email ingestion. This approach balances simplicity, reliability, and cost-effectiveness while providing near-real-time email processing.

---

## Architecture: Scheduled Worker Approach

### How It Works

1. **Frontend (Next.js App)** - Deployed to Vercel/Railway/your platform of choice
2. **Background Worker** - Runs on a cron schedule (every 5-15 minutes)
3. **Supabase** - Hosted database (already cloud-ready)
4. **Gmail API** - Polls for new messages on each worker run

### Data Flow

```
Gmail Inbox → Worker (Cron) → Classify Email → Store in DB → Apply Project Rules → Update Gmail Labels
                 ↓
         Every 5-15 minutes
```

---

## Why Scheduled Worker (Option B)?

**Advantages:**
- ✅ Simple deployment - reuses existing worker code
- ✅ No public webhook endpoint needed
- ✅ Predictable costs (controlled by cron frequency)
- ✅ Easy to debug and monitor
- ✅ Built-in retry logic (just run again on next schedule)
- ✅ Works with any hosting platform

**Trade-offs:**
- ⏱️ 5-15 minute latency (vs. real-time with webhooks)
- 📊 Slightly higher Gmail API quota usage (but well within free tier)

**Good for:**
- Artist management workflows (not mission-critical millisecond response times)
- Bootstrapped/indie projects
- Teams that want simple, maintainable infrastructure

---

## Deployment Options

### Option 1: Railway (Recommended for Simplicity)

**Why Railway:**
- Simple cron setup via `railway.json`
- Environment variables UI
- Built-in logging
- Auto-deploys from Git
- Generous free tier ($5/month credit)

**Setup Steps:**

1. **Create Railway project**
   ```bash
   # Install Railway CLI
   npm i -g @railway/cli

   # Login and create project
   railway login
   railway init
   ```

2. **Create `railway.json` in project root:**
   ```json
   {
     "build": {
       "builder": "NIXPACKS"
     },
     "deploy": {
       "numReplicas": 1,
       "restartPolicyType": "ON_FAILURE"
     },
     "cron": [
       {
         "name": "email-worker",
         "schedule": "*/10 * * * *",
         "command": "npm --prefix worker run start"
       }
     ]
   }
   ```

3. **Set environment variables in Railway dashboard:**
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `OPENAI_API_KEY`
   - `MAX_EMAILS_TO_PROCESS=50`

4. **Deploy:**
   ```bash
   railway up
   ```

**Cost:** Free tier covers most indie projects (~$5/month worth of resources)

---

### Option 2: Vercel Cron + Vercel Functions

**Why Vercel:**
- You're likely already using Vercel for the Next.js frontend
- Keep everything in one platform
- Generous free tier

**Setup Steps:**

1. **Create cron config in `vercel.json`:**
   ```json
   {
     "crons": [
       {
         "path": "/api/worker/email-sync",
         "schedule": "*/10 * * * *"
       }
     ]
   }
   ```

2. **Create API route `app/api/worker/email-sync/route.ts`:**
   ```typescript
   import { NextResponse } from "next/server";
   import { createClient } from "@supabase/supabase-js";
   import { processGmailAccounts } from "@/lib/emailWorker";

   export const runtime = "nodejs";
   export const maxDuration = 300; // 5 minutes

   export async function GET(request: Request) {
     // Verify cron secret to prevent unauthorized calls
     const authHeader = request.headers.get("authorization");
     if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
     }

     const supabase = createClient(
       process.env.SUPABASE_URL!,
       process.env.SUPABASE_SERVICE_ROLE_KEY!
     );

     try {
       const result = await processGmailAccounts(supabase);
       return NextResponse.json(result);
     } catch (error) {
       console.error("Worker error:", error);
       return NextResponse.json(
         { error: "Worker failed" },
         { status: 500 }
       );
     }
   }
   ```

3. **Extract worker logic to shared module `app/lib/emailWorker.ts`:**
   - Move core logic from `worker/src/index.ts`
   - Make it reusable by both cron API and standalone worker

4. **Set environment variables in Vercel:**
   - Same as Railway list above
   - Add `CRON_SECRET` (generate random string)

**Cost:** Free tier covers most projects (100GB-hours of function execution)

---

### Option 3: AWS EventBridge + Lambda

**Why AWS:**
- Enterprise-grade
- Fine-grained control
- Scales infinitely

**Setup Steps:**

1. **Package worker as Lambda function**
2. **Create EventBridge rule** (cron expression: `rate(10 minutes)`)
3. **Configure Lambda environment variables**
4. **Deploy via AWS Console or Terraform**

**Cost:** ~$0.20-2/month (very cheap for low-volume)

**Note:** More complex setup, overkill for most indie projects.

---

## Recommended Cron Schedules

| Schedule | Cron Expression | Latency | Use Case |
|----------|----------------|---------|----------|
| Every 5 min | `*/5 * * * *` | ~2-5 min avg | High-priority inbox |
| Every 10 min | `*/10 * * * *` | ~5-10 min avg | **Recommended** |
| Every 15 min | `*/15 * * * *` | ~7-15 min avg | Low-volume inbox |
| Every 30 min | `*/30 * * * *` | ~15-30 min avg | Very low-volume |
| Every hour | `0 * * * *` | ~30-60 min avg | Backup/catchup only |

**Recommendation:** Start with **10 minutes** - balances responsiveness and costs.

---

## Configuration Changes for Production

### 1. Worker Configuration

**Update `worker/.env.production`:**
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-app.com/api/auth/google/callback
OPENAI_API_KEY=sk-your-openai-key
MAX_EMAILS_TO_PROCESS=50  # Increased from 10 for production
NODE_ENV=production
```

### 2. Increase Email Batch Size

**In `worker/src/index.ts` (line 227):**
```typescript
const maxEmails = Number(process.env.MAX_EMAILS_TO_PROCESS || 50); // Changed from 10
```

This ensures the worker can catch up if emails accumulate between runs.

### 3. Add Retry Logic

**Wrap worker execution in retry logic:**

```typescript
// worker/src/index.ts
async function mainWithRetry(maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await main();
      return;
    } catch (error) {
      attempt++;
      console.error(`Worker attempt ${attempt} failed:`, error);
      if (attempt >= maxRetries) {
        console.error("Worker failed after max retries");
        process.exit(1);
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

mainWithRetry().catch((e) => console.error(e));
```

### 4. Add Monitoring & Logging

**Option A: Simple Logging (Built-in)**
- Use `console.log` statements (captured by Railway/Vercel)
- Review logs in platform dashboard

**Option B: Structured Logging (Recommended)**

Install Pino:
```bash
cd worker
npm install pino pino-pretty
```

Update worker:
```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "production"
    ? undefined
    : { target: "pino-pretty" }
});

// Replace console.log with:
logger.info({ accountId: account.id }, "Processing Gmail account");
logger.error({ error, emailId: msg.id }, "Failed to process email");
```

**Option C: External Monitoring (Advanced)**
- Sentry for error tracking
- LogTail/Papertrail for log aggregation
- Axiom for analytics

---

## Migration Checklist

### Phase 1: Pre-Deployment (Local)

- [ ] Test worker locally with production-like data
- [ ] Verify all environment variables are documented
- [ ] Test classification with 50+ emails to ensure performance
- [ ] Review Gmail API quota limits (free tier: 1B quota/day = ~25,000 emails/day)
- [ ] Confirm Supabase RLS policies are production-ready
- [ ] Test project assignment rules with real email samples

### Phase 2: Initial Deployment

- [ ] Deploy Next.js app to hosting platform
- [ ] Set up Supabase production instance (or use existing)
- [ ] Run schema migration on production database
- [ ] Set up OAuth credentials for production domain
- [ ] Deploy worker to chosen platform (Railway/Vercel/AWS)
- [ ] Configure cron schedule (start with 15 min for safety)
- [ ] Set all environment variables
- [ ] Enable platform logging

### Phase 3: Testing & Validation

- [ ] Send test email and verify it appears in app within cron window
- [ ] Check project assignment rules are applied correctly
- [ ] Verify Gmail labels are created and applied
- [ ] Monitor worker logs for errors
- [ ] Test manual "Classify emails" button as backup
- [ ] Verify contact enrichment is working
- [ ] Check priority scoring is calculating correctly

### Phase 4: Optimization

- [ ] Reduce cron schedule to 10 minutes if 15 min works well
- [ ] Increase `MAX_EMAILS_TO_PROCESS` if needed
- [ ] Set up error alerting (email/Slack/Discord webhook)
- [ ] Configure backup/manual trigger for worker
- [ ] Document runbook for common issues

---

## Cost Estimates (Monthly)

### Small Team (1-2 users, ~100 emails/day)

| Service | Cost | Notes |
|---------|------|-------|
| Vercel (Frontend) | $0 | Free tier (Hobby plan) |
| Railway (Worker) | $0-5 | Free tier or Hobby plan |
| Supabase | $0 | Free tier (500MB DB, 2GB bandwidth) |
| Gmail API | $0 | Free (well within quota) |
| OpenAI API | $5-10 | ~$0.10 per 100 emails (GPT-4 mini) |
| **Total** | **$5-15** | Mostly OpenAI costs |

### Medium Team (5-10 users, ~500 emails/day)

| Service | Cost | Notes |
|---------|------|-------|
| Vercel (Frontend) | $0-20 | Free or Pro if needed |
| Railway (Worker) | $5-10 | Hobby plan |
| Supabase | $25 | Pro plan (8GB DB, 50GB bandwidth) |
| Gmail API | $0 | Free (still within quota) |
| OpenAI API | $25-50 | ~$0.10 per 100 emails |
| **Total** | **$55-105** | Scale with email volume |

---

## Monitoring & Alerts

### Key Metrics to Track

1. **Worker execution time** - Should complete in <60s for 50 emails
2. **Email processing rate** - Emails processed per run
3. **Error rate** - Failed emails / total emails
4. **Gmail API quota usage** - Should stay well below 1B/day
5. **Project rule match rate** - % of emails auto-assigned to projects
6. **OpenAI API costs** - Track spend per month

### Simple Health Check

Create a cron monitoring endpoint:

**`app/api/worker/health/route.ts`:**
```typescript
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check last processed email timestamp
  const { data, error } = await supabase
    .from("emails")
    .select("received_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return NextResponse.json({ status: "unhealthy", error }, { status: 500 });
  }

  const lastEmailAge = Date.now() - new Date(data.received_at).getTime();
  const maxAgeMs = 30 * 60 * 1000; // 30 minutes

  if (lastEmailAge > maxAgeMs) {
    return NextResponse.json({
      status: "stale",
      lastEmailAge: Math.floor(lastEmailAge / 1000 / 60) + " minutes ago",
    });
  }

  return NextResponse.json({ status: "healthy" });
}
```

Ping this endpoint from a service like UptimeRobot (free) to get alerts if worker stops running.

---

## Rollback Plan

If the scheduled worker has issues:

1. **Immediate Fallback:**
   - Users can manually click "Classify emails" button in UI
   - This triggers the same logic via API route

2. **Quick Fix:**
   - Disable cron temporarily
   - Fix worker code locally
   - Redeploy

3. **Emergency Fallback:**
   - Run worker manually from local machine:
     ```bash
     cd worker
     npm start
     ```
   - Use `.env.production` with production credentials

---

## Security Considerations

### 1. Protect Cron Endpoints

```typescript
// Verify requests are from your cron service
const authHeader = request.headers.get("authorization");
const cronSecret = process.env.CRON_SECRET;

if (authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

### 2. Rotate Secrets Regularly

- Google OAuth refresh tokens: Rotate every 6 months
- Supabase service role key: Rotate annually
- OpenAI API key: Rotate if exposed
- Cron secret: Rotate every 3 months

### 3. Rate Limiting

The worker naturally rate-limits via:
- Cron frequency (10 min = max 144 runs/day)
- `MAX_EMAILS_TO_PROCESS` (50 per run = max 7,200 emails/day)

### 4. Secrets Management

**Development:**
- Use `.env` files (gitignored)

**Production:**
- Use platform environment variables (Railway/Vercel dashboard)
- Never commit secrets to Git
- Use separate keys for dev/staging/prod

---

## Scaling Considerations

### When to Scale Up

**Trigger 1: High Email Volume**
- If receiving >5,000 emails/day per user
- **Solution:** Reduce cron frequency to 5 min, increase `MAX_EMAILS_TO_PROCESS` to 100

**Trigger 2: Slow Processing**
- If worker takes >2 min to complete
- **Solution:** Optimize classification logic, cache frequently used data, add parallel processing

**Trigger 3: Multiple Time Zones**
- If users are global and want faster response times
- **Solution:** Run worker every 5 min instead of 10 min

### When to Switch to Webhooks (Option A)

If you need:
- Sub-minute latency
- Real-time notifications to users
- Enterprise SLAs

Then consider implementing Gmail Push Notifications (see `WEBHOOK_SETUP.md` - to be created later).

---

## Troubleshooting

### Worker Not Running

**Check:**
1. Cron schedule is configured correctly
2. Environment variables are set
3. Worker logs show no errors
4. Platform service is healthy (Railway/Vercel status)

**Fix:**
- Review platform logs
- Manually trigger worker via dashboard
- Verify OAuth tokens haven't expired

### Emails Not Being Processed

**Check:**
1. Gmail API quota not exceeded
2. OpenAI API key valid and has credits
3. Supabase RLS policies allow worker writes
4. Worker is completing successfully (no crashes)

**Fix:**
- Check Gmail API quotas in Google Cloud Console
- Verify OpenAI API usage in OpenAI dashboard
- Review worker logs for classification errors

### Project Rules Not Applying

**Check:**
1. Rules are enabled in `/settings/automations`
2. Rule conditions match email metadata
3. `project_email_links` table has foreign key constraints satisfied

**Fix:**
- Test rules manually using "Test" button
- Review rule evaluation logs
- Check project exists and user has access

---

## Next Steps After Deployment

1. **Set up monitoring** - Health checks, error alerts
2. **Document runbook** - How to debug common issues
3. **Create backup worker trigger** - Manual API endpoint to run worker on-demand
4. **Add metrics dashboard** - Track emails processed, rules applied, costs
5. **Plan for scale** - When to move to webhooks or horizontal scaling

---

## Additional Resources

- [Railway Cron Documentation](https://docs.railway.app/reference/cron-jobs)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Gmail API Quotas](https://developers.google.com/gmail/api/reference/quota)
- [Supabase Production Checklist](https://supabase.com/docs/guides/platform/going-into-prod)

---

## Questions or Issues?

If you encounter problems during deployment:
1. Check platform logs (Railway/Vercel dashboard)
2. Review worker logs for errors
3. Test classification manually via UI
4. Verify environment variables are set correctly

Good luck with your production deployment! 🚀
