-- Queries for the peerspot-net-new-prospecting skill.
-- Run each through the Snowflake – PeerSpot connector (sql_exec_tool), one statement per call.
-- Tables: DIM.SF_ACCOUNT / DIM.SF_OPPORTUNITY / DIM.SF_CONTACT are the Fivetran mirror of Salesforce.
-- Note: FCT.IMPRESSION history currently starts 2026-08-01.


-- =====================================================================
-- Query 1: candidates
-- Replace the NOT IN list with companies already in the sheet + any skipped.
-- =====================================================================
WITH acct AS (
  SELECT a.account_id, a.account_name, a.vendor_id, a.number_of_employees, a.website,
         IFF(a.account_owner_name = 'Salesforce Notifications', 'Unassigned', a.account_owner_name) AS owner
  FROM dim.sf_account a
  WHERE a.account_status = 'Pre-Customer'
    AND a.icp_tier_c = 'Tier 1'
    AND a.vendor_id IS NOT NULL
    AND a.account_name NOT IN ('<already in sheet>', 'Anthropic', 'HP', 'Intel', 'AMD', 'OpenAI', 'xAI')
    AND NOT EXISTS (SELECT 1 FROM dim.sf_opportunity o
                    WHERE o.account_id = a.account_id AND o.stage_name NOT ILIKE 'closed%')
),
prod AS (
  SELECT vendor_id,
         COUNT(*)                 AS n_products,
         COUNT_IF(aws_listed)     AS aws_listed,
         COUNT_IF(google_listed)  AS gcp_listed,
         COUNT_IF(aws_top_2k)     AS aws_top_2k,
         COUNT_IF(google_top_1k)  AS google_top_1k,
         SUM(published_reviews_count) AS reviews
  FROM dim.product
  WHERE NOT COALESCE(product_eol, FALSE)
  GROUP BY 1
  HAVING COUNT_IF(aws_top_2k) + COUNT_IF(google_top_1k) > 0
),
imp AS (
  SELECT vendor_id,
         COUNT_IF(NOT COALESCE(is_known_ai_crawler, FALSE)) AS buyer_views_90d,
         COUNT(DISTINCT IFF(NOT COALESCE(is_known_ai_crawler, FALSE), company_domain, NULL)) AS buyer_companies_90d,
         COUNT_IF(ai_traffic_type = 'human') AS ai_referrals_90d,
         COUNT_IF(is_known_ai_crawler)       AS ai_crawls_90d
  FROM fct.impression
  WHERE impression_date >= DATEADD(day, -90, CURRENT_DATE)
    AND vendor_id IN (SELECT vendor_id FROM acct)
  GROUP BY 1
)
SELECT a.account_name, a.website, a.number_of_employees AS employees, a.owner,
       p.n_products, p.aws_listed, p.gcp_listed, p.aws_top_2k, p.google_top_1k, p.reviews,
       i.buyer_views_90d, i.buyer_companies_90d, i.ai_referrals_90d, i.ai_crawls_90d
FROM acct a
JOIN prod p USING (vendor_id)
JOIN imp  i USING (vendor_id)
WHERE i.buyer_views_90d >= 800
ORDER BY i.buyer_views_90d / (p.reviews + 5) DESC
LIMIT 20;


-- =====================================================================
-- Query 2: category ranking hook (latest month), top-2 categories per company
-- =====================================================================
WITH v AS (
  SELECT DISTINCT account_name, vendor_id
  FROM dim.sf_account
  WHERE account_name IN ('<company 1>', '<company 2>')
),
lm AS (SELECT MAX(ranking_month) AS m FROM fct.product_category_monthly_ranking),
r AS (
  SELECT v.account_name, r.product_name, r.category_id, r.category_name, r.rank, r.all_reviews,
         ROW_NUMBER() OVER (PARTITION BY v.account_name ORDER BY r.impressions DESC) AS rn
  FROM fct.product_category_monthly_ranking r
  JOIN dim.product p ON p.product_id = r.product_id
  JOIN v ON v.vendor_id = p.vendor_id
  WHERE r.ranking_month = (SELECT m FROM lm)
),
lead AS (
  SELECT category_id, product_name AS leader, all_reviews AS leader_reviews
  FROM fct.product_category_monthly_ranking
  WHERE ranking_month = (SELECT m FROM lm) AND rank = 1
)
SELECT r.account_name, r.product_name, r.category_name, r.rank, r.all_reviews,
       l.leader, l.leader_reviews, (SELECT m FROM lm) AS ranking_month
FROM r LEFT JOIN lead l USING (category_id)
WHERE rn <= 2
ORDER BY 1, rn;


-- =====================================================================
-- Query 3: net-new check. Any hit = NOT net-new, pick another contact.
-- One row per candidate: (company name, email domain, first name, last name).
-- =====================================================================
WITH p(co, dom, fn, ln) AS (SELECT * FROM VALUES
  ('<Company>', '<domain.com>', '<First>', '<Last>'))
SELECT p.co, p.fn || ' ' || p.ln AS who,
  (SELECT COUNT(*) FROM dim.sf_contact c
    WHERE LOWER(c.last_name) = LOWER(p.ln) AND LOWER(c.first_name) LIKE LOWER(LEFT(p.fn, 3)) || '%'
      AND (c.account_name ILIKE p.co || '%' OR c.email ILIKE '%' || p.dom)) AS in_contacts,
  (SELECT COUNT(*) FROM dim.sf_lead l
    WHERE LOWER(l.last_name) = LOWER(p.ln) AND LOWER(l.first_name) LIKE LOWER(LEFT(p.fn, 3)) || '%'
      AND (l.company ILIKE p.co || '%' OR l.email ILIKE '%' || p.dom)) AS in_leads,
  (SELECT COUNT(*) FROM dim.gong_call_participant g
    WHERE g.participant_name ILIKE '%' || p.ln || '%' AND g.email ILIKE '%' || p.dom) AS on_gong
FROM p;


-- =====================================================================
-- Query 4a: account brief - opportunities
-- =====================================================================
SELECT a.account_name, o.sf_opportunity_name, o.stage_name, o.opportunity_amount_usd,
       o.created_date::date AS created, o.close_date, o.loss_reason, o.next_step, o.owner_name
FROM dim.sf_opportunity o JOIN dim.sf_account a ON a.account_id = o.account_id
WHERE a.account_name IN ('<company 1>', '<company 2>')
ORDER BY a.account_name, o.created_date DESC;


-- =====================================================================
-- Query 4b: account brief - recent Gong calls with external attendees and AI summary
-- =====================================================================
SELECT a.account_name, g.call_start_datetime::date AS dt, g.title, g.owner_name,
       LISTAGG(DISTINCT p.participant_name || COALESCE(' (' || NULLIF(p.title, '') || ')', ''), '; ') AS external_people,
       ANY_VALUE(g.ai_summary_brief) AS summary, ANY_VALUE(g.ai_next_steps) AS next_steps
FROM dim.gong_call g
JOIN dim.sf_account a ON a.account_id = g.sf_account_id
LEFT JOIN dim.gong_call_participant p ON p.call_id = g.call_id AND NOT COALESCE(p.is_internal, FALSE)
WHERE a.account_name IN ('<company 1>', '<company 2>')
  AND g.call_start_datetime >= DATEADD(year, -1, CURRENT_DATE)
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2 DESC;


-- =====================================================================
-- Query 4c: account brief - activity volume (mostly automated email) in the last 90 days
-- =====================================================================
SELECT account_name, owner_name, task_type, COUNT(*) AS n, COUNT(DISTINCT who_name) AS people,
       MAX(activity_date) AS last_dt, ANY_VALUE(subject) AS sample_subject
FROM dim.sf_task
WHERE account_name IN ('<company 1>', '<company 2>')
  AND activity_date >= DATEADD(day, -90, CURRENT_DATE)
GROUP BY 1, 2, 3
ORDER BY 1, n DESC;
