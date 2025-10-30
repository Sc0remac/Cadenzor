# Brand Alignment System Proposal

## Overview

This document outlines a comprehensive brand-fit scoring system for Kazador that automates sender vetting while remaining transparent and customizable. The system analyzes new email senders (people and organizations) to determine whether they align with brand values and are worth engaging with.

## Core Concept

When new emails arrive, the system should:
1. Analyze the sender (person and organization)
2. Determine brand alignment through automated research
3. Surface genuinely worthwhile opportunities
4. Flag potential risks or controversies
5. Provide explainable scores that Oren can customize

---

## High-Level Architecture

### 1. Sender Analysis Pipeline

```
Email Arrives
    ↓
Classify & Extract Entities (person, org, venue)
    ↓
Check Exclusion List (known contacts, partners)
    ↓
[If not excluded] → Trigger Brand Fit Analysis
    ↓
Parallel Research Tasks:
    ├─ Web Search & Entity Resolution
    ├─ Controversy Detection
    ├─ Reputation Signals
    ├─ Social/Cultural Alignment
    └─ Historical Context (past interactions)
    ↓
Compute Brand Fit Score (weighted rubric)
    ↓
Store Results + Citations
    ↓
Surface in UI (Dashboard, Project Hub, Email Inbox)
```

### 2. Research & Intelligence Layer

**MCP Agents & Tools:**

1. **Entity Resolution Agent**
   - Extract: person name, job title, company, venue, domain
   - Use: LinkedIn API (limited), Clearbit, Hunter.io, or web scraping
   - Outcome: Canonical entity profile with LinkedIn, website, social handles

2. **Web Search Agent** (MCP `@modelcontextprotocol/server-brave-search` or similar)
   - Query: `"{person name}" {company}`, `"{venue name}" reviews`, `"{company} controversy"`
   - Sources: Google Custom Search API, Bing Search API, Serper API, or Brave Search
   - Parse: Top 10-20 results, extract snippets, dates, sentiment

3. **News & Controversy Monitor**
   - Use: NewsAPI, GDELT, or News scraper
   - Query: `"{entity}" + ("scandal" OR "controversy" OR "lawsuit" OR "complaint")`
   - Flag: Articles in last 12 months with negative sentiment
   - Store: URLs, headlines, dates, sentiment scores

4. **Reputation Signals Aggregator**
   - Venue databases: Resident Advisor, Bandsintown, Songkick (API or scrape)
   - Review sites: Glassdoor (for orgs), Yelp/Google Maps (venues), Trustpilot
   - Social signals: Twitter/X mentions, Reddit discussions (Snoowrap API)
   - Output: Aggregate ratings, review count, follower count, engagement metrics

5. **Cultural/Political Risk Analyzer**
   - Geography: Map location to country/region; cross-reference with UK FCO travel advisories, US State Dept warnings
   - Political alignment: Check if org/venue has been involved in political campaigns or controversies
   - Cultural fit: NLP sentiment analysis on recent public statements, press, social posts

**AI/NLP Models:**

- **Named Entity Recognition (NER):** spaCy, AWS Comprehend, or OpenAI GPT for extracting entities from email bodies
- **Sentiment Analysis:** Hugging Face `cardiffnlp/twitter-roberta-base-sentiment`, OpenAI embeddings, or AWS Comprehend
- **Summarization:** OpenAI GPT-4 to synthesize research findings into a concise explainer
- **Controversy Detection:** Custom prompt to GPT-4: *"Analyze these search results and identify any controversies, scandals, or negative associations. Return a severity score (0-10) and summary."*

---

## 3. Scoring Engine Architecture

### Brand Rubric Schema

**Stored in `brand_rubrics` table:**

```typescript
interface BrandRubric {
  id: string;
  name: string;
  version: string;
  created_by: string;
  dimensions: RubricDimension[];
  thresholds: { accept: number; caution: number; decline: number };
}

interface RubricDimension {
  key: string; // e.g., "reliability", "brand_alignment", "controversy"
  label: string;
  weight: number; // 0.0 - 1.0
  compute_method: "manual" | "computed" | "hybrid";
  subscores?: Subscore[];
}

interface Subscore {
  key: string; // e.g., "venue_rating", "news_sentiment"
  label: string;
  weight: number;
  data_source: string; // e.g., "ra_rating", "news_api"
  transform: "linear" | "log" | "threshold";
}
```

### Dimensions & Subscores

| Dimension | Weight (default) | Subscores |
|-----------|-----------------|-----------|
| **Reputation** | 0.25 | • Venue/org rating (RA, Google, etc.)<br>• Review count & recency<br>• Social proof (followers, engagement) |
| **Controversy** | 0.30 | • Negative news count (last 12mo)<br>• Severity of issues (NLP-scored)<br>• Blacklist/sanctions check |
| **Brand Alignment** | 0.25 | • Cultural fit (music genre, audience, tone)<br>• Past collaboration success<br>• Geography/territory match<br>• Artist-specific preferences |
| **Reliability** | 0.15 | • Past interaction history (canceled shows, late payments)<br>• Email response time (avg)<br>• Contract compliance (if known) |
| **Opportunity** | 0.05 | • Audience overlap (Spotify/social)<br>• PR value (media reach)<br>• Financial upside (fee vs. average) |

### Scoring Formula

```typescript
function computeBrandFitScore(
  enrichedData: EnrichedContact,
  rubric: BrandRubric
): BrandFitResult {
  let totalScore = 0;
  let totalWeight = 0;
  const evidence: Evidence[] = [];

  for (const dimension of rubric.dimensions) {
    const dimensionScore = computeDimensionScore(enrichedData, dimension);
    totalScore += dimensionScore * dimension.weight;
    totalWeight += dimension.weight;
    evidence.push({
      dimension: dimension.label,
      score: dimensionScore,
      citations: dimensionScore.citations,
    });
  }

  const normalizedScore = (totalScore / totalWeight) * 100; // 0-100
  const band = getBand(normalizedScore, rubric.thresholds);

  return {
    score: normalizedScore,
    band, // "accept" | "caution" | "decline"
    evidence,
    rubric_version: rubric.version,
    computed_at: new Date(),
  };
}
```

### Explainability

Each subscore includes **citations** (URLs, dates, snippets) so Oren can see *why* the system gave a certain score.

**Example:**

```json
{
  "dimension": "Controversy",
  "score": 62,
  "subscores": [
    {
      "key": "news_sentiment",
      "score": 55,
      "citations": [
        {
          "source": "The Guardian",
          "url": "https://...",
          "headline": "Venue X accused of poor working conditions",
          "date": "2025-03-15",
          "sentiment": -0.7
        }
      ]
    }
  ]
}
```

---

## 4. Data Model Extensions

### New Tables

```sql
-- Brand rubrics (versioned scoring configs)
CREATE TABLE brand_rubrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  dimensions JSONB NOT NULL, -- RubricDimension[]
  thresholds JSONB NOT NULL, -- { accept, caution, decline }
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Contact enrichment data
CREATE TABLE contact_enrichment (
  contact_id UUID PRIMARY KEY REFERENCES contacts(id),
  org_id UUID REFERENCES orgs(id),
  linkedin_url TEXT,
  website TEXT,
  social_handles JSONB, -- { twitter, instagram, ... }
  location JSONB, -- { city, country, iso2 }
  biography TEXT,
  reputation_score NUMERIC, -- aggregate from reviews/ratings
  last_enriched_at TIMESTAMPTZ,
  metadata JSONB
);

-- Brand fit assessments
CREATE TABLE brand_fit_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  org_id UUID REFERENCES orgs(id),
  rubric_id UUID REFERENCES brand_rubrics(id),
  rubric_version TEXT NOT NULL,
  score NUMERIC NOT NULL, -- 0-100
  band TEXT NOT NULL, -- "accept" | "caution" | "decline"
  evidence JSONB NOT NULL, -- Evidence[]
  computed_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, -- re-assess after N months
  reviewed_by UUID REFERENCES auth.users(id),
  review_note TEXT
);

-- Organizations
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  org_type TEXT, -- "venue", "label", "agency", "media", etc.
  location JSONB,
  website TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Contact-org relationships
CREATE TABLE contact_orgs (
  contact_id UUID REFERENCES contacts(id),
  org_id UUID REFERENCES orgs(id),
  role TEXT, -- "owner", "agent", "manager", etc.
  is_primary BOOLEAN DEFAULT false,
  PRIMARY KEY (contact_id, org_id)
);
```

---

## 5. UI/UX for Customization

### Rubric Builder (`/settings/brand-rubrics`)

- Drag-and-drop dimension weights (sliders with real-time preview)
- Add/remove dimensions and subscores
- Set thresholds (Accept: 80+, Caution: 50-79, Decline: <50)
- Preview: Test against historical contacts to see how scores would change
- Versioning: Save as new version; compare rubrics side-by-side

### Email Inbox Enhancements

- **Brand Fit Badge:** Show score/band next to sender name (e.g., 🟢 85 | Accept)
- **Expand Evidence:** Click badge to see dimension breakdown + citations
- **Override:** Manual "Accept anyway" or "Decline despite score" with note (logged to `action_logs`)
- **Exclusion List:** Quick-add to exclusion list ("Always accept from this sender")

### Dashboard Widget

- **Top Opportunities:** High-scoring new leads (Accept band) awaiting action
- **Flagged Contacts:** Caution/Decline band contacts with reasons (controversies, low reputation)
- **Rubric Health:** Show % of emails auto-accepted, % needing review, avg score over time

---

## 6. Implementation Plan

### Phase 1: Core Pipeline
1. Extend `contacts` and `emails` tables with `brand_fit_score`, `brand_fit_band`, `excluded_from_scoring` flag
2. Worker job: `assessBrandFit()` triggered after email classification if sender is unknown
3. Integrate web search MCP agent (Brave Search or Serper)
4. Store raw research data in `contact_enrichment.metadata`

### Phase 2: Scoring Engine
1. Implement `brand_rubrics` table and seed default rubric
2. Build scoring functions with weighted dimensions
3. Add citations and explainability to results
4. Store assessments in `brand_fit_assessments` table

### Phase 3: UI & Customization
1. Build `/settings/brand-rubrics` page (rubric CRUD + preview)
2. Add brand fit badge to email inbox and contact cards
3. Evidence drawer with citations and links
4. Exclusion list management UI

### Phase 4: Advanced Intelligence
1. Integrate Resident Advisor, Bandsintown, Songkick APIs for venue ratings
2. Add social signals (Twitter/X, Instagram follower counts, engagement)
3. Implement past interaction tracking (reliability dimension)
4. Build automated re-assessment cron job (expire old scores after 6 months)

---

## 7. Additional Factors & Considerations

### Factors to Include

- **Payment History:** If you've worked with this contact/org before, did they pay on time?
- **Cancellation Rate:** Historical data on shows/interviews they've canceled
- **Audience Demographics:** Match between venue/label audience and artist's fanbase (Spotify/Chartmetric data)
- **Media Reach:** Journalist or outlet's circulation/readership, social following
- **Seasonal Patterns:** Venue performance during specific months (tourism seasons, local events)
- **Visa/Immigration Risk:** For international offers, assess visa complexity and denial rates
- **Insurance/Legal Red Flags:** Venue/promoter has history of insurance claims, lawsuits
- **Environmental/Social Governance (ESG):** If Oren's brand values sustainability, flag orgs with poor ESG records

### Edge Cases

- **Data Freshness:** Cache enrichment data but re-assess if >6 months old or if major news event detected
- **No Results:** If web search returns nothing, score as "unknown" (neutral) rather than decline
- **Conflicting Signals:** High venue rating but recent controversy → Caution band with explanation
- **False Positives:** Common names may return irrelevant search results; use domain matching and job title to disambiguate
- **Privacy:** Avoid scraping personal social media profiles without consent; focus on professional/public entities

### Guardrails

- **Human-in-the-Loop:** Never auto-decline; only surface recommendations
- **Audit Trail:** Log all assessments, overrides, and rubric changes in `action_logs`
- **Bias Monitoring:** Track if certain geographies or org types are systematically scored lower; adjust rubric if unfair
- **Transparency:** Always show evidence and allow Oren to review raw data

---

## 8. Recommended Tools & APIs

| Component | Tool/Service | Cost |
|-----------|-------------|------|
| **Web Search** | Brave Search API, Serper.dev, Google Custom Search | $5-50/mo |
| **Entity Data** | Clearbit (enrich email → company), Hunter.io (find email metadata) | $50-200/mo |
| **News** | NewsAPI.org, GDELT (free), GNews | Free - $50/mo |
| **Venue Data** | Resident Advisor (scrape), Bandsintown API, Songkick API | Free/scrape |
| **Social Signals** | Twitter/X API (Basic tier), Instagram Graph API (limited) | $100/mo |
| **Sentiment Analysis** | OpenAI GPT-4, Hugging Face Inference API | $10-100/mo |
| **NLP/NER** | spaCy (self-hosted), AWS Comprehend | Free/usage-based |
| **MCP Agents** | `@modelcontextprotocol/server-brave-search`, custom research agent | Free |

---

## Summary

This system provides **deterministic, explainable, and customizable** brand-fit scoring that:

- Automates 80% of vetting for routine inquiries
- Surfaces high-quality leads Oren would otherwise miss
- Flags risks (controversies, low reputation) before engagement
- Adapts to evolving brand priorities via rubric versioning
- Maintains full transparency with citations and human override

---

## Next Steps

1. Refine rubric dimensions and weights with Oren
2. Implement database schema extensions
3. Build core scoring engine
4. Integrate web search and entity resolution agents
5. Design UI for rubric customization and evidence display
