import type { EmailLabel } from "./types";
import { normaliseLabels } from "./labelUtils";

export const HEURISTIC_LABEL_RULES: ReadonlyArray<{ regex: RegExp; label: EmailLabel }> = [
  { regex: /\b(contract\s*draft|draft contract|redline|tracked changes?|markup)\b/i, label: "LEGAL/Contract_Draft" },
  { regex: /\b(fully executed|counter[-\s]?signed|signed contract|executed contract)\b/i, label: "LEGAL/Contract_Executed" },
  { regex: /\b(addendum|amendment|change order|contract update)\b/i, label: "LEGAL/Addendum_or_Amendment" },
  { regex: /\b(nda|non[-\s]?disclosure|clearance|sync licen[sc]e|image release)\b/i, label: "LEGAL/NDA_or_Clearance" },
  { regex: /\b(certificate of insurance|\bcoi\b|insurance|indemnity|liability cover)\b/i, label: "LEGAL/Insurance_Indemnity" },
  { regex: /\b(gdpr|data request|privacy|compliance|policy update)\b/i, label: "LEGAL/Compliance" },
  { regex: /\b(settlement|net payout|show statement|settlement report)\b/i, label: "FINANCE/Settlement" },
  { regex: /\b(invoice|invoicing|billing|bill number)\b/i, label: "FINANCE/Invoice" },
  { regex: /\b(remittance|payment confirmation|wire confirmation|proof of payment)\b/i, label: "FINANCE/Payment_Remittance" },
  { regex: /\b(iban|swift|bank details|bank account|banking details)\b/i, label: "FINANCE/Banking_Details" },
  { regex: /\b(w[-\s]?8|w[-\s]?9|tax form|vat number|withholding certificate|irs form)\b/i, label: "FINANCE/Tax_Docs" },
  { regex: /\b(receipt|expense|per diem|reimbursement|expense report)\b/i, label: "FINANCE/Expenses_Receipts" },
  { regex: /\b(royalt(y|ies)|publishing statement|prs report|socan|soundexchange)\b/i, label: "FINANCE/Royalties_Publishing" },
  { regex: /\b(itinerary|day\s*sheet|run of show|ros)\b/i, label: "LOGISTICS/Itinerary_DaySheet" },
  { regex: /\b(flight|airline|travel itinerary|booking reference|ferry|train ticket)\b/i, label: "LOGISTICS/Travel" },
  { regex: /\b(hotel|airbnb|lodging|accommodation|rooming list)\b/i, label: "LOGISTICS/Accommodation" },
  { regex: /\b(driver|pickup|ground transport|car service|shuttle|uber|ride share)\b/i, label: "LOGISTICS/Ground_Transport" },
  { regex: /\b(visa|immigration|work permit|passport details|esta appointment)\b/i, label: "LOGISTICS/Visas_Immigration" },
  { regex: /\b(tech rider|technical advance|stage plot|input list|backline|foh|monitor mix)\b/i, label: "LOGISTICS/Technical_Advance" },
  { regex: /\b(accreditation|wristband|aaa pass|access list|guest list|credentials)\b/i, label: "LOGISTICS/Passes_Access" },
  { regex: /\b(offer|proposal|deal memo|term sheet|financial offer)\b/i, label: "BOOKING/Offer" },
  { regex: /\b(hold|availability|date check|pencil|avail)\b/i, label: "BOOKING/Hold_or_Availability" },
  { regex: /\b(confirm(ed|ing)|green light|go ahead|locked in)\b/i, label: "BOOKING/Confirmation" },
  { regex: /\b(reschedul(e|ing)|postpone|cancel(l|led|lation)|date change)\b/i, label: "BOOKING/Reschedule_or_Cancel" },
  { regex: /\b(promo time|press day|interview slot|media request|promo request)\b/i, label: "PROMO/Promo_Time_Request" },
  { regex: /\b(press feature|article|review|write[-\s]?up|coverage request)\b/i, label: "PROMO/Press_Feature" },
  { regex: /\b(radio play|airplay|playlist|premiere|spin request)\b/i, label: "PROMO/Radio_Playlist" },
  { regex: /\b(liner|id request|bio|quote request|promo copy|deliverable)\b/i, label: "PROMO/Deliverables" },
  { regex: /\b(promo submission|demo|track submission|sending (a )?track|for consideration)\b/i, label: "PROMO/Promos_Submission" },
  { regex: /\b(artwork|poster|banner|cover image|graphic)\b/i, label: "ASSETS/Artwork" },
  { regex: /\b(wav|audio file|master|mixdown|stems|instrumental)\b/i, label: "ASSETS/Audio" },
  { regex: /\b(video|clip|teaser|footage|edit|cutdown)\b/i, label: "ASSETS/Video" },
  { regex: /\b(photo|photoshoot|gallery|press shot|imagery)\b/i, label: "ASSETS/Photos" },
  { regex: /\b(logo|brand guidelines|style guide|lockup|branding assets)\b/i, label: "ASSETS/Logos_Brand" },
  { regex: /\b(epk|one[-\s]?sheet|press kit|one[-\s]?pager)\b/i, label: "ASSETS/EPK_OneSheet" },
  { regex: /\b(love your music|big fan|thank you|appreciate your work)\b/i, label: "FAN/Support_or_Thanks" },
  { regex: /\b(birthday request|wedding|shout[-\s]?out|special request|surprise)\b/i, label: "FAN/Request" },
  { regex: /\b(urgent|issue|concern|safety|harassment|wellbeing)\b/i, label: "FAN/Issues_or_Safety" },
];

export function heuristicLabels(subject: string, body: string): EmailLabel[] {
  const labels: EmailLabel[] = [];

  for (const { regex, label } of HEURISTIC_LABEL_RULES) {
    if (regex.test(subject) || regex.test(body)) {
      labels.push(label);
    }
  }

  if (labels.length === 0) {
    const subjectPrefix = subject.split(/[:\-]/)[0];
    const fallback = normaliseLabels(subjectPrefix);
    if (fallback.length > 0) {
      labels.push(...fallback);
    }
  }

  return Array.from(new Set(labels));
}
