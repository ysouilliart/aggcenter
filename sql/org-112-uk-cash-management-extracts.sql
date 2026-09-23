-- =============================================================================
-- aggcenter / ORG 112 (UK) — Oracle EBS cash-management extracts (Snowflake)
-- =============================================================================
-- Purpose
--   Produce supporting extracts that raise bank-statement reconciliation match
--   rate. The bank statement remains the money-proof baseline. These queries
--   only identify each bank line (SO / PO / INV / remittance / receipt /
--   payment / party-bank / non-trade).
--
-- How aggcenter matches today (src/lib/recon/reconcile.ts)
--   Lookup order, 0 amount tolerance, date is not a constraint:
--     1. SO/PO id token in bank narrative / customer ref / bank ref
--     2. PO number or AP supplier invoice number
--     3. Remittance invoice number / distinctive remittance number
--     4. Unique remittance at the exact amount
--     5. Exact amount + loose counterparty name
--     6. Unique SO/PO at the exact amount
--   Tokens taken from bank text: SO-n / PO-n / [INV][A-Z]{0,6}d{5,12}
--   Generic remittance numbers are discarded: BACS, CHAPS, FASTER, CASH,
--   CHECK, CHEQUE, DD, DIRECTDEBIT, ABI.
--
-- Current OCI drop-in files (do not rename columns used by ingest)
--   INV_112/  ap_invoice_header.csv + ap_invoice_line.csv
--   PO_112/   po_header.csv + po_lines.csv
--   SO_112/   sales_order_header.csv + charges_component.csv
--   REM_112/  remittance.csv
--
-- Why match rate stalls with the current four extracts
--   * O2C bank lines quote AR invoice / NHS remittance refs, not OE order ids.
--   * REM remittance_number is often "BACS" (discarded by the matcher).
--   * One HSBC credit is often a receipt batch / deposit, not one receipt.
--   * P2P bank lines quote IBY payment / end-to-end ids, not PO numbers.
--   * Amount-only matches collide; payee / IBAN / account name isolates them.
--   * Unmatched payroll / HMRC / intercompany / FX should be classified, not
--     forced onto trade SO/PO/REM.
--   * Short-pays need remaining AR/AP + credit memos, not only original totals.
--
-- Filters (same baseline as today's extracts, plus a cash-date override)
--   org_id = 112 (UK / OU ResMed UK)
--   creation_date >= CURRENT_TIMESTAMP - 6 months   -- extract object window
--   For receipts/payments, ALSO keep rows whose cash date is in the window
--   even when the invoice was created earlier (otherwise paid-old-invoice
--   bank lines have no supporting remittance).
--
-- Snowflake replica
--   Point EBS_DB / EBS_SCHEMA at the schema that holds the EBS table copies
--   used for operational reporting. Default matches .env.example
--   (SNOWFLAKE_DATABASE=FINANCE, SNOWFLAKE_SCHEMA=PUBLIC). Change these two
--   session variables if the replica lives elsewhere (e.g. EBS, APPS, XXCUS).
--
-- How to run
--   1. Set the session variables in section 0.
--   2. Run section 1 (discovery) and confirm table names.
--   3. Run section 2 (params + helper views).
--   4. Run sections 3–4 (drop-in + additional extracts).
--   5. COPY INTO CSV (section 5) or SELECT from CASH_MGMT_EXTRACTS.*
--
-- Grokbot
--   Views land in CASH_MGMT_EXTRACTS. Drop-in views keep the column names
--   src/lib/reference/fromExtracts.ts already reads. Extra columns are
--   ignored by current ingest and are safe to export.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Session — database / schema / org / lookback
-- -----------------------------------------------------------------------------
SET EBS_DB = 'FINANCE';
SET EBS_SCHEMA = 'PUBLIC';          -- schema that holds EBS table copies
SET EXTRACT_DB = 'FINANCE';
SET EXTRACT_SCHEMA = 'CASH_MGMT_EXTRACTS';
SET ORG_ID = 112;
SET LOOKBACK_MONTHS = 6;

USE DATABASE IDENTIFIER($EBS_DB);
USE SCHEMA IDENTIFIER($EBS_SCHEMA);

CREATE DATABASE IF NOT EXISTS IDENTIFIER($EXTRACT_DB);
CREATE SCHEMA IF NOT EXISTS IDENTIFIER($EXTRACT_DB || '.' || $EXTRACT_SCHEMA);

-- -----------------------------------------------------------------------------
-- 1. Discovery — confirm which replica tables exist before building views
-- -----------------------------------------------------------------------------
-- Run this first. If a name is missing, search INFORMATION_SCHEMA for a
-- close match (lowercase, module prefix, or _V view) and edit the helper
-- views in section 2.

WITH expected (module, table_name, role) AS (
  SELECT * FROM VALUES
    ('HR',  'HR_OPERATING_UNITS',              'UK operating unit name'),
    ('AP',  'AP_INVOICES_ALL',                 'AP invoice headers (INV)'),
    ('AP',  'AP_INVOICE_LINES_ALL',            'AP invoice lines / PO link'),
    ('AP',  'AP_INVOICE_PAYMENTS_ALL',         'AP invoice ↔ payment'),
    ('AP',  'AP_CHECKS_ALL',                   'AP payment documents'),
    ('AP',  'AP_PAYMENT_SCHEDULES_ALL',        'Open AP remaining'),
    ('AP',  'AP_SUPPLIERS',                    'Vendor master (R12)'),
    ('AP',  'AP_SUPPLIER_SITES_ALL',           'Vendor site / country'),
    ('PO',  'PO_HEADERS_ALL',                  'Purchase order headers'),
    ('PO',  'PO_LINES_ALL',                    'Purchase order lines'),
    ('PO',  'PO_VENDORS',                      'Vendor master (R11 leftover)'),
    ('OM',  'OE_ORDER_HEADERS_ALL',            'Sales order headers'),
    ('OM',  'OE_ORDER_LINES_ALL',              'Sales order lines'),
    ('AR',  'RA_CUSTOMER_TRX_ALL',             'AR invoices / credit memos'),
    ('AR',  'RA_CUSTOMER_TRX_LINES_ALL',       'AR lines + sales order link'),
    ('AR',  'RA_CUST_TRX_TYPES_ALL',           'AR document types'),
    ('AR',  'AR_CASH_RECEIPTS_ALL',            'AR receipts (REM in)'),
    ('AR',  'AR_RECEIVABLE_APPLICATIONS_ALL',  'Receipt → invoice applications'),
    ('AR',  'AR_PAYMENT_SCHEDULES_ALL',        'Open AR remaining'),
    ('AR',  'AR_RECEIPT_METHODS',              'BACS / CHAPS / cheque'),
    ('AR',  'AR_CASH_RECEIPT_HISTORY_ALL',     'Deposit / remittance batch'),
    ('AR',  'AR_BATCHES_ALL',                  'Receipt batches'),
    ('HZ',  'HZ_PARTIES',                      'Customer / supplier names'),
    ('HZ',  'HZ_CUST_ACCOUNTS',                'Customer accounts'),
    ('HZ',  'HZ_CUST_ACCT_SITES_ALL',          'Customer sites'),
    ('HZ',  'HZ_CUST_SITE_USES_ALL',           'Bill-to / ship-to'),
    ('HZ',  'HZ_LOCATIONS',                    'Country / address'),
    ('IBY', 'IBY_PAYMENTS_ALL',                'Oracle Payments (BACS out)'),
    ('IBY', 'IBY_DOCS_PAYABLE_ALL',            'Payment ↔ AP invoice'),
    ('IBY', 'IBY_PAY_INSTRUCTIONS_ALL',        'Payment instruction / file'),
    ('IBY', 'IBY_EXT_BANK_ACCOUNTS',           'Counterparty IBAN / sort code'),
    ('IBY', 'IBY_ACCOUNT_OWNERS',              'Bank account owner party'),
    ('CE',  'CE_BANK_ACCOUNTS',                'ResMed UK bank accounts'),
    ('CE',  'CE_BANK_ACCT_USES_ALL',           'Bank account uses by OU'),
    ('CE',  'CE_STATEMENT_HEADERS',            'EBS CE statement headers'),
    ('CE',  'CE_STATEMENT_LINES',              'EBS CE statement lines')
)
SELECT
  e.module,
  e.table_name,
  e.role,
  t.table_schema AS found_schema,
  t.table_name   AS found_name,
  IFF(t.table_name IS NULL, 'MISSING — search INFORMATION_SCHEMA', 'OK') AS status
FROM expected e
LEFT JOIN IDENTIFIER($EBS_DB || '.INFORMATION_SCHEMA.TABLES') t
  ON UPPER(t.table_name) = e.table_name
 AND UPPER(t.table_schema) IN (UPPER($EBS_SCHEMA), 'PUBLIC', 'APPS', 'EBS')
ORDER BY e.module, e.table_name;

-- Fuzzy search if a row above is MISSING (example: AP invoices)
-- SELECT table_catalog, table_schema, table_name
-- FROM IDENTIFIER($EBS_DB || '.INFORMATION_SCHEMA.TABLES')
-- WHERE UPPER(table_name) ILIKE '%INVOICE%'
-- ORDER BY table_schema, table_name;


-- -----------------------------------------------------------------------------
-- 2. Parameters + helper views (org 112, 6-month created-date window)
-- -----------------------------------------------------------------------------
USE DATABASE IDENTIFIER($EXTRACT_DB);
USE SCHEMA IDENTIFIER($EXTRACT_SCHEMA);

CREATE OR REPLACE TABLE cash_extract_params AS
SELECT
  $ORG_ID::NUMBER                         AS org_id,
  $LOOKBACK_MONTHS::NUMBER                AS lookback_months,
  DATEADD('month', -$LOOKBACK_MONTHS, CURRENT_TIMESTAMP()) AS created_since,
  CURRENT_TIMESTAMP()                     AS generated_at,
  'GB'                                    AS uk_country,
  'OU: ResMed UK'                         AS operating_unit_name_hint;

-- Distinctive bank/payment refs: the aggcenter matcher drops generic values.
CREATE OR REPLACE VIEW v_generic_payment_refs AS
SELECT column1 AS ref_code FROM VALUES
  ('ABI'), ('BACS'), ('CHAPS'), ('FASTER'), ('CASH'),
  ('CHECK'), ('CHEQUE'), ('DD'), ('DIRECTDEBIT'),
  ('FPS'), ('TRANSFER'), ('TFR'), ('PAYMENT'), ('RECEIPT');

-- UK operating unit
CREATE OR REPLACE VIEW v_uk_ou AS
SELECT
  hou.organization_id AS org_id,
  hou.name            AS operating_unit_name,
  hou.short_code      AS operating_unit_short_code
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HR_OPERATING_UNITS') hou
CROSS JOIN cash_extract_params p
WHERE hou.organization_id = p.org_id
   OR UPPER(hou.name) ILIKE '%UK%'
   OR UPPER(hou.name) ILIKE '%UNITED KINGDOM%'
   OR UPPER(NVL(hou.short_code, '')) ILIKE '%UK%';

-- Vendor master (R12). If AP_SUPPLIERS is missing, rewrite FROM to PO_VENDORS.
CREATE OR REPLACE VIEW v_vendors AS
SELECT
  s.vendor_id,
  s.vendor_name,
  s.segment1              AS supplier_number,
  s.vendor_type_lookup_code,
  s.num_1099              AS taxpayer_id,
  s.vat_registration_num,
  s.end_date_active
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_SUPPLIERS') s;

CREATE OR REPLACE VIEW v_vendor_sites AS
SELECT
  ss.vendor_site_id,
  ss.vendor_id,
  ss.org_id,
  ss.vendor_site_code,
  ss.vendor_site_code_alt,
  ss.country,
  ss.city,
  ss.province,
  ss.county,
  ss.zip,
  ss.address_line1,
  ss.pay_group_lookup_code,
  ss.payment_method_lookup_code,
  ss.inactive_date
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_SUPPLIER_SITES_ALL') ss
CROSS JOIN cash_extract_params p
WHERE ss.org_id = p.org_id;

-- Customer / bill-to
CREATE OR REPLACE VIEW v_customers AS
SELECT
  cust.cust_account_id,
  cust.account_number,
  cust.party_id,
  hp.party_name,
  hp.party_name          AS counterparty_name,
  hp.known_as,
  hp.organization_name_phonetic,
  cust.status            AS account_status
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HZ_CUST_ACCOUNTS') cust
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HZ_PARTIES') hp
  ON hp.party_id = cust.party_id;

CREATE OR REPLACE VIEW v_customer_bill_to AS
SELECT
  su.site_use_id,
  su.cust_acct_site_id,
  su.org_id,
  su.site_use_code,
  su.location,
  loc.country,
  loc.city,
  loc.postal_code,
  loc.address1,
  cas.cust_account_id
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HZ_CUST_SITE_USES_ALL') su
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HZ_CUST_ACCT_SITES_ALL') cas
  ON cas.cust_acct_site_id = su.cust_acct_site_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HZ_LOCATIONS') loc
  ON loc.location_id = cas.location_id
CROSS JOIN cash_extract_params p
WHERE su.org_id = p.org_id
  AND su.site_use_code IN ('BILL_TO', 'STMT');

-- Counterparty bank accounts (IBAN / sort code / account name as on HSBC)
CREATE OR REPLACE VIEW v_ext_bank_accounts AS
SELECT
  eba.ext_bank_account_id,
  eba.bank_account_num,
  eba.iban,
  eba.bank_account_name,
  eba.currency_code,
  eba.country_code,
  eba.branch_id,
  eba.bank_id,
  eba.mask_bank_account_num,
  ao.account_owner_party_id AS party_id
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.IBY_EXT_BANK_ACCOUNTS') eba
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.IBY_ACCOUNT_OWNERS') ao
  ON ao.ext_bank_account_id = eba.ext_bank_account_id
 AND NVL(ao.end_date, DATEADD('year', 1, CURRENT_DATE())) >= CURRENT_DATE();

-- Own (ResMed UK) bank accounts — join to HSBC IBAN on the statement header
CREATE OR REPLACE VIEW v_own_bank_accounts AS
SELECT
  cba.bank_account_id,
  cba.bank_account_name,
  cba.bank_account_num,
  cba.iban_number           AS iban,
  cba.currency_code,
  cba.bank_name,
  cba.bank_branch_name,
  u.org_id,
  u.ap_use_enable_flag,
  u.ar_use_enable_flag
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.CE_BANK_ACCOUNTS') cba
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.CE_BANK_ACCT_USES_ALL') u
  ON u.bank_account_id = cba.bank_account_id
CROSS JOIN cash_extract_params p
WHERE u.org_id = p.org_id;

-- If IBY_EXT_BANK_ACCOUNTS is MISSING, run this stub instead of v_ext_bank_accounts:
-- CREATE OR REPLACE VIEW v_ext_bank_accounts AS
-- SELECT
--   NULL::NUMBER AS ext_bank_account_id, NULL::VARCHAR AS bank_account_num,
--   NULL::VARCHAR AS iban, NULL::VARCHAR AS bank_account_name,
--   NULL::VARCHAR AS currency_code, NULL::VARCHAR AS country_code,
--   NULL::NUMBER AS branch_id, NULL::NUMBER AS bank_id,
--   NULL::VARCHAR AS mask_bank_account_num, NULL::NUMBER AS party_id
-- WHERE 1 = 0;
--
-- If CE_BANK_ACCOUNTS is MISSING, run this stub instead of v_own_bank_accounts:
-- CREATE OR REPLACE VIEW v_own_bank_accounts AS
-- SELECT
--   NULL::NUMBER AS bank_account_id, NULL::VARCHAR AS bank_account_name,
--   NULL::VARCHAR AS bank_account_num, NULL::VARCHAR AS iban,
--   NULL::VARCHAR AS currency_code, NULL::VARCHAR AS bank_name,
--   NULL::VARCHAR AS bank_branch_name, NULL::NUMBER AS org_id,
--   NULL::VARCHAR AS ap_use_enable_flag, NULL::VARCHAR AS ar_use_enable_flag
-- WHERE 1 = 0;

CREATE OR REPLACE FUNCTION is_distinctive_ref(val VARCHAR)
  RETURNS BOOLEAN
  LANGUAGE SQL
  AS
  $$
    val IS NOT NULL
    AND LENGTH(TRIM(val)) >= 5
    AND UPPER(REGEXP_REPLACE(TRIM(val), '[^A-Z0-9]', '')) NOT IN (
      'ABI','BACS','CHAPS','FASTER','CASH','CHECK','CHEQUE','DD',
      'DIRECTDEBIT','FPS','TRANSFER','TFR','PAYMENT','RECEIPT'
    )
  $$;


-- -----------------------------------------------------------------------------
-- 3. Drop-in extracts — same columns as current INV / SO / PO / REM ingest
-- -----------------------------------------------------------------------------
-- Extra columns after the ingest ones are ignored by fromExtracts.ts and are
-- included so Grokbot / analysts can see payment status, remaining amount,
-- and the distinctive refs the matcher actually needs.

-- 3a. INV header  →  INV_112/ap_invoice_header.csv  (or INV_Header_112.csv)
--     Mapper keys: invoice_id, invoice_number, invoice_amount,
--     discountable_amount, tax_control_amount, invoice_date, terms_date,
--     supplier_name, invoice_currency, payment_currency, taxation_country,
--     business_unit, invoice_type
CREATE OR REPLACE VIEW extract_inv_header AS
SELECT
  TO_VARCHAR(i.invoice_id)                                        AS invoice_id,
  i.invoice_num                                                   AS invoice_number,
  i.invoice_amount                                                AS invoice_amount,
  i.amount_applicable_to_discount                                 AS discountable_amount,
  NVL((
        SELECT SUM(tl.amount)
        FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICE_LINES_ALL') tl
        WHERE tl.invoice_id = i.invoice_id
          AND tl.line_type_lookup_code = 'TAX'
          AND NVL(tl.discarded_flag, 'N') <> 'Y'
      ), 0)                                                       AS tax_control_amount,
  TO_CHAR(i.invoice_date, 'YYYY-MM-DD')                           AS invoice_date,
  TO_CHAR(i.terms_date, 'YYYY-MM-DD')                             AS terms_date,
  v.vendor_name                                                   AS supplier_name,
  i.invoice_currency_code                                         AS invoice_currency,
  i.payment_currency_code                                         AS payment_currency,
  UPPER(NVL(vs.country, p.uk_country))                            AS taxation_country,
  ou.operating_unit_name                                          AS business_unit,
  i.invoice_type_lookup_code                                      AS invoice_type,
  -- extra (ignored by current ingest; useful for matching / short-pay)
  i.org_id,
  i.payment_status_flag,
  i.amount_paid,
  (NVL(i.invoice_amount, 0) - NVL(i.amount_paid, 0))              AS amount_remaining,
  i.payment_method_lookup_code,
  i.pay_group_lookup_code,
  i.source,
  i.description                                                   AS invoice_description,
  v.supplier_number,
  vs.vendor_site_code,
  TO_CHAR(i.creation_date, 'YYYY-MM-DD HH24:MI:SS')               AS creation_date,
  TO_CHAR(i.gl_date, 'YYYY-MM-DD')                                AS gl_date,
  i.doc_sequence_value                                            AS voucher_number
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICES_ALL') i
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = i.org_id
LEFT JOIN v_vendors v
  ON v.vendor_id = i.vendor_id
LEFT JOIN v_vendor_sites vs
  ON vs.vendor_site_id = i.vendor_site_id
WHERE i.org_id = p.org_id
  AND NVL(UPPER(vs.country), p.uk_country) IN ('GB', 'UK', 'GBR')
  AND (
        i.creation_date >= p.created_since
     OR i.invoice_date  >= p.created_since
     OR i.gl_date       >= DATE(p.created_since)
      )
  AND NVL(i.cancelled_date, DATE '9999-12-31') = DATE '9999-12-31';

-- 3b. INV lines  →  INV_112/ap_invoice_line.csv
--     Mapper keys: invoice_id, po_number
CREATE OR REPLACE VIEW extract_inv_line AS
SELECT
  TO_VARCHAR(l.invoice_id)                    AS invoice_id,
  ph.segment1                                 AS po_number,
  l.line_number,
  l.line_type_lookup_code                     AS line_type,
  l.amount                                    AS line_amount,
  l.quantity_invoiced                         AS quantity,
  l.unit_price,
  l.description                               AS line_description,
  l.org_id,
  TO_VARCHAR(l.po_header_id)                  AS po_header_id,
  TO_VARCHAR(l.po_line_id)                    AS po_line_id
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICE_LINES_ALL') l
CROSS JOIN cash_extract_params p
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.PO_HEADERS_ALL') ph
  ON ph.po_header_id = l.po_header_id
WHERE l.org_id = p.org_id
  AND l.creation_date >= p.created_since
  AND NVL(l.discarded_flag, 'N') <> 'Y'
  AND (
        ph.segment1 IS NOT NULL
     OR l.line_type_lookup_code IN ('ITEM', 'TAX', 'FREIGHT', 'MISCELLANEOUS')
      );

-- 3c. PO header  →  PO_112/po_header.csv  (or PO_Header_112.csv)
--     Mapper keys: po_number / po_order / document_number / order_number,
--     interface_header_key / po_header_id, vendor_name / supplier_name,
--     currency_code, amount, ordered_date, need_by_date, status,
--     operating_unit, org_id, country
CREATE OR REPLACE VIEW extract_po_header AS
SELECT
  ph.segment1                                          AS po_number,
  ph.segment1                                          AS po_order,
  ph.segment1                                          AS document_number,
  ph.segment1                                          AS order_number,
  TO_VARCHAR(ph.po_header_id)                          AS po_header_id,
  TO_VARCHAR(ph.po_header_id)                          AS interface_header_key,
  v.vendor_name,
  v.vendor_name                                        AS supplier_name,
  ph.currency_code,
  (
    SELECT SUM(NVL(pl.quantity, 0) * NVL(pl.unit_price, 0))
    FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.PO_LINES_ALL') pl
    WHERE pl.po_header_id = ph.po_header_id
      AND NVL(pl.cancel_flag, 'N') <> 'Y'
  )                                                    AS amount,
  TO_CHAR(ph.creation_date, 'YYYY-MM-DD')              AS creation_date,
  TO_CHAR(NVL(ph.approved_date, ph.creation_date), 'YYYY-MM-DD') AS ordered_date,
  TO_CHAR(ph.creation_date, 'YYYY-MM-DD')              AS po_date,
  ph.authorization_status                              AS status,
  ph.authorization_status,
  ph.closed_code                                       AS document_status,
  ou.operating_unit_name                               AS operating_unit,
  ou.operating_unit_name                               AS operating_unit_name,
  ou.operating_unit_name                               AS business_unit,
  ph.org_id,
  p.uk_country                                         AS country,
  p.uk_country                                         AS bill_to_country,
  p.uk_country                                         AS taxation_country,
  ph.type_lookup_code,
  ph.comments                                          AS po_description,
  v.supplier_number
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.PO_HEADERS_ALL') ph
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = ph.org_id
LEFT JOIN v_vendors v
  ON v.vendor_id = ph.vendor_id
WHERE ph.org_id = p.org_id
  AND ph.creation_date >= p.created_since
  AND NVL(ph.cancel_flag, 'N') <> 'Y';

-- 3d. PO lines  →  PO_112/po_lines.csv  (skip location/distribution files)
CREATE OR REPLACE VIEW extract_po_line AS
SELECT
  ph.segment1                                 AS po_number,
  ph.segment1                                 AS document_number,
  ph.segment1                                 AS order_number,
  ph.segment1                                 AS po_order,
  TO_VARCHAR(pl.po_header_id)                 AS po_header_id,
  TO_VARCHAR(pl.po_header_id)                 AS interface_header_key,
  TO_VARCHAR(pl.po_line_id)                   AS po_line_id,
  pl.line_num                                 AS line_number,
  NVL(pl.quantity, 0) * NVL(pl.unit_price, 0) AS line_amount,
  NVL(pl.quantity, 0) * NVL(pl.unit_price, 0) AS amount,
  NVL(pl.quantity, 0) * NVL(pl.unit_price, 0) AS extended_amount,
  NVL(pl.quantity, 0) * NVL(pl.unit_price, 0) AS ordered_amount,
  pl.quantity,
  pl.unit_price,
  pl.unit_price                               AS price,
  pl.item_description,
  pl.unit_meas_lookup_code                    AS uom,
  pl.org_id
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.PO_LINES_ALL') pl
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.PO_HEADERS_ALL') ph
  ON ph.po_header_id = pl.po_header_id
CROSS JOIN cash_extract_params p
WHERE pl.org_id = p.org_id
  AND pl.creation_date >= p.created_since
  AND NVL(pl.cancel_flag, 'N') <> 'Y';

-- 3e. SO header  →  SO_112/sales_order_header.csv
--     Mapper keys: sourcetransid / source_trans_id, source_trans_num,
--     byng_pty_nme, transal_crncy_code, trans_on, cust_ponum, rqstng_bu_unit
CREATE OR REPLACE VIEW extract_so_header AS
SELECT
  TO_VARCHAR(h.header_id)                         AS sourcetransid,
  TO_VARCHAR(h.header_id)                         AS source_trans_id,
  TO_VARCHAR(h.order_number)                      AS source_trans_num,
  cust.party_name                                 AS byng_pty_nme,
  h.transactional_curr_code                       AS transal_crncy_code,
  TO_CHAR(h.ordered_date, 'YYYY/MM/DD')           AS trans_on,
  h.cust_po_number                                AS cust_ponum,
  ou.operating_unit_name                          AS rqstng_bu_unit,
  h.org_id,
  h.flow_status_code                              AS order_status,
  cust.account_number                             AS customer_account_number,
  TO_CHAR(h.creation_date, 'YYYY-MM-DD HH24:MI:SS') AS creation_date
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.OE_ORDER_HEADERS_ALL') h
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = h.org_id
LEFT JOIN v_customers cust
  ON cust.cust_account_id = h.sold_to_org_id
WHERE h.org_id = p.org_id
  AND h.creation_date >= p.created_since
  AND NVL(h.cancelled_flag, 'N') <> 'Y';

-- 3f. SO charges  →  SO_112/charges_component.csv
--     Mapper keeps only price_element_code = QP_NET_PRICE and sums
--     charge_crncy_extended_amount by source_trans_id.
--     EBS has no QP charge-component extract; synthesise net from order lines.
CREATE OR REPLACE VIEW extract_so_charges AS
SELECT
  TO_VARCHAR(l.header_id)                         AS source_trans_id,
  'QP_NET_PRICE'                                  AS price_element_code,
  SUM(NVL(l.ordered_quantity, 0) * NVL(l.unit_selling_price, 0))
                                                  AS charge_crncy_extended_amount,
  l.org_id
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.OE_ORDER_LINES_ALL') l
CROSS JOIN cash_extract_params p
WHERE l.org_id = p.org_id
  AND l.creation_date >= p.created_since
  AND NVL(l.cancelled_flag, 'N') <> 'Y'
GROUP BY l.header_id, l.org_id;

-- 3g. REM drop-in  →  REM_112/remittance.csv
--     Grain: one row per (receipt/payment × invoice) so the mapper can collect
--     invoiceNumbers[] while keeping payment_total_amount at header level.
--
--     CRITICAL matching fix vs current extract:
--       remittance_number is set to a distinctive ref (customer receipt
--       reference, receipt number, IBY payment reference) instead of "BACS".
--       Extra synthetic rows push customer_receipt_reference / receipt_number
--       / payment end-to-end id into invoice_number so extractMatchTokens
--       can hit them. Same remittance_id → one grouped Remittance.

-- AR receipts applied to invoices (CUSTOMER_TO_OU)
CREATE OR REPLACE VIEW extract_rem_ar_applied AS
SELECT
  'CUSTOMER_TO_OU'                                         AS flow_direction,
  'AR'                                                     AS source_module,
  cr.org_id,
  ou.operating_unit_name,
  TO_VARCHAR(cr.cash_receipt_id)                           AS remittance_id,
  TO_VARCHAR(cr.cash_receipt_id)                           AS oracle_payment_id,
  COALESCE(
    IFF(is_distinctive_ref(cr.customer_receipt_reference), cr.customer_receipt_reference, NULL),
    IFF(is_distinctive_ref(cr.receipt_number), cr.receipt_number, NULL),
    IFF(is_distinctive_ref(TO_VARCHAR(hist.batch_id)), TO_VARCHAR(hist.batch_id), NULL),
    cr.receipt_number
  )                                                        AS remittance_number,
  TO_CHAR(NVL(cr.receipt_date, cr.creation_date), 'YYYY-MM-DD HH24:MI:SS.FF5')
                                                           AS remittance_date,
  NVL(app.status, cr.status)                               AS remittance_status,
  cr.currency_code                                         AS payment_currency_code,
  cr.amount                                                AS payment_total_amount,
  trx.trx_number                                           AS invoice_number,
  cust.party_name                                          AS counterparty_name,
  -- extra
  cr.receipt_number                                        AS ar_receipt_number,
  cr.customer_receipt_reference,
  cr.comments                                              AS receipt_comments,
  rm.name                                                  AS receipt_method,
  TO_CHAR(cr.deposit_date, 'YYYY-MM-DD')                   AS deposit_date,
  TO_VARCHAR(hist.batch_id)                                AS bank_deposit_reference,
  cust.account_number                                      AS customer_account_number,
  eba.iban                                                 AS counterparty_iban,
  eba.bank_account_num                                     AS counterparty_account_num,
  eba.bank_account_name                                    AS counterparty_account_name,
  cr.creation_date
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_CASH_RECEIPTS_ALL') cr
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = cr.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_RECEIPT_METHODS') rm
  ON rm.receipt_method_id = cr.receipt_method_id
LEFT JOIN v_customers cust
  ON cust.cust_account_id = cr.pay_from_customer
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_RECEIVABLE_APPLICATIONS_ALL') app
  ON app.cash_receipt_id = cr.cash_receipt_id
 AND app.display = 'Y'
 AND app.status = 'APP'
 AND NVL(app.application_type, 'CASH') = 'CASH'
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_ALL') trx
  ON trx.customer_trx_id = app.applied_customer_trx_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_CASH_RECEIPT_HISTORY_ALL') hist
  ON hist.cash_receipt_id = cr.cash_receipt_id
 AND hist.first_posted_record_flag = 'Y'
LEFT JOIN v_ext_bank_accounts eba
  ON eba.party_id = cust.party_id
WHERE cr.org_id = p.org_id
  AND cr.type IN ('CASH', 'MISC')
  AND NVL(cr.reversal_date, DATE '9999-12-31') = DATE '9999-12-31'
  AND (
        cr.creation_date >= p.created_since
     OR cr.receipt_date  >= DATE(p.created_since)
     OR cr.deposit_date  >= DATE(p.created_since)
      );

-- Extra AR remittance rows: push distinctive bank-side refs into invoice_number
-- so the current mapper (which only reads invoice_number) still token-matches
-- customer receipt references and receipt numbers.
CREATE OR REPLACE VIEW extract_rem_ar_extra_refs AS
SELECT DISTINCT
  a.flow_direction, a.source_module, a.org_id, a.operating_unit_name,
  a.remittance_id, a.oracle_payment_id, a.remittance_number, a.remittance_date,
  a.remittance_status, a.payment_currency_code, a.payment_total_amount,
  extra.invoice_number, a.counterparty_name, a.ar_receipt_number,
  a.customer_receipt_reference, a.receipt_comments, a.receipt_method,
  a.deposit_date, a.bank_deposit_reference, a.customer_account_number,
  a.counterparty_iban, a.counterparty_account_num, a.counterparty_account_name,
  a.creation_date
FROM extract_rem_ar_applied a
JOIN (
  SELECT remittance_id, ar_receipt_number AS invoice_number FROM extract_rem_ar_applied
  UNION ALL
  SELECT remittance_id, customer_receipt_reference FROM extract_rem_ar_applied
  UNION ALL
  SELECT remittance_id, bank_deposit_reference FROM extract_rem_ar_applied
  UNION ALL
  SELECT remittance_id, customer_account_number FROM extract_rem_ar_applied
) extra
  ON extra.remittance_id = a.remittance_id
WHERE is_distinctive_ref(extra.invoice_number)
  AND extra.invoice_number <> NVL(a.invoice_number, '');

-- Unapplied AR receipts (still a forecast / amount match)
CREATE OR REPLACE VIEW extract_rem_ar_unapplied AS
SELECT
  'CUSTOMER_TO_OU'                                         AS flow_direction,
  'AR'                                                     AS source_module,
  cr.org_id,
  ou.operating_unit_name,
  TO_VARCHAR(cr.cash_receipt_id)                           AS remittance_id,
  TO_VARCHAR(cr.cash_receipt_id)                           AS oracle_payment_id,
  COALESCE(
    IFF(is_distinctive_ref(cr.customer_receipt_reference), cr.customer_receipt_reference, NULL),
    IFF(is_distinctive_ref(cr.receipt_number), cr.receipt_number, NULL),
    cr.receipt_number
  )                                                        AS remittance_number,
  TO_CHAR(NVL(cr.receipt_date, cr.creation_date), 'YYYY-MM-DD HH24:MI:SS.FF5')
                                                           AS remittance_date,
  cr.status                                                AS remittance_status,
  cr.currency_code                                         AS payment_currency_code,
  cr.amount                                                AS payment_total_amount,
  COALESCE(cr.customer_receipt_reference, cr.receipt_number) AS invoice_number,
  NVL(cust.party_name, 'UNIDENTIFIED')                     AS counterparty_name,
  cr.receipt_number                                        AS ar_receipt_number,
  cr.customer_receipt_reference,
  cr.comments                                              AS receipt_comments,
  rm.name                                                  AS receipt_method,
  TO_CHAR(cr.deposit_date, 'YYYY-MM-DD')                   AS deposit_date,
  NULL                                                     AS bank_deposit_reference,
  cust.account_number                                      AS customer_account_number,
  NULL                                                     AS counterparty_iban,
  NULL                                                     AS counterparty_account_num,
  NULL                                                     AS counterparty_account_name,
  cr.creation_date
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_CASH_RECEIPTS_ALL') cr
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = cr.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_RECEIPT_METHODS') rm
  ON rm.receipt_method_id = cr.receipt_method_id
LEFT JOIN v_customers cust
  ON cust.cust_account_id = cr.pay_from_customer
WHERE cr.org_id = p.org_id
  AND cr.type IN ('CASH', 'MISC')
  AND NVL(cr.reversal_date, DATE '9999-12-31') = DATE '9999-12-31'
  AND (
        cr.creation_date >= p.created_since
     OR cr.receipt_date  >= DATE(p.created_since)
      )
  AND NOT EXISTS (
        SELECT 1
        FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_RECEIVABLE_APPLICATIONS_ALL') app
        WHERE app.cash_receipt_id = cr.cash_receipt_id
          AND app.display = 'Y'
          AND app.status = 'APP'
      );

-- AP payments (OU_TO_SUPPLIER) via IBY + AP_CHECKS
CREATE OR REPLACE VIEW extract_rem_ap AS
SELECT
  'OU_TO_SUPPLIER'                                         AS flow_direction,
  'AP'                                                     AS source_module,
  pay.org_id,
  ou.operating_unit_name,
  TO_VARCHAR(NVL(pay.payment_id, chk.check_id))            AS remittance_id,
  TO_VARCHAR(NVL(pay.payment_id, chk.check_id))            AS oracle_payment_id,
  COALESCE(
    IFF(is_distinctive_ref(pay.payment_reference_number), pay.payment_reference_number, NULL),
    IFF(is_distinctive_ref(pay.paper_document_number), pay.paper_document_number, NULL),
    IFF(is_distinctive_ref(TO_VARCHAR(chk.check_number)), TO_VARCHAR(chk.check_number), NULL),
    IFF(is_distinctive_ref(pay.unique_remittance_identifier), pay.unique_remittance_identifier, NULL),
    TO_VARCHAR(NVL(pay.payment_id, chk.check_id))
  )                                                        AS remittance_number,
  TO_CHAR(NVL(pay.payment_date, chk.check_date), 'YYYY-MM-DD HH24:MI:SS.FF5')
                                                           AS remittance_date,
  NVL(pay.payment_status, chk.status_lookup_code)          AS remittance_status,
  NVL(pay.payment_currency_code, chk.currency_code)        AS payment_currency_code,
  NVL(pay.payment_amount, chk.amount)                      AS payment_total_amount,
  inv.invoice_num                                          AS invoice_number,
  COALESCE(hp.party_name, v.vendor_name, chk.vendor_name)  AS counterparty_name,
  TO_VARCHAR(chk.check_number)                             AS ar_receipt_number,
  pay.payment_reference_number                             AS customer_receipt_reference,
  pay.unique_remittance_identifier                         AS receipt_comments,
  NVL(pay.payment_method_code, chk.payment_method_lookup_code) AS receipt_method,
  TO_CHAR(NVL(pay.payment_date, chk.check_date), 'YYYY-MM-DD') AS deposit_date,
  TO_VARCHAR(pi.payment_instruction_id)                    AS bank_deposit_reference,
  v.supplier_number                                        AS customer_account_number,
  eba.iban                                                 AS counterparty_iban,
  eba.bank_account_num                                     AS counterparty_account_num,
  eba.bank_account_name                                    AS counterparty_account_name,
  NVL(pay.creation_date, chk.creation_date)                AS creation_date
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.IBY_PAYMENTS_ALL') pay
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = pay.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_CHECKS_ALL') chk
  ON chk.payment_id = pay.payment_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.IBY_PAY_INSTRUCTIONS_ALL') pi
  ON pi.payment_instruction_id = pay.payment_instruction_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.IBY_DOCS_PAYABLE_ALL') doc
  ON doc.payment_id = pay.payment_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICES_ALL') inv
  ON TO_VARCHAR(inv.invoice_id) = TO_VARCHAR(doc.calling_app_doc_unique_ref1)
 AND inv.org_id = pay.org_id
LEFT JOIN v_vendors v
  ON v.vendor_id = NVL(inv.vendor_id, chk.vendor_id)
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HZ_PARTIES') hp
  ON hp.party_id = pay.payee_party_id
LEFT JOIN v_ext_bank_accounts eba
  ON eba.ext_bank_account_id = pay.ext_bank_account_id
WHERE pay.org_id = p.org_id
  AND NVL(pay.payment_status, ' ') NOT IN ('VOID', 'REMOVED', 'OVERFLOW')
  AND (
        NVL(pay.creation_date, chk.creation_date) >= p.created_since
     OR NVL(pay.payment_date, chk.check_date)     >= DATE(p.created_since)
      );

-- Fallback AP payments when IBY_PAYMENTS_ALL is empty: AP_CHECKS_ALL
CREATE OR REPLACE VIEW extract_rem_ap_checks AS
SELECT
  'OU_TO_SUPPLIER'                                         AS flow_direction,
  'AP'                                                     AS source_module,
  chk.org_id,
  ou.operating_unit_name,
  TO_VARCHAR(chk.check_id)                                 AS remittance_id,
  TO_VARCHAR(chk.check_id)                                 AS oracle_payment_id,
  COALESCE(
    IFF(is_distinctive_ref(TO_VARCHAR(chk.check_number)), TO_VARCHAR(chk.check_number), NULL),
    TO_VARCHAR(chk.check_id)
  )                                                        AS remittance_number,
  TO_CHAR(chk.check_date, 'YYYY-MM-DD HH24:MI:SS.FF5')     AS remittance_date,
  chk.status_lookup_code                                   AS remittance_status,
  chk.currency_code                                        AS payment_currency_code,
  chk.amount                                               AS payment_total_amount,
  inv.invoice_num                                          AS invoice_number,
  COALESCE(chk.vendor_name, v.vendor_name)                 AS counterparty_name,
  TO_VARCHAR(chk.check_number)                             AS ar_receipt_number,
  NULL                                                     AS customer_receipt_reference,
  chk.bank_account_name                                    AS receipt_comments,
  chk.payment_method_lookup_code                           AS receipt_method,
  TO_CHAR(chk.check_date, 'YYYY-MM-DD')                    AS deposit_date,
  NULL                                                     AS bank_deposit_reference,
  v.supplier_number                                        AS customer_account_number,
  NULL                                                     AS counterparty_iban,
  chk.bank_account_num                                     AS counterparty_account_num,
  chk.bank_account_name                                    AS counterparty_account_name,
  chk.creation_date
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_CHECKS_ALL') chk
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = chk.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICE_PAYMENTS_ALL') ip
  ON ip.check_id = chk.check_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICES_ALL') inv
  ON inv.invoice_id = ip.invoice_id
LEFT JOIN v_vendors v
  ON v.vendor_id = chk.vendor_id
WHERE chk.org_id = p.org_id
  AND NVL(chk.status_lookup_code, ' ') NOT IN ('VOIDED', 'STOPPED')
  AND (
        chk.creation_date >= p.created_since
     OR chk.check_date    >= DATE(p.created_since)
      );

-- Combined remittance extract (drop-in column order first)
CREATE OR REPLACE VIEW extract_remittance AS
SELECT
  flow_direction,
  source_module,
  org_id,
  operating_unit_name,
  remittance_id,
  oracle_payment_id,
  remittance_number,
  remittance_date,
  remittance_status,
  payment_currency_code,
  payment_total_amount,
  invoice_number,
  counterparty_name,
  ar_receipt_number,
  customer_receipt_reference,
  receipt_comments,
  receipt_method,
  deposit_date,
  bank_deposit_reference,
  customer_account_number,
  counterparty_iban,
  counterparty_account_num,
  counterparty_account_name,
  creation_date
FROM extract_rem_ar_applied
UNION ALL
SELECT * FROM extract_rem_ar_extra_refs
UNION ALL
SELECT * FROM extract_rem_ar_unapplied
UNION ALL
SELECT * FROM extract_rem_ap
UNION ALL
SELECT * FROM extract_rem_ap_checks src
WHERE NOT EXISTS (
  SELECT 1 FROM extract_rem_ap iby
  WHERE iby.remittance_id = src.remittance_id
);


-- -----------------------------------------------------------------------------
-- 4. Additional extracts — matching lift beyond INV / SO / PO / REM
-- -----------------------------------------------------------------------------
-- These are not ingested by aggcenter today. Export them alongside the drop-in
-- files. They close the gaps the matcher and remediations already describe.

-- 4a. AR invoices (biggest O2C gap: bank text quotes TRX_NUMBER, not OE id)
--     Optional drop-in trick: UNION this into sales_order_header as
--     source_trans_num = trx_number so so_po_id matching works without a
--     code change (see extract_so_header_with_ar_trx).
CREATE OR REPLACE VIEW extract_ar_invoice_header AS
SELECT
  TO_VARCHAR(t.customer_trx_id)                        AS customer_trx_id,
  t.trx_number                                         AS invoice_number,
  t.trx_date,
  t.invoice_currency_code,
  t.complete_flag,
  tt.type                                              AS trx_class,          -- INV / CM / DM
  tt.name                                              AS trx_type,
  cust.party_name                                      AS customer_name,
  cust.account_number                                  AS customer_account_number,
  t.purchase_order                                     AS customer_po,
  t.ct_reference                                       AS customer_reference,
  t.interface_header_attribute1                        AS sales_order_number,
  ps.amount_due_original                               AS invoice_amount,
  ps.amount_due_remaining,
  ps.amount_applied,
  TO_CHAR(ps.due_date, 'YYYY-MM-DD')                   AS due_date,
  ps.status                                            AS schedule_status,
  ou.operating_unit_name                               AS business_unit,
  t.org_id,
  TO_CHAR(t.creation_date, 'YYYY-MM-DD HH24:MI:SS')    AS creation_date,
  t.comments,
  t.reason_code
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_ALL') t
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = t.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUST_TRX_TYPES_ALL') tt
  ON tt.cust_trx_type_id = t.cust_trx_type_id
 AND tt.org_id = t.org_id
LEFT JOIN v_customers cust
  ON cust.cust_account_id = t.bill_to_customer_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_PAYMENT_SCHEDULES_ALL') ps
  ON ps.customer_trx_id = t.customer_trx_id
 AND ps.org_id = t.org_id
WHERE t.org_id = p.org_id
  AND (
        t.creation_date >= p.created_since
     OR t.trx_date      >= DATE(p.created_since)
     OR (ps.amount_due_remaining <> 0 AND ps.due_date >= DATE(p.created_since))
      );

CREATE OR REPLACE VIEW extract_ar_invoice_line AS
SELECT
  TO_VARCHAR(l.customer_trx_id)                        AS customer_trx_id,
  t.trx_number                                         AS invoice_number,
  l.line_number,
  l.sales_order                                        AS sales_order_number,
  l.interface_line_attribute1                          AS interface_order_number,
  l.quantity_invoiced,
  l.unit_selling_price,
  l.extended_amount,
  l.description,
  l.line_type,
  l.org_id
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_LINES_ALL') l
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_ALL') t
  ON t.customer_trx_id = l.customer_trx_id
CROSS JOIN cash_extract_params p
WHERE l.org_id = p.org_id
  AND l.creation_date >= p.created_since
  AND l.line_type IN ('LINE', 'TAX', 'FREIGHT');

-- Optional SO ingest union: OE orders + AR trx numbers as extra "orders"
CREATE OR REPLACE VIEW extract_so_header_with_ar_trx AS
SELECT
  sourcetransid,
  source_trans_id,
  source_trans_num,
  byng_pty_nme,
  transal_crncy_code,
  trans_on,
  cust_ponum,
  rqstng_bu_unit,
  org_id,
  order_status,
  customer_account_number,
  creation_date,
  'OE' AS source_kind
FROM extract_so_header
UNION ALL
SELECT
  TO_VARCHAR(customer_trx_id)                          AS sourcetransid,
  TO_VARCHAR(customer_trx_id)                          AS source_trans_id,
  invoice_number                                       AS source_trans_num,
  customer_name                                        AS byng_pty_nme,
  invoice_currency_code                                AS transal_crncy_code,
  TO_CHAR(trx_date, 'YYYY/MM/DD')                      AS trans_on,
  customer_po                                          AS cust_ponum,
  business_unit                                        AS rqstng_bu_unit,
  org_id,
  trx_class                                            AS order_status,
  customer_account_number,
  creation_date,
  'AR_TRX' AS source_kind
FROM extract_ar_invoice_header
WHERE trx_class IN ('INV', 'DM', 'CM')
  AND invoice_number IS NOT NULL;

CREATE OR REPLACE VIEW extract_so_charges_with_ar_trx AS
SELECT source_trans_id, price_element_code, charge_crncy_extended_amount, org_id
FROM extract_so_charges
UNION ALL
SELECT
  TO_VARCHAR(customer_trx_id)                          AS source_trans_id,
  'QP_NET_PRICE'                                       AS price_element_code,
  invoice_amount                                       AS charge_crncy_extended_amount,
  org_id
FROM extract_ar_invoice_header
WHERE trx_class IN ('INV', 'DM', 'CM');

-- 4b. AR receipt applications at application grain (short-pay / split / CM)
CREATE OR REPLACE VIEW extract_ar_receipt_application AS
SELECT
  TO_VARCHAR(app.receivable_application_id)            AS application_id,
  TO_VARCHAR(cr.cash_receipt_id)                       AS cash_receipt_id,
  cr.receipt_number,
  cr.customer_receipt_reference,
  cr.amount                                            AS receipt_amount,
  app.amount_applied,
  app.status                                           AS application_status,
  TO_CHAR(app.apply_date, 'YYYY-MM-DD')                AS apply_date,
  trx.trx_number                                       AS invoice_number,
  tt.type                                              AS applied_trx_class,
  ps.amount_due_original                               AS invoice_original,
  ps.amount_due_remaining                              AS invoice_remaining,
  cust.party_name                                      AS customer_name,
  cr.currency_code,
  cr.org_id,
  ou.operating_unit_name
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_RECEIVABLE_APPLICATIONS_ALL') app
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_CASH_RECEIPTS_ALL') cr
  ON cr.cash_receipt_id = app.cash_receipt_id
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = cr.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_ALL') trx
  ON trx.customer_trx_id = app.applied_customer_trx_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUST_TRX_TYPES_ALL') tt
  ON tt.cust_trx_type_id = trx.cust_trx_type_id
 AND tt.org_id = trx.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_PAYMENT_SCHEDULES_ALL') ps
  ON ps.customer_trx_id = trx.customer_trx_id
LEFT JOIN v_customers cust
  ON cust.cust_account_id = cr.pay_from_customer
WHERE cr.org_id = p.org_id
  AND app.display = 'Y'
  AND (
        app.creation_date >= p.created_since
     OR cr.receipt_date   >= DATE(p.created_since)
      );

-- 4c. AR receipt batches / deposits — one HSBC credit often equals a batch
CREATE OR REPLACE VIEW extract_ar_deposit_batch AS
SELECT
  TO_VARCHAR(NVL(b.batch_id, hist.batch_id))           AS remittance_id,
  'CUSTOMER_TO_OU'                                     AS flow_direction,
  'AR'                                                 AS source_module,
  cr.org_id,
  ou.operating_unit_name,
  COALESCE(
    IFF(is_distinctive_ref(b.name), b.name, NULL),
    IFF(is_distinctive_ref(TO_VARCHAR(NVL(b.batch_id, hist.batch_id))),
        TO_VARCHAR(NVL(b.batch_id, hist.batch_id)), NULL),
    TO_VARCHAR(NVL(b.batch_id, hist.batch_id))
  )                                                    AS remittance_number,
  TO_CHAR(NVL(b.batch_date, hist.trx_date), 'YYYY-MM-DD HH24:MI:SS.FF5')
                                                       AS remittance_date,
  NVL(b.status, hist.status)                           AS remittance_status,
  NVL(b.currency_code, cr.currency_code)               AS payment_currency_code,
  NVL(b.control_amount, SUM(cr.amount) OVER (PARTITION BY NVL(b.batch_id, hist.batch_id)))
                                                       AS payment_total_amount,
  trx.trx_number                                       AS invoice_number,
  NVL(b.comments, 'RECEIPT_BATCH')                     AS counterparty_name,
  b.name                                               AS batch_name,
  b.batch_source_id,
  COUNT(DISTINCT cr.cash_receipt_id) OVER (PARTITION BY NVL(b.batch_id, hist.batch_id))
                                                       AS receipt_count
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_CASH_RECEIPTS_ALL') cr
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = cr.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_CASH_RECEIPT_HISTORY_ALL') hist
  ON hist.cash_receipt_id = cr.cash_receipt_id
 AND hist.first_posted_record_flag = 'Y'
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_BATCHES_ALL') b
  ON b.batch_id = hist.batch_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_RECEIVABLE_APPLICATIONS_ALL') app
  ON app.cash_receipt_id = cr.cash_receipt_id
 AND app.display = 'Y'
 AND app.status = 'APP'
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_ALL') trx
  ON trx.customer_trx_id = app.applied_customer_trx_id
WHERE cr.org_id = p.org_id
  AND (
        cr.creation_date >= p.created_since
     OR cr.receipt_date  >= DATE(p.created_since)
     OR b.batch_date     >= DATE(p.created_since)
      );

-- 4d. AP payment ↔ invoice (P2P short-pay / multi-invoice payment)
CREATE OR REPLACE VIEW extract_ap_payment_invoice AS
SELECT
  TO_VARCHAR(NVL(pay.payment_id, chk.check_id))        AS payment_id,
  TO_VARCHAR(chk.check_number)                         AS check_number,
  pay.payment_reference_number,
  pay.unique_remittance_identifier,
  pay.paper_document_number,
  NVL(pay.payment_date, chk.check_date)                AS payment_date,
  NVL(pay.payment_amount, chk.amount)                  AS payment_amount,
  NVL(pay.payment_currency_code, chk.currency_code)    AS payment_currency,
  NVL(pay.payment_method_code, chk.payment_method_lookup_code) AS payment_method,
  inv.invoice_id,
  inv.invoice_num                                      AS invoice_number,
  inv.invoice_amount,
  ip.amount                                            AS amount_paid_on_invoice,
  (NVL(inv.invoice_amount, 0) - NVL(inv.amount_paid, 0)) AS invoice_remaining,
  COALESCE(hp.party_name, v.vendor_name, chk.vendor_name) AS supplier_name,
  v.supplier_number,
  eba.iban                                             AS payee_iban,
  eba.bank_account_name                                AS payee_account_name,
  eba.bank_account_num                                 AS payee_account_num,
  own.iban                                             AS payer_iban,
  own.bank_account_name                                AS payer_account_name,
  chk.org_id,
  ou.operating_unit_name
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_CHECKS_ALL') chk
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = chk.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.IBY_PAYMENTS_ALL') pay
  ON pay.payment_id = chk.payment_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICE_PAYMENTS_ALL') ip
  ON ip.check_id = chk.check_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICES_ALL') inv
  ON inv.invoice_id = ip.invoice_id
LEFT JOIN v_vendors v
  ON v.vendor_id = NVL(inv.vendor_id, chk.vendor_id)
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HZ_PARTIES') hp
  ON hp.party_id = pay.payee_party_id
LEFT JOIN v_ext_bank_accounts eba
  ON eba.ext_bank_account_id = pay.ext_bank_account_id
LEFT JOIN v_own_bank_accounts own
  ON own.bank_account_id = chk.bank_account_id
WHERE chk.org_id = p.org_id
  AND NVL(chk.status_lookup_code, ' ') NOT IN ('VOIDED', 'STOPPED')
  AND (
        chk.creation_date >= p.created_since
     OR chk.check_date    >= DATE(p.created_since)
      );

-- 4e. Open AR / AP remaining — explains partial matches (short-pay / CM)
CREATE OR REPLACE VIEW extract_open_ar AS
SELECT
  'AR'                                                 AS module,
  trx.trx_number                                       AS document_number,
  tt.type                                              AS document_class,
  cust.party_name                                      AS counterparty_name,
  ps.invoice_currency_code                             AS currency_code,
  ps.amount_due_original,
  ps.amount_due_remaining,
  ps.amount_applied,
  TO_CHAR(ps.due_date, 'YYYY-MM-DD')                   AS due_date,
  ps.status,
  trx.org_id,
  ou.operating_unit_name
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_PAYMENT_SCHEDULES_ALL') ps
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_ALL') trx
  ON trx.customer_trx_id = ps.customer_trx_id
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = trx.org_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUST_TRX_TYPES_ALL') tt
  ON tt.cust_trx_type_id = trx.cust_trx_type_id
 AND tt.org_id = trx.org_id
LEFT JOIN v_customers cust
  ON cust.cust_account_id = trx.bill_to_customer_id
WHERE trx.org_id = p.org_id
  AND ps.amount_due_remaining <> 0
  AND ps.status = 'OP'
  AND (
        ps.due_date       >= DATE(p.created_since)
     OR trx.creation_date >= p.created_since
      );

CREATE OR REPLACE VIEW extract_open_ap AS
SELECT
  'AP'                                                 AS module,
  inv.invoice_num                                      AS document_number,
  inv.invoice_type_lookup_code                         AS document_class,
  v.vendor_name                                        AS counterparty_name,
  inv.invoice_currency_code                            AS currency_code,
  ps.gross_amount                                      AS amount_due_original,
  ps.amount_remaining                                  AS amount_due_remaining,
  (NVL(ps.gross_amount, 0) - NVL(ps.amount_remaining, 0)) AS amount_applied,
  TO_CHAR(ps.due_date, 'YYYY-MM-DD')                   AS due_date,
  inv.payment_status_flag                              AS status,
  inv.org_id,
  ou.operating_unit_name
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_PAYMENT_SCHEDULES_ALL') ps
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICES_ALL') inv
  ON inv.invoice_id = ps.invoice_id
CROSS JOIN cash_extract_params p
JOIN v_uk_ou ou
  ON ou.org_id = inv.org_id
LEFT JOIN v_vendors v
  ON v.vendor_id = inv.vendor_id
WHERE inv.org_id = p.org_id
  AND NVL(ps.amount_remaining, 0) <> 0
  AND (
        ps.due_date       >= DATE(p.created_since)
     OR inv.creation_date >= p.created_since
      );

-- 4f. Credit memos (AR + AP) — amount-diff remediations
CREATE OR REPLACE VIEW extract_credit_memos AS
SELECT
  'AR'                                                 AS module,
  trx.trx_number                                       AS credit_memo_number,
  trx.trx_date                                         AS credit_date,
  trx.invoice_currency_code                            AS currency_code,
  ps.amount_due_original                               AS amount,  -- negative for CM
  cust.party_name                                      AS counterparty_name,
  trx.ct_reference                                     AS related_invoice_ref,
  trx.org_id,
  'CUSTOMER_CREDIT_MEMO'                               AS reason_bucket
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_ALL') trx
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUST_TRX_TYPES_ALL') tt
  ON tt.cust_trx_type_id = trx.cust_trx_type_id
 AND tt.org_id = trx.org_id
CROSS JOIN cash_extract_params p
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AR_PAYMENT_SCHEDULES_ALL') ps
  ON ps.customer_trx_id = trx.customer_trx_id
LEFT JOIN v_customers cust
  ON cust.cust_account_id = trx.bill_to_customer_id
WHERE trx.org_id = p.org_id
  AND tt.type = 'CM'
  AND trx.creation_date >= p.created_since
UNION ALL
SELECT
  'AP'                                                 AS module,
  inv.invoice_num                                      AS credit_memo_number,
  inv.invoice_date                                     AS credit_date,
  inv.invoice_currency_code                            AS currency_code,
  inv.invoice_amount                                   AS amount,
  v.vendor_name                                        AS counterparty_name,
  inv.description                                      AS related_invoice_ref,
  inv.org_id,
  'SUPPLIER_CREDIT_MEMO'                               AS reason_bucket
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICES_ALL') inv
CROSS JOIN cash_extract_params p
LEFT JOIN v_vendors v
  ON v.vendor_id = inv.vendor_id
WHERE inv.org_id = p.org_id
  AND inv.invoice_type_lookup_code IN ('CREDIT', 'DEBIT')
  AND inv.creation_date >= p.created_since;

-- 4g. Party names + bank aliases — remittance_amount_name isolation
CREATE OR REPLACE VIEW extract_party_aliases AS
SELECT
  'CUSTOMER'                                           AS party_kind,
  cust.cust_account_id                                 AS party_key,
  cust.account_number                                  AS account_number,
  cust.party_name                                      AS legal_name,
  cust.known_as                                        AS alias_name,
  eba.bank_account_name,
  eba.iban,
  eba.bank_account_num,
  loc.country
FROM v_customers cust
LEFT JOIN v_customer_bill_to loc
  ON loc.cust_account_id = cust.cust_account_id
LEFT JOIN v_ext_bank_accounts eba
  ON eba.party_id = cust.party_id
UNION ALL
SELECT
  'SUPPLIER'                                           AS party_kind,
  v.vendor_id                                          AS party_key,
  v.supplier_number                                    AS account_number,
  v.vendor_name                                        AS legal_name,
  vs.vendor_site_code                                  AS alias_name,
  eba.bank_account_name,
  eba.iban,
  eba.bank_account_num,
  vs.country
FROM v_vendors v
LEFT JOIN v_vendor_sites vs
  ON vs.vendor_id = v.vendor_id
LEFT JOIN v_ext_bank_accounts eba
  ON eba.party_id = v.vendor_id;

-- 4h. Non-trade classification — unmatched payroll / HMRC / intercompany / FX
--     Use this to tag bank lines that should not hunt for SO/PO/REM.
CREATE OR REPLACE VIEW extract_non_trade_payments AS
SELECT
  TO_VARCHAR(NVL(pay.payment_id, chk.check_id))        AS payment_id,
  NVL(pay.payment_date, chk.check_date)                AS payment_date,
  NVL(pay.payment_amount, chk.amount)                  AS amount,
  NVL(pay.payment_currency_code, chk.currency_code)    AS currency_code,
  COALESCE(hp.party_name, v.vendor_name, chk.vendor_name) AS counterparty_name,
  inv.invoice_num                                      AS invoice_number,
  inv.invoice_type_lookup_code,
  inv.source                                           AS invoice_source,
  inv.pay_group_lookup_code,
  CASE
    WHEN UPPER(NVL(v.vendor_name, '')) ILIKE ANY ('%HMRC%', '%INLAND REVENUE%', '%CUSTOMS%')
      OR UPPER(NVL(inv.pay_group_lookup_code, '')) ILIKE '%TAX%'
      THEN 'TAX_HMRC'
    WHEN UPPER(NVL(v.vendor_name, '')) ILIKE ANY ('%NEST%', '%PENSION%', '%AVIVA%', '%SCOTTISH WIDOWS%')
      THEN 'PENSION'
    WHEN UPPER(NVL(inv.source, '')) ILIKE ANY ('%PAYROLL%', '%SALARY%')
      OR UPPER(NVL(inv.pay_group_lookup_code, '')) ILIKE '%PAYROLL%'
      OR UPPER(NVL(v.vendor_type_lookup_code, '')) ILIKE '%EMPLOYEE%'
      THEN 'PAYROLL'
    WHEN UPPER(NVL(v.vendor_name, '')) ILIKE 'RESMED%'
      THEN 'INTERCOMPANY'
    WHEN NVL(pay.payment_currency_code, chk.currency_code) <> NVL(inv.invoice_currency_code, NVL(pay.payment_currency_code, chk.currency_code))
      THEN 'FX'
    WHEN UPPER(NVL(inv.invoice_type_lookup_code, '')) = 'EXPENSE REPORT'
      THEN 'EXPENSE'
    ELSE 'TRADE'
  END                                                  AS cash_class,
  chk.org_id
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_CHECKS_ALL') chk
CROSS JOIN cash_extract_params p
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.IBY_PAYMENTS_ALL') pay
  ON pay.payment_id = chk.payment_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICE_PAYMENTS_ALL') ip
  ON ip.check_id = chk.check_id
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.AP_INVOICES_ALL') inv
  ON inv.invoice_id = ip.invoice_id
LEFT JOIN v_vendors v
  ON v.vendor_id = NVL(inv.vendor_id, chk.vendor_id)
LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.HZ_PARTIES') hp
  ON hp.party_id = pay.payee_party_id
WHERE chk.org_id = p.org_id
  AND (
        chk.creation_date >= p.created_since
     OR chk.check_date    >= DATE(p.created_since)
      );

-- 4i. EBS Cash Management statement lines (OPTIONAL) — skip if CE_* is MISSING
--     Dual baseline / exception report vs HSBC PDF. Not a replacement for
--     BANK_112 — aggcenter already treats the bank file as money proof.
--     Uncomment after section 1 shows CE_STATEMENT_LINES = OK.
--
-- CREATE OR REPLACE VIEW extract_ce_statement_lines AS
-- SELECT
--   sh.statement_number,
--   TO_CHAR(sh.statement_date, 'YYYY-MM-DD')             AS statement_date,
--   cba.bank_account_name,
--   cba.bank_account_num,
--   cba.iban_number                                      AS iban,
--   sl.line_number,
--   TO_CHAR(sl.trx_date, 'YYYY-MM-DD')                   AS trx_date,
--   sl.amount,
--   sl.currency_code,
--   sl.trx_type,
--   sl.status                                            AS ce_status,
--   sl.bank_trx_number,
--   sl.customer_text,
--   sl.bank_account_text,
--   sl.invoice_text,
--   sl.original_amount,
--   sl.charges_amount,
--   sh.org_id
-- FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.CE_STATEMENT_HEADERS') sh
-- JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.CE_STATEMENT_LINES') sl
--   ON sl.statement_header_id = sh.statement_header_id
-- LEFT JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.CE_BANK_ACCOUNTS') cba
--   ON cba.bank_account_id = sh.bank_account_id
-- CROSS JOIN cash_extract_params p
-- WHERE NVL(sh.org_id, p.org_id) = p.org_id
--   AND (
--         sh.creation_date  >= p.created_since
--      OR sh.statement_date >= DATE(p.created_since)
--       );

-- 4j. SO ↔ AR invoice bridge (bank quotes invoice; SO extract has order id)
CREATE OR REPLACE VIEW extract_so_ar_bridge AS
SELECT DISTINCT
  TO_VARCHAR(h.header_id)                              AS sales_order_id,
  TO_VARCHAR(h.order_number)                           AS sales_order_number,
  h.cust_po_number                                     AS customer_po,
  t.trx_number                                         AS ar_invoice_number,
  TO_VARCHAR(t.customer_trx_id)                        AS customer_trx_id,
  cust.party_name                                      AS customer_name,
  h.transactional_curr_code                            AS order_currency,
  t.invoice_currency_code                              AS invoice_currency,
  h.org_id
FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.OE_ORDER_HEADERS_ALL') h
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_LINES_ALL') l
  ON (
       l.sales_order = TO_VARCHAR(h.order_number)
    OR l.interface_line_attribute1 = TO_VARCHAR(h.order_number)
    OR TRY_TO_NUMBER(l.interface_line_attribute6) = h.header_id
     )
JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.RA_CUSTOMER_TRX_ALL') t
  ON t.customer_trx_id = l.customer_trx_id
CROSS JOIN cash_extract_params p
LEFT JOIN v_customers cust
  ON cust.cust_account_id = h.sold_to_org_id
WHERE h.org_id = p.org_id
  AND t.org_id = p.org_id
  AND (
        h.creation_date >= p.created_since
     OR t.creation_date >= p.created_since
      );

-- 4k. Inventory / shipping (OPTIONAL) — skip if WSH_* tables are not in the
--     replica. Bank narratives sometimes quote delivery numbers.
--     Uncomment after section 1 shows WSH_NEW_DELIVERIES = OK.
--
-- CREATE OR REPLACE VIEW extract_delivery_numbers AS
-- SELECT
--   wnd.delivery_id,
--   wnd.name                                             AS delivery_number,
--   wnd.confirm_date,
--   ool.header_id                                        AS sales_order_id,
--   ooh.order_number                                     AS sales_order_number,
--   wnd.organization_id,
--   wnd.status_code
-- FROM IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.WSH_NEW_DELIVERIES') wnd
-- JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.WSH_DELIVERY_ASSIGNMENTS') wda
--   ON wda.delivery_id = wnd.delivery_id
-- JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.WSH_DELIVERY_DETAILS') wdd
--   ON wdd.delivery_detail_id = wda.delivery_detail_id
-- JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.OE_ORDER_LINES_ALL') ool
--   ON ool.line_id = wdd.source_line_id
-- JOIN IDENTIFIER($EBS_DB || '.' || $EBS_SCHEMA || '.OE_ORDER_HEADERS_ALL') ooh
--   ON ooh.header_id = ool.header_id
-- CROSS JOIN cash_extract_params p
-- WHERE ooh.org_id = p.org_id
--   AND wnd.creation_date >= p.created_since;

-- -----------------------------------------------------------------------------
-- 4l. Catalog + row counts — sanity check before export
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW extract_catalog AS
SELECT * FROM VALUES
  ('extract_inv_header',            'drop-in',     'INV_112/ap_invoice_header.csv',     'AP invoices; invoice_number + amount for P2P token match'),
  ('extract_inv_line',              'drop-in',     'INV_112/ap_invoice_line.csv',       'AP lines; po_number onto AP rows'),
  ('extract_po_header',             'drop-in',     'PO_112/po_header.csv',              'PO headers; PO-n token + unique amount'),
  ('extract_po_line',               'drop-in',     'PO_112/po_lines.csv',               'PO line amounts when header total is empty'),
  ('extract_so_header',             'drop-in',     'SO_112/sales_order_header.csv',     'OE orders; SO id token (weak on HSBC)'),
  ('extract_so_charges',            'drop-in',     'SO_112/charges_component.csv',      'Synthesised QP_NET_PRICE from OE lines'),
  ('extract_so_header_with_ar_trx', 'drop-in*',    'SO_112/sales_order_header.csv',     'RECOMMENDED: OE + AR trx numbers as SO ids'),
  ('extract_so_charges_with_ar_trx','drop-in*',    'SO_112/charges_component.csv',      'RECOMMENDED: OE net + AR invoice amounts'),
  ('extract_remittance',            'drop-in',     'REM_112/remittance.csv',            'AR receipts + AP payments; distinctive refs not BACS'),
  ('extract_ar_invoice_header',     'additional',  'REM_112/ar_invoice_header.csv',     'AR invoices the bank actually quotes'),
  ('extract_ar_invoice_line',       'additional',  'REM_112/ar_invoice_line.csv',       'AR lines + sales_order bridge'),
  ('extract_ar_receipt_application','additional',  'REM_112/ar_receipt_application.csv','Short-pay / split / credit-memo applications'),
  ('extract_ar_deposit_batch',      'additional',  'REM_112/ar_deposit_batch.csv',      'One HSBC credit = receipt batch total'),
  ('extract_ap_payment_invoice',    'additional',  'REM_112/ap_payment_invoice.csv',    'IBY/AP payment document + invoices paid'),
  ('extract_open_ar',               'additional',  'REM_112/open_ar.csv',               'Open AR remaining for partial matches'),
  ('extract_open_ap',               'additional',  'REM_112/open_ap.csv',               'Open AP remaining for partial matches'),
  ('extract_credit_memos',          'additional',  'REM_112/credit_memos.csv',          'AR/AP credit memos for amount diffs'),
  ('extract_party_aliases',         'additional',  'REM_112/party_aliases.csv',         'Legal name / IBAN / account name aliases'),
  ('extract_non_trade_payments',    'additional',  'REM_112/non_trade_payments.csv',    'Payroll / HMRC / intercompany / FX class'),
  ('extract_so_ar_bridge',          'additional',  'REM_112/so_ar_bridge.csv',          'OE order number ↔ AR trx number')
  AS catalog(extract_name, kind, oci_path, match_use);

SELECT * FROM extract_catalog ORDER BY kind, extract_name;

CREATE OR REPLACE VIEW extract_row_counts AS
SELECT 'extract_inv_header'              AS extract_name, COUNT(*) AS row_count FROM extract_inv_header
UNION ALL SELECT 'extract_inv_line',                    COUNT(*) FROM extract_inv_line
UNION ALL SELECT 'extract_po_header',                   COUNT(*) FROM extract_po_header
UNION ALL SELECT 'extract_po_line',                     COUNT(*) FROM extract_po_line
UNION ALL SELECT 'extract_so_header',                   COUNT(*) FROM extract_so_header
UNION ALL SELECT 'extract_so_charges',                  COUNT(*) FROM extract_so_charges
UNION ALL SELECT 'extract_remittance',                  COUNT(*) FROM extract_remittance
UNION ALL SELECT 'extract_ar_invoice_header',           COUNT(*) FROM extract_ar_invoice_header
UNION ALL SELECT 'extract_ar_receipt_application',      COUNT(*) FROM extract_ar_receipt_application
UNION ALL SELECT 'extract_ar_deposit_batch',            COUNT(*) FROM extract_ar_deposit_batch
UNION ALL SELECT 'extract_ap_payment_invoice',          COUNT(*) FROM extract_ap_payment_invoice
UNION ALL SELECT 'extract_open_ar',                     COUNT(*) FROM extract_open_ar
UNION ALL SELECT 'extract_open_ap',                     COUNT(*) FROM extract_open_ap
UNION ALL SELECT 'extract_credit_memos',                COUNT(*) FROM extract_credit_memos
UNION ALL SELECT 'extract_party_aliases',               COUNT(*) FROM extract_party_aliases
UNION ALL SELECT 'extract_non_trade_payments',          COUNT(*) FROM extract_non_trade_payments
UNION ALL SELECT 'extract_so_ar_bridge',                COUNT(*) FROM extract_so_ar_bridge
UNION ALL SELECT 'extract_so_header_with_ar_trx',       COUNT(*) FROM extract_so_header_with_ar_trx;

SELECT * FROM extract_row_counts ORDER BY extract_name;


-- -----------------------------------------------------------------------------
-- 5. CSV export — OCI drop-in names + additional matching files
-- -----------------------------------------------------------------------------
-- Replace @cash_extracts_stg with the Snowflake stage that lands files into
-- aggCenter/ORG_112 - UK/. HEADER = TRUE keeps ingest column names.
--
-- DROP-IN (current matcher, no app change):
--   INV_112/ap_invoice_header.csv          ← extract_inv_header
--   INV_112/ap_invoice_line.csv            ← extract_inv_line
--   PO_112/po_header.csv                   ← extract_po_header
--   PO_112/po_lines.csv                    ← extract_po_line
--   SO_112/sales_order_header.csv          ← extract_so_header
--                                            OR extract_so_header_with_ar_trx
--   SO_112/charges_component.csv           ← extract_so_charges
--                                            OR extract_so_charges_with_ar_trx
--   REM_112/remittance.csv                 ← extract_remittance
--
-- ADDITIONAL (Grokbot / analysts / next ingest):
--   REM_112/ar_invoice_header.csv
--   REM_112/ar_receipt_application.csv
--   REM_112/ar_deposit_batch.csv
--   REM_112/ap_payment_invoice.csv
--   REM_112/open_ar.csv
--   REM_112/open_ap.csv
--   REM_112/credit_memos.csv
--   REM_112/party_aliases.csv
--   REM_112/non_trade_payments.csv
--   BANK_112/ce_statement_lines.csv
--
-- Recommended first experiment without a code change:
--   Use extract_so_header_with_ar_trx as sales_order_header.csv
--   Use extract_so_charges_with_ar_trx as charges_component.csv
--   Use extract_remittance as remittance.csv
--   That puts AR trx numbers and distinctive receipt/payment refs onto the
--   two ingest paths the matcher already searches (SO id + remittance refs).

-- Example COPY (uncomment and point at a real stage):
--
-- COPY INTO @cash_extracts_stg/aggCenter/ORG_112 - UK/INV_112/ap_invoice_header.csv
-- FROM (SELECT * FROM extract_inv_header)
-- FILE_FORMAT = (TYPE = CSV COMPRESSION = NONE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
--                NULL_IF = () EMPTY_FIELD_AS_NULL = FALSE)
-- HEADER = TRUE SINGLE = TRUE OVERWRITE = TRUE MAX_FILE_SIZE = 5368709120;
--
-- COPY INTO @cash_extracts_stg/aggCenter/ORG_112 - UK/INV_112/ap_invoice_line.csv
-- FROM (SELECT invoice_id, po_number, line_number, line_type, line_amount,
--              quantity, unit_price, line_description, org_id, po_header_id, po_line_id
--       FROM extract_inv_line)
-- FILE_FORMAT = (TYPE = CSV COMPRESSION = NONE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
--                NULL_IF = () EMPTY_FIELD_AS_NULL = FALSE)
-- HEADER = TRUE SINGLE = TRUE OVERWRITE = TRUE;
--
-- COPY INTO @cash_extracts_stg/aggCenter/ORG_112 - UK/PO_112/po_header.csv
-- FROM (SELECT * FROM extract_po_header)
-- FILE_FORMAT = (TYPE = CSV COMPRESSION = NONE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
--                NULL_IF = () EMPTY_FIELD_AS_NULL = FALSE)
-- HEADER = TRUE SINGLE = TRUE OVERWRITE = TRUE;
--
-- COPY INTO @cash_extracts_stg/aggCenter/ORG_112 - UK/PO_112/po_lines.csv
-- FROM (SELECT * FROM extract_po_line)
-- FILE_FORMAT = (TYPE = CSV COMPRESSION = NONE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
--                NULL_IF = () EMPTY_FIELD_AS_NULL = FALSE)
-- HEADER = TRUE SINGLE = TRUE OVERWRITE = TRUE;
--
-- COPY INTO @cash_extracts_stg/aggCenter/ORG_112 - UK/SO_112/sales_order_header.csv
-- FROM (SELECT sourcetransid, source_trans_id, source_trans_num, byng_pty_nme,
--              transal_crncy_code, trans_on, cust_ponum, rqstng_bu_unit
--       FROM extract_so_header_with_ar_trx)
-- FILE_FORMAT = (TYPE = CSV COMPRESSION = NONE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
--                NULL_IF = () EMPTY_FIELD_AS_NULL = FALSE)
-- HEADER = TRUE SINGLE = TRUE OVERWRITE = TRUE;
--
-- COPY INTO @cash_extracts_stg/aggCenter/ORG_112 - UK/SO_112/charges_component.csv
-- FROM (SELECT source_trans_id, price_element_code, charge_crncy_extended_amount
--       FROM extract_so_charges_with_ar_trx)
-- FILE_FORMAT = (TYPE = CSV COMPRESSION = NONE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
--                NULL_IF = () EMPTY_FIELD_AS_NULL = FALSE)
-- HEADER = TRUE SINGLE = TRUE OVERWRITE = TRUE;
--
-- COPY INTO @cash_extracts_stg/aggCenter/ORG_112 - UK/REM_112/remittance.csv
-- FROM (SELECT flow_direction, source_module, org_id, operating_unit_name,
--              remittance_id, oracle_payment_id, remittance_number, remittance_date,
--              remittance_status, payment_currency_code, payment_total_amount,
--              invoice_number, counterparty_name
--       FROM extract_remittance)
-- FILE_FORMAT = (TYPE = CSV COMPRESSION = NONE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
--                NULL_IF = () EMPTY_FIELD_AS_NULL = FALSE)
-- HEADER = TRUE SINGLE = TRUE OVERWRITE = TRUE;


-- -----------------------------------------------------------------------------
-- 6. Preview queries — what Grokbot can pull in the morning
-- -----------------------------------------------------------------------------
-- UK OU confirmation
SELECT * FROM v_uk_ou;

-- Generated window
SELECT * FROM cash_extract_params;

-- Drop-in previews (limit for eyeballing distinctive refs)
SELECT remittance_id, remittance_number, invoice_number, payment_total_amount,
       payment_currency_code, counterparty_name, receipt_method, flow_direction
FROM extract_remittance
QUALIFY ROW_NUMBER() OVER (PARTITION BY remittance_id ORDER BY invoice_number) <= 3
ORDER BY remittance_date DESC
LIMIT 200;

SELECT invoice_id, invoice_number, invoice_amount, supplier_name, taxation_country,
       payment_status_flag, amount_remaining
FROM extract_inv_header
ORDER BY invoice_date DESC
LIMIT 100;

SELECT po_number, vendor_name, amount, currency_code, status, org_id
FROM extract_po_header
ORDER BY ordered_date DESC
LIMIT 100;

SELECT source_trans_num, byng_pty_nme, transal_crncy_code, trans_on, source_kind
FROM extract_so_header_with_ar_trx
ORDER BY trans_on DESC
LIMIT 100;

SELECT cash_class, COUNT(*) AS payments, SUM(amount) AS amount
FROM extract_non_trade_payments
GROUP BY cash_class
ORDER BY amount DESC;

SELECT document_number, counterparty_name, amount_due_remaining, currency_code, due_date
FROM extract_open_ar
ORDER BY ABS(amount_due_remaining) DESC
LIMIT 100;
