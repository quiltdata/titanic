# USE_S3_TABLE Configuration Guide

This document describes the two different table creation strategies available in the Titanic project, controlled by the `USE_S3_TABLE` environment variable.

## Overview

The Titanic project supports two distinct approaches for creating and managing data lake tables:

1. **S3 Tables** (`USE_S3_TABLE=true`) - Uses AWS S3 Tables for native S3 table management
2. **Iceberg Tables** (`USE_S3_TABLE=false`) - Uses Apache Iceberg format with Athena CTAS

## Configuration

Set the environment variable in your `.env` file:

```bash
# For S3 Tables (partitioned, managed by S3 Tables service)
USE_S3_TABLE=true

# For Iceberg Tables (CTAS with WITH clause, managed by Athena)
USE_S3_TABLE=false  # Default
```

## S3 Tables Mode (`USE_S3_TABLE=true`)

### Key Differences
- **Infrastructure**: Uses AWS S3 Tables TableBucket + regular S3 bucket
- **Table Creation**: Empty tables with sophisticated multi-level partitioning and bucketing
- **Data Population**: Separate INSERT statements after table creation
- **Partitioning**: Multi-level with `registry`, `bucket()` functions for optimal distribution
- **Management**: Native S3 Tables service APIs

*See [schema.sql](schema.sql) for complete CREATE TABLE examples.*

### Permissions Required
- `s3tables:GetTable`
- `s3tables:CreateTable`
- `s3tables:PutTableData`
- `s3tables:GetTableData`
- `s3tables:UpdateTable`
- `s3tables:DeleteTable`
- `s3tables:ListTables`
- Standard S3 permissions for the regular bucket

## Iceberg Tables Mode (`USE_S3_TABLE=false`)

### Key Differences
- **Infrastructure**: Single regular S3 bucket for everything
- **Table Creation**: CTAS (Create Table As Select) with immediate data population
- **Data Population**: Initial data loaded during table creation from source views
- **Partitioning**: None - Iceberg manages data organization internally
- **Management**: Athena + Glue Catalog
- **Complex Logic**: Supports advanced transformations (multihash generation, type casting)

*See [schema.sql](schema.sql) for complete CTAS examples with complex SELECT logic.*

### Permissions Required
- Standard S3 bucket permissions
- Athena query execution permissions
- Glue Catalog permissions

## Code Implementation Details

### Infrastructure (CDK Stack)
The stack creates different bucket types based on the mode:

- **S3 Tables**: Creates `s3tables.TableBucket` + regular S3 bucket
- **Iceberg**: Creates single regular S3 bucket

### Table Creation Logic
The `BaseTable` class switches behavior automatically:

- **S3 Tables**: `createEmptyTable()` → empty partitioned tables
- **Iceberg**: `createTableAsSelect()` → CTAS with data

*See [schema.sql](schema.sql) for complete SQL examples and INSERT patterns.*

## Testing

## Testing and Deployment

Both modes are fully tested in the test suites with runtime switching based on the `useS3Table` parameter.

For detailed SQL examples, table schemas, and INSERT patterns, see [schema.sql](schema.sql).

## Key Differences Summary

| Aspect | S3 Tables (`USE_S3_TABLE=true`) | Iceberg (`USE_S3_TABLE=false`) |
|--------|----------------------------------|--------------------------------|
| **Infrastructure** | TableBucket + S3 bucket | Single S3 bucket |
| **Table Creation** | Empty with partitions/buckets | CTAS with immediate data |
| **Partitioning** | Multi-level with bucket() functions | None (Iceberg internal) |
| **Data Population** | Separate INSERT statements | During table creation |
| **Complex Logic** | In INSERT queries | In CTAS SELECT clauses |
| **Management** | S3 Tables APIs | Athena + Glue Catalog |
| **Use Case** | High-performance analytics | Advanced table features |

## Migration Between Modes

To switch between modes:
1. Update `USE_S3_TABLE` environment variable
2. Redeploy CDK stack (creates appropriate infrastructure)  
3. Lambda automatically uses new table creation strategy
