# Glue Table Schema 

Draft 1a

## Motivation

The existing packages_view and object_view tables have a number of limitations.
This is a unique opportunity to clean them up before formalizing the Iceberg format.
This will be especially important if/when we allow 'Iceberg-native' packages that are not tied to physical manifests.

### Challenges

1. We create duplicate "packages" rows for the 'latest' tag
2. The 'objects' table is actually entries
3. We implicitly assume S3 for everything
4. Hashes are structs with a value and a type
5. Balancing simplicity with performance

### Opportunities

1. Less constrained by Athena/Glue parsing limitations
2. Aligning with modern (quilt-rs) terminology
3. Cleaner conceptual model
4. Design for extensibility

## Proposed Tables

### 1. package_revision

Represents a specific version of a logical package.

- `registry`: bucket (STRING)
- `pkg_name`: package name (STRING)
- `top_hash`: Unique identifier for this manifest (STRING)
- `timestamp`: time when revision was created (TIMESTAMP)
- `message`: Commit message (STRING)
- `metadata`: Arbitrary user-defined package-level data (STRING)

**Partitioned by:** `registry`, `bucket(8, pkg_name)`, `bucket(8, top_hash)`

### 2. package_tag

Represents a named version of a logical package.

- `registry`: bucket (STRING)
- `pkg_name`: package name (STRING)
- `tag_name`: tag name, usually `latest` (STRING)
- `top_hash`: Dereferenced contents of tag (identifies a manifest) (STRING)

**Partitioned by:** `registry`, `tag_name`, `bucket(8, pkg_name)`

### 3. package_entry

Represents a single logical file in a package. Each entry is tied to a specific manifest via `top_hash`.

- `registry`: bucket (STRING)
- `top_hash`: Unique identifier for the manifest this entry belongs to (STRING)
- `logical_key`: Logical file name inside package (STRING)
- `physical_key`: Actual physical storage key (STRING)
- `multihash`: Content hash in multihash format (STRING)
- `size`: Object size (BIGINT)
- `metadata`: Arbitrary user-defined object-level data (STRING)

**Partitioned by:** `registry`, `bucket(64, physical_key)`

---

## OPEN ISSUES

1. URIs everywhere, to allow non-S3 storage?
2. Deconstruct the physical key (bucket, path, versionId) for easier partitioning and lookups?
3. Use the newer QuiltCore names?
   - pkg_name -> namespace
   - logical_key -> name
   - physical_key -> place
4. ✅ multihash everywhere, to avoid hash_type? **RESOLVED: Using multihash format**
5. ✅ separate linking table removed **RESOLVED: entries now directly reference top_hash**
6. ✅ package_ prefix? **RESOLVED: Using package_ prefix for clarity**
