-- Basic SELECT from package table
SELECT * 
FROM titanic_packages
LIMIT 10;

-- Join packages and objects
SELECT 
  p.pkg_name,
  p.top_hash,
  p.message,
  o.logical_key,
  o.size,
  o.hash.value as hash
FROM titanic_packages p
JOIN titanic_entries o 
  ON p.pkg_name = o.pkg_name 
  AND p.top_hash = o.top_hash
WHERE p.source_bucket = 'quilt-bake'
LIMIT 10;

-- Show table history
SELECT * FROM titanic_packages.history;
SELECT * FROM titanic_entries.history;

-- Show table snapshots
SELECT * FROM titanic_packages.snapshots;
SELECT * FROM titanic_entries.snapshots;

-- Show table metadata
SELECT * FROM titanic_packages.metadata;
SELECT * FROM titanic_entries.metadata;

-- Show table manifests
SELECT * FROM titanic_packages.manifests;
SELECT * FROM titanic_entries.manifests;

-- Show table files
SELECT * FROM titanic_packages.files;
SELECT * FROM titanic_entries.files;

-- Optimize tables (compact small files)
CALL system.optimize('titanic_packages');
CALL system.optimize('titanic_entries');

-- Expire old snapshots (cleanup)
CALL system.expire_snapshots('titanic_packages', TIMESTAMP '2025-04-07 00:00:00');
CALL system.expire_snapshots('titanic_entries', TIMESTAMP '2025-04-07 00:00:00');

-- Query with time travel (as of timestamp)
SELECT * 
FROM "titanic_packages" TIMESTAMP AS OF TIMESTAMP '2025-04-14 12:00:00'
WHERE source_bucket = 'quilt-bake'
LIMIT 10;

-- Query with time travel (as of snapshot ID)
SELECT * 
FROM "titanic_packages" VERSION AS OF 1234567
LIMIT 10;
