---
name: peerspot-net-new-prospecting
description: Find net-new PeerSpot customers (software vendors) and prepare personalized LinkedIn outreach. Use when someone asks to "find me 10 more prospects", "find potential customers", "build a prospect list", "net-new outreach", or wants target accounts from the AWS Top 2K / Google Top 1K lists with decision-makers and drafted LinkedIn messages. Pulls buyer-traffic, AI-traffic and category-ranking hooks from PeerSpot's Snowflake, finds contacts in ZoomInfo, and appends rows to the shared Google Sheet for human review. Never sends messages.
---

# PeerSpot net-new prospecting

PeerSpot sells review-collection programs to software vendors. PeerSpot is the review
provider for AWS Marketplace and Google Cloud Marketplace. This skill finds vendors who
are getting buyer attention on PeerSpot but have few reviews, finds the right marketing
people there, and drafts outreach that leads with PeerSpot's own data about them.

## Connectors needed

- **Snowflake – PeerSpot** (`sql_exec_tool`): Salesforce mirror + PeerSpot product/traffic data
- **ZoomInfo**: `search_contacts` (free), `enrich_contacts` (1 credit per new contact)
- **Google Sheets / Google Drive**: read and append the output sheet

If any is missing, stop and say which one.

## Defaults (override if the user says otherwise)

| Setting | Default |
|---|---|
| Companies per run | 10 |
| Contacts per company | 2 (one "A" priority, one "B") |
| Output sheet | `1L3Zsx6FJehntkxH0czKJXfDETeJ3cFIZaTcRgBdsOsU`, tabs `Net-new contacts` + `Account briefs` |
| Traffic window | last 90 days |

## Target definition (agreed with the team, keep it simple)

A company qualifies only if **all** are true:
1. Salesforce `ACCOUNT_STATUS = 'Pre-Customer'` (never a customer; churned/active are out of scope)
2. `ICP_TIER_C = 'Tier 1'`
3. At least one non-EOL product flagged `AWS_TOP_2K` or `GOOGLE_TOP_1K` (the target-account lists)
4. No open Salesforce opportunity
5. Not already in the output sheet (any status)

Use judgment to skip poor fits: frontier AI labs, hardware/semiconductor giants (HP, Intel,
AMD), and anything that isn't a B2B software vendor. Say which ones you skipped and why.

## Workflow

### 1. Load what's already been done
Read the `Company` column of the `Net-new contacts` tab and keep the list for the exclusion filter.

### 2. Pull and score candidates
Run **Query 1** in `queries.sql`, filling in the exclusion list. It returns traffic, AI traffic
and review counts per company, sorted by buyer views per review. Take the top 10 that pass the
judgment check. Pull ~20 rows so you have spares.

### 3. Get the ranking hook
Run **Query 2** for the chosen companies. It returns each company's top-2 product/category
ranks from the latest month plus the #1 product and its review count.
If the category looks nonsensical (e.g. a science product ranked under "AWS Marketplace"),
mark the rank `n/a (category mapping noisy)` and lead with traffic instead.

### 4. Find decision-makers
For each company, call ZoomInfo `search_contacts` (free) with `companyWebsite` and:
- `jobTitleList`: Product Marketing, Customer Marketing, Customer Advocacy, Chief Marketing
  Officer, VP Marketing, Analyst Relations, AWS Alliance
- `managementLevelList`: C Level Exec, VP Level Exec, Director (add Manager for companies
  under ~1,000 employees)

Pick 2 per company. Preference order for **A**: Customer Advocacy / Customer Marketing lead →
Analyst Relations → Head/VP/Sr Director Product Marketing → CMO. The **B** contact is usually the CMO
or a second PMM. Prefer someone new in role (position start in the last ~6 months), since
that's a natural opener.

**Contacts must be net-new.** Run **Query 3** before enriching. Drop anyone who appears at this
company as a Salesforce **contact or lead** (any status), or as an external participant on a Gong
call, and pick the next candidate. Pull 10–15 candidates per company in ZoomInfo so you have spares.

Enrich only the remaining contacts with `enrich_contacts` (batches of ≤10, `personId`,
`requiredFields`: firstName, lastName, jobTitle, companyName, email, externalUrls,
positionStartDate). Before enriching, state how many credits the run will spend.

Sanity-check each result. If the LinkedIn URL clearly belongs to someone else (different name
or profession) or there's no email, flag `VERIFY`. If there's no LinkedIn URL, put
`(find on LinkedIn)`.

### 5. Draft messages
For each non-HOLD contact, write:
- **Connection note**: **at most 300 characters** (LinkedIn's limit; check the length). One concrete
  PeerSpot data point + a soft ask to connect. No pitch.
- **Follow-up DM** (after they accept): 2–4 sentences. Include the marketplace line:
  *"PeerSpot is the review provider for AWS Marketplace and Google Cloud Marketplace, so
  reviews collected with us also reach buyers where they purchase."* Then one more data point
  and a 20-minute ask.

Hooks, strongest first. Use the one that's most striking for that company:
1. **Winnable ranking**: "#4 in X with 0 reviews, and #1 has only 4"
2. **Close to #1**: "#2, 18 reviews behind #1"
3. **AI traffic**: "N buyer visits last quarter came straight from AI assistants like ChatGPT".
   Use only when N ≥ ~5. AI crawler reads work as a secondary point when large (hundreds+).
4. **Traffic vs reviews**: "buyers from N companies, X views, only Y reviews"
5. **New in role**: open with "congrats on joining …"
6. **Role fit**: for analyst relations, mention "given your AR role…"; for customer advocacy,
   say "your advocates could close that fast"

Rules:
- Every number must come from the queries. Never round up or invent ("more than any vendor
  we track" and similar claims are banned unless you computed them).
- Say "last 90 days" / "last quarter" for traffic and "on PeerSpot" for ranks.
- Plain, peer-to-peer tone. No hype words, no emojis.

Also write an **email** version (subject + short body: the hook, the marketplace line, a
20-minute ask; no signature).

### 6. Account brief (Salesforce status)
For each company, run **Query 4** and summarize: every opportunity (stage, amount, close date,
loss reason, last next step), the last real conversation (Gong calls, with external attendees and
AI summary/next steps), who's already in Salesforce, and how much automated email they're
getting. Set the **Account play**:
- `Fresh`: no opportunity in the last 2 years
- `Re-engage (lost <month>)`: closed-lost in the last 2 years, no call in the last 60 days
- `Active – coordinate with <owner>`: a Gong call in the last 60 days. Reps must check with the
  owner before sending.

End each brief with one concrete **recommended next step**. For example: go to the person a call
named as the decision-maker, or re-open on the timing from the loss reason.

### 7. Write to the sheet
Two tabs:
- **Net-new contacts** (append): `Priority | Rep | Account play | Company | Contact | Title |
  In role since | Email | Buyer views (90d) | Buyer cos (90d) | AI-assistant visits (90d) |
  Reviews | Category rank | 1. LinkedIn connection note | 2. LinkedIn DM | 3. Email subject |
  3. Email body | Status`. Write the Contact cell as `=HYPERLINK("<linkedin url>","<Name>")`
  using `update_formulas`. With no URL, link a LinkedIn people search
  (`https://www.linkedin.com/search/results/people/?keywords=<Name> <Company>`) labelled
  "<Name> (search)". Rep: account owner; "Salesforce Notifications" means `UNASSIGNED`.
  Status: `Not sent`.
- **Account briefs** (append or update the row for that company): `Company | Rep | Account play |
  Target list | Salesforce opportunities | Last real conversation | Already in Salesforce
  (don't cold-pitch) | Recommended next step`.

### 8. Report back
Keep it short: the sheet link, the 10 companies with their account play, which accounts are
UNASSIGNED, any VERIFY flags, any companies skipped and why, and ZoomInfo credits spent.

## Guardrails
- **Never send** LinkedIn messages, connection requests, or emails. Humans review and send.
  LinkedIn bans automation.
- Don't write to Salesforce.
- Don't target Active, Churned or Lapsed accounts. Expansion and win-back are separate plays.
- If Query 1 returns fewer than 10 qualifying companies, return what you found and say so;
  don't loosen the target definition without asking.
