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
-- Query 3: are the chosen contacts already in Salesforce?
-- =====================================================================
SELECT account_name, first_name, last_name, contact_title,
       linked_in_profile_url_c, last_activity_date, left_the_company_c
FROM dim.sf_contact
WHERE account_name IN ('<company 1>', '<company 2>')
  AND (first_name || ' ' || last_name) IN ('<First Last>', '<First Last>');
