# Titanic - AWS Data Lake Table Merger

Automatically merges multiple AWS Glue tables into a single queryable table while maintaining data consistency and avoiding duplicates. The system supports both Apache Iceberg and AWS S3 Tables formats through runtime configuration.

## Table Formats

The system supports two table formats controlled by the `USE_S3_TABLE` environment variable:

- **Iceberg Tables** (`USE_S3_TABLE=false`, default): Uses Apache Iceberg format for ACID transactions and schema evolution
- **S3 Tables** (`USE_S3_TABLE=true`): Uses AWS S3 Tables service with built-in partitioning and optimization

## Table Structure

The system creates and manages these tables based on the normalized schema:

- **Source Views** (`*-view`): Views over your source data, e.g., `quilt-bake_packages-view`, `quilt-bake_objects-view`
- **Package Revisions** (`package_revision`): Specific versions of logical packages
- **Package Tags** (`package_tag`): Named versions (like `latest`) pointing to revisions
- **Package Entries** (`package_entry`): Individual files within package revisions

### Package Revision Schema

```sql
CREATE TABLE package_revision (
    registry STRING,         -- Source bucket/registry
    pkg_name STRING,         -- Package name
    top_hash STRING,         -- Unique manifest identifier
    timestamp TIMESTAMP,     -- When revision was created
    message STRING,          -- Commit message
    metadata STRING          -- User-defined package metadata
)
PARTITIONED BY (
    registry,
    bucket(8, pkg_name),
    bucket(8, top_hash)
);
```

### Package Tag Schema

```sql
CREATE TABLE package_tag (
    registry STRING,         -- Source bucket/registry
    pkg_name STRING,         -- Package name
    tag_name STRING,         -- Tag name (e.g., 'latest')
    top_hash STRING          -- Points to specific revision
)
PARTITIONED BY (
    registry,
    tag_name,
    bucket(8, pkg_name)
);
```

### Package Entry Schema

```sql
CREATE TABLE package_entry (
    registry STRING,         -- Source bucket/registry
    top_hash STRING,         -- Manifest this entry belongs to
    logical_key STRING,      -- Logical file name in package
    physical_key STRING,     -- Physical storage key
    multihash STRING,        -- Content hash in multihash format
    size BIGINT,            -- Object size in bytes
    metadata STRING          -- User-defined object metadata
)
PARTITIONED BY (
    registry,
    bucket(64, physical_key)
);
```

### Example Queries

Query package revisions:

```sql
-- Get latest package revisions by timestamp
SELECT DISTINCT pkg_name, top_hash, timestamp 
FROM package_revision
WHERE registry = 'quilt-bake'
ORDER BY timestamp DESC
LIMIT 10;

-- Find packages from a specific registry
SELECT * FROM package_revision 
WHERE registry = 'my-bucket'
LIMIT 10;

-- Time travel query (point-in-time view)
SELECT * FROM package_revision 
FOR SYSTEM_TIME AS OF TIMESTAMP '2025-04-14 12:00:00'
WHERE pkg_name = 'my-package' AND registry = 'quilt-bake';
```

Query using tags and entries:

```sql
-- Get entries for the latest version of a package
SELECT e.size, e.logical_key, e.physical_key, e.registry, e.multihash
FROM package_entry e
JOIN package_tag t
  ON e.top_hash = t.top_hash
  AND e.registry = t.registry
WHERE t.pkg_name = 'ernest/test_large'
  AND t.registry = 'quilt-bake'
  AND t.tag_name = 'latest'
ORDER BY e.size ASC;

-- Join revisions and entries for a specific package
SELECT r.pkg_name, r.message, e.logical_key, e.size
FROM package_revision r
JOIN package_entry e ON r.top_hash = e.top_hash AND r.registry = e.registry
WHERE r.pkg_name = 'my-package' AND r.registry = 'quilt-bake'
LIMIT 10;

-- Get total size of entries per package revision
SELECT 
  r.pkg_name,
  r.top_hash,
  r.timestamp,
  COUNT(*) as num_entries,
  SUM(e.size) as total_bytes
FROM package_revision r
JOIN package_entry e ON r.top_hash = e.top_hash AND r.registry = e.registry
WHERE r.registry = 'quilt-bake'
GROUP BY r.pkg_name, r.top_hash, r.timestamp
ORDER BY total_bytes DESC
LIMIT 10;
```

## Schema Design

The new Iceberg schema addresses several limitations of the legacy views:

### Key Improvements

1. **Separation of Concerns**: Package revisions, tags, and entries are normalized into separate tables
2. **Immutable Revisions**: Package revisions are write-once, ensuring data integrity
3. **Flexible Tagging**: Tags (like `latest`) can be updated to point to different revisions
4. **Multihash Format**: Standardized content hashing using multihash format
5. **Efficient Partitioning**: Tables are partitioned for optimal query performance

### Write Policies

- **package_revision**: Immutable - only insert new rows, never update or delete
- **package_tag**: Mutable - insert or update based on tag/top_hash changes  
- **package_entry**: Immutable - only insert new rows, never update or delete

## Usage

### Prerequisites

- Node.js 18.x or later
- AWS CLI configured
- AWS CDK CLI (`npm install -g aws-cdk`)

### Environment Configuration

Before deploying or running the project, configure the required environment variables. Copy the provided `example.env` file as a template:

```bash
cp example.env .env
```

Edit the `.env` file to include your specific configuration:

```env
# AWS Configuration
AWS_DEFAULT_REGION=us-east-2
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
CDK_DEFAULT_ACCOUNT=your-account-id
CDK_DEFAULT_REGION=$AWS_DEFAULT_REGION

# Table Format Selection
USE_S3_TABLE=false  # false = Iceberg (default), true = S3 Tables

# Project Configuration
QUEUE_NAME=YourQueueName
QUILT_CATALOG_DOMAIN=your-catalog-domain
QUILT_DATABASE_NAME=your-database-name
QUILT_READ_POLICY_ARN=arn:aws:iam::your-account-id:policy/your-policy-name
```

Load the environment variables:

```bash
source .env
```

### Table Mode Selection

#### Iceberg Tables (Default)
- **Best for**: ACID transactions, schema evolution, time travel queries
- **Format**: Apache Iceberg with Parquet storage
- **Benefits**: Full transactional support, efficient query performance
- **Setup**: `USE_S3_TABLE=false` (default)

#### S3 Tables
- **Best for**: Native AWS integration, automatic optimization
- **Format**: AWS S3 Tables service format
- **Benefits**: Built-in partitioning, AWS-managed optimization
- **Setup**: `USE_S3_TABLE=true`
- **Database**: Uses hardcoded `quilt_titanic` database name (required by S3 Tables Catalog)

### Migration Between Modes

When switching table modes:

1. **Backup existing data** (if any)
2. Set `USE_S3_TABLE` to desired value
3. **Redeploy** the stack: `npm run cdk`
4. Tables will be **automatically recreated** on first Lambda run after deployment

⚠️ **Warning**: Switching modes will recreate all tables, losing existing data.

### Quick Start

1. Install dependencies:

```bash
npm install
```

1. Set environment variables:

```bash
export QUILT_DATABASE_NAME=your_database_name  # For Iceberg tables (Default: userathenadatabase)
export CDK_DEFAULT_ACCOUNT=your_aws_account_id  # S3 Tables use hardcoded "quilt_titanic" database
export CDK_DEFAULT_REGION=your_aws_region
```

1. Deploy:

```bash
npm run cdk
```

### Triggering Merges

The system provides npm scripts for common event patterns:

```bash
# Process all buckets
npm run event:all

# Process specific bucket (quilt-bake)
npm run event:bake

# Process test/staff bucket 
npm run event:staff
```

Or send direct SQS messages:

```bash
# Process all buckets
aws sqs send-message --queue-url $QUEUE_URL --message-body '{}'

# Process specific bucket
aws sqs send-message --queue-url $QUEUE_URL --message-body '{"bucket": "quilt-bake"}'
```

## Error Handling

The system includes robust error handling:

- **S3 Access Denied**: Continues processing other buckets/tables
- **Missing Buckets**: Logs warnings but doesn't crash
- **Glue/Athena Errors**: Reports errors and continues with remaining operations
- **First Run**: Automatically drops existing tables on first deployment

## Troubleshooting

### Common Issues

**Tables not found**: Check that source views exist and are accessible
```bash
aws glue get-tables --database-name $QUILT_DATABASE_NAME
```

**Permission errors**: Verify IAM roles have required permissions:
- Glue: `GetTables`, `GetTable`
- Athena: `StartQueryExecution`, `GetQueryExecution`  
- S3: Read/write access to target bucket
- SQS: `ReceiveMessage`, `DeleteMessage`

**Wrong table format**: Check `USE_S3_TABLE` environment variable matches desired format

### Logs and Monitoring

Lambda logs are available in CloudWatch Logs. Look for:
- Table creation/merge statistics
- Error details with bucket/table context
- Performance metrics per operation

## Development

For detailed development information, see [doc/DEVELOP.md](doc/DEVELOP.md).

### Reference Files
- [doc/schema.sql](doc/schema.sql) - Complete SQL schema definitions for both table formats
- [doc/schema.md](doc/schema.md) - Schema design motivation and decisions
- [doc/CONTEXT_MANAGEMENT_REVIEW.md](doc/CONTEXT_MANAGEMENT_REVIEW.md) - Context flow improvements analysis

### Quick Commands

```bash
# Install and test
npm install
npm run test

# Build and deploy
npm run build
npm run cdk

# CDK operations
npx cdk diff        # Show pending changes
npx cdk synth       # Generate CloudFormation template  
npx cdk destroy     # Remove all resources
```

## Architecture Overview

- **AWS CDK** infrastructure in TypeScript
- **AWS Lambda** processes merge requests with configurable table types
- **Amazon SQS** triggers merges asynchronously
- **AWS Glue** defines table schemas and metadata
- **Amazon Athena** executes merge queries
- **Amazon S3/S3 Tables** stores data based on selected format
