-- NOTE: Requires Athena session for that Iceberg Catalog

DROP TABLE IF EXISTS package_revision;
DROP TABLE IF EXISTS package_tag;
DROP TABLE IF EXISTS package_entry;

---
--- CREATE alternatives
---

-- S3_Tables: Uses explicit Create Tables + Partitions

CREATE TABLE package_revision (
  registry     STRING,   
  pkg_name     STRING,   
  top_hash     STRING,   
  timestamp    TIMESTAMP, 
  message      STRING,   
  metadata    STRING       
)
PARTITIONED BY (
  registry,
  bucket(8, pkg_name),
  bucket(8, top_hash)
);

CREATE TABLE package_tag (
  registry   STRING,      
  pkg_name   STRING,      
  tag_name   STRING,      
  top_hash   STRING       
)
PARTITIONED BY (
  registry,
  tag_name,
  bucket(8, pkg_name)
);

CREATE TABLE package_entry (
  registry     STRING,    
  top_hash     STRING,
  logical_key  STRING,    
  physical_key STRING,    
  multihash   STRING,    
  size         BIGINT,    
  metadata    STRING        
)
PARTITIONED BY (
  registry,
  bucket(64, physical_key)
);

-- Athena_Tables: Uses explicit CTAS

CREATE TABLE package_revision
WITH (
  format = 'PARQUET',
  write_compression = 'SNAPPY',
  location = 's3://${targetBucket}/iceberg_catalog/package_revision',
  table_type = 'ICEBERG',
  is_external = false
) AS
SELECT
  'quilt-bake' AS registry,
  s.pkg_name,
  s.top_hash,
  from_unixtime(CAST(s.timestamp AS bigint)) AS timestamp,
  s.message,
  s.user_meta AS metadata
FROM "AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view" s
WHERE s.timestamp != 'latest';

CREATE TABLE package_tag
WITH (
  format = 'PARQUET',
  write_compression = 'SNAPPY',
  location = 's3://${targetBucket}/iceberg_catalog/package_tag',
  table_type = 'ICEBERG',
  is_external = false
) AS
SELECT
  'quilt-bake' AS registry,
  s.pkg_name,
  s.timestamp AS tag_name,
  s.top_hash
FROM "AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view" s
WHERE s.timestamp = 'latest';

CREATE TABLE package_entry
WITH (
  format = 'PARQUET',
  write_compression = 'SNAPPY',
  location = 's3://${targetBucket}/iceberg_catalog/package_entry',
  table_type = 'ICEBERG',
  is_external = false
) AS
SELECT
  'quilt-bake' AS registry,
  s.top_hash,
  s.logical_key,
  s.physical_key,
  concat(
    CASE s.hash.type
      WHEN 'SHA256' THEN '1220'
      WHEN 'sha2-256-chunked' THEN 'b150'
      ELSE '0000'
    END,
    s.hash.value
  ) AS multihash,
  s.size,
  s.meta AS metadata
FROM "AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_objects-view" s;

---
--- INSERT examples
---

-- package_revision Write Policy: Immutable - only insert new rows, never update or delete
INSERT INTO package_revision (registry, pkg_name, top_hash, timestamp, message, metadata)
SELECT DISTINCT
  'quilt-bake' AS registry,
  s.pkg_name,
  s.top_hash,
  from_unixtime(CAST(s.timestamp AS bigint)),
  s.message,
  s.user_meta AS metadata
FROM "AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view" s
LEFT JOIN package_revision t
  ON s.pkg_name = t.pkg_name
  AND s.top_hash = t.top_hash
  AND t.registry = 'quilt-bake'
WHERE t.pkg_name IS NULL
  AND s.timestamp != 'latest';
  
-- package_tag Write Policy: Mutable - insert or update based on tag/top_hash changes
INSERT INTO package_tag (registry, pkg_name, tag_name, top_hash)
SELECT DISTINCT
  'quilt-bake' AS registry,
  s.pkg_name,
  s.timestamp AS tag_name,
  s.top_hash
FROM "AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view" s
LEFT JOIN package_tag t
  ON s.pkg_name = t.pkg_name
  AND s.timestamp = t.tag_name
  AND t.registry = 'quilt-bake'
-- Insert or update tags only when 'latest' timestamp and top_hash differs
WHERE s.timestamp = 'latest'
  AND (t.top_hash IS NULL OR s.top_hash != t.top_hash);

-- package_entry Write Policy: Immutable - only insert new rows, never update or delete
INSERT INTO package_entry (registry, top_hash, logical_key, physical_key, multihash, size, metadata)
SELECT DISTINCT
  'quilt-bake' AS registry,
  s.top_hash,
  s.logical_key,
  s.physical_key,
  concat(
    CASE s.hash.type
      WHEN 'SHA256' THEN '1220'
      WHEN 'sha2-256-chunked' THEN 'b150'
      ELSE '0000'
    END,
    s.hash.value
  ) AS multihash,
  s.size,
  s.meta AS metadata
FROM "AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_objects-view" s
LEFT JOIN package_entry t
  ON s.logical_key = t.logical_key
  AND s.meta = t.metadata
  AND s.top_hash = t.top_hash
  AND t.registry = 'quilt-bake'
-- Insert only new entries that do not already exist in package_entry
WHERE t.logical_key IS NULL;

---
--- SELECT examples
---

SELECT e.size, e.logical_key, e.physical_key, e.registry, e.multihash
FROM package_entry e
JOIN package_tag t
  ON e.top_hash = t.top_hash
  AND e.registry = t.registry
WHERE t.pkg_name = 'ernest/test_large'
  AND t.registry = 'quilt-bake'
  AND t.tag_name = 'latest'
ORDER BY e.size ASC;
