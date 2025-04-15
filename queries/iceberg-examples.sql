-- Basic SELECT from package table
SELECT * 
FROM titanic_merged_packages
LIMIT 10;

-- Query with time travel (as of timestamp)
SELECT * 
FROM "titanic_merged_packages" TIMESTAMP AS OF TIMESTAMP '2025-04-14 12:00:00'
WHERE source_bucket = 'test-bucket'
LIMIT 10;

-- Query with time travel (as of snapshot ID)
SELECT * 
FROM "titanic_merged_packages" VERSION AS OF 1234567
LIMIT 10;

-- Join packages and objects
SELECT 
  p.pkg_name,
  p.top_hash,
  p.message,
  o.logical_key,
  o.size,
  o.hash.value as hash
FROM titanic_merged_packages p
JOIN titanic_merged_objects o 
  ON p.pkg_name = o.pkg_name 
  AND p.top_hash = o.top_hash
WHERE p.source_bucket = 'test-bucket'
LIMIT 10;

-- Show table history
SELECT * FROM titanic_merged_packages.history;
SELECT * FROM titanic_merged_objects.history;

-- Show table snapshots
SELECT * FROM titanic_merged_packages.snapshots;
SELECT * FROM titanic_merged_objects.snapshots;

-- Show table metadata
SELECT * FROM titanic_merged_packages.metadata;
SELECT * FROM titanic_merged_objects.metadata;

-- Show table manifests
SELECT * FROM titanic_merged_packages.manifests;
SELECT * FROM titanic_merged_objects.manifests;

-- Show table files
SELECT * FROM titanic_merged_packages.files;
SELECT * FROM titanic_merged_objects.files;

-- Optimize tables (compact small files)
CALL system.optimize('titanic_merged_packages');
CALL system.optimize('titanic_merged_objects');

-- Expire old snapshots (cleanup)
CALL system.expire_snapshots('titanic_merged_packages', TIMESTAMP '2025-04-07 00:00:00');
CALL system.expire_snapshots('titanic_merged_objects', TIMESTAMP '2025-04-07 00:00:00');
