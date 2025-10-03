import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";
import {
  analyzeEmail,
  ensureDefaultLabelCoverage,
  heuristicLabels,
  normaliseLabels,
  selectPrimaryCategory,
} from "@cadenzor/shared";
import { classifyEmail } from "../classifyEmail.js";
import { fakeEmailFixtures } from "../fixtures/fakeEmails.js";

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY must be set for analyzeEmail to call OpenAI");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log(`Classifying ${fakeEmailFixtures.length} seeded emails...`);

  for (const fixture of fakeEmailFixtures) {
    try {
      const classification = await classifyEmail(
        {
          subject: fixture.subject,
          body: fixture.body,
          fromName: fixture.fromName,
          fromEmail: fixture.fromEmail,
        },
        {
          analyzeEmail,
          heuristicLabels,
          normaliseLabels,
          ensureDefaultLabelCoverage,
          selectPrimaryCategory,
          onError: (error) => {
            console.error(`OpenAI classification failed for ${fixture.id}:`, error);
          },
        }
      );

      const { error: contactError } = await supabase
        .from("contacts")
        .upsert(
          {
            email: fixture.fromEmail,
            name: fixture.fromName,
            last_email_at: fixture.receivedAt,
          },
          { onConflict: "email" }
        );

      if (contactError) {
        console.error(`Failed to upsert contact for ${fixture.id}:`, contactError);
      }

      const { error: emailError } = await supabase
        .from("emails")
        .upsert(
          {
            id: fixture.id,
            from_name: fixture.fromName,
            from_email: fixture.fromEmail,
            subject: fixture.subject,
            received_at: fixture.receivedAt,
            category: classification.category,
            is_read: false,
            summary: classification.summary,
            labels: classification.labels,
          },
          { onConflict: "id" }
        );

      if (emailError) {
        console.error(`Failed to upsert email for ${fixture.id}:`, emailError);
      }

      console.log(
        `${fixture.id} -> ${classification.category} | expected ${fixture.expectedLabel} | ` +
          `${classification.labels.join(", ")}`
      );
    } catch (error) {
      console.error(`Failed to classify fixture ${fixture.id}:`, error);
    }
  }

  console.log("Done. Inspect Supabase records or the app UI to verify labels.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
