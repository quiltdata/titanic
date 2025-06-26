# Titanic - AWS Data Lake Table Merger

Automatically merges multiple AWS Glue tables into a single queryable table while maintaining data consistency and avoiding duplicates.

## Table Structure

The system creates and manages these Iceberg tables based on the new schema:

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

Before deploying or running the project, ensure you have configured the required environment variables. You can use the provided `example.env` file as a template. Copy it to `.env` and update the values as needed:

```bash
cp example.env .env
```

Edit the `.env` file to include your specific configuration:

```env
AWS_DEFAULT_REGION=us-east-2
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
CDK_DEFAULT_ACCOUNT=your-account-id
CDK_DEFAULT_REGION=$AWS_DEFAULT_REGION
CDK_BOOTSTRAP=aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
CDK_DEFAULT_EMAIL=your-email@example.com
QUEUE_NAME=YourQueueName
QUILT_CATALOG_DOMAIN=your-catalog-domain
QUILT_DATABASE_NAME=your-database-name
QUILT_READ_POLICY_ARN=arn:aws:iam::your-account-id:policy/your-policy-name
```

Load the environment variables into your shell session before running commands:

```bash
source .env
```

### Quick Start

1. Install dependencies:

```bash
npm install
```

1. Set environment variables:

```bash
export QUILT_DATABASE_NAME=your_database_name  # Default: userathenadatabase
export CDK_DEFAULT_ACCOUNT=your_aws_account_id
export CDK_DEFAULT_REGION=your_aws_region
```

1. Deploy:

```bash
npm run cdk
```

### Triggering Merges

Send a message to the SQS queue to trigger a merge:

```bash
# Get queue URL
source .env

# Merge all tables
aws sqs send-message --queue-url $QUEUE_URL --message-body '{}'

# Merge specific tables
aws sqs send-message --queue-url $QUEUE_URL --message-body '{"table_prefix": "test"}'
```

## Development

### Local Testing

```bash
npm run test
```

### CDK Commands

- `npm run build` - Compile TypeScript
- `npx cdk diff` - Show pending changes
- `npx cdk synth` - Generate CloudFormation template
- `npx cdk destroy` - Remove all resources

### Architecture

- **AWS CDK** infrastructure in TypeScript
- **AWS Lambda** processes merge requests
- **Amazon SQS** triggers merges asynchronously
- **AWS Glue** defines table schemas
- **Amazon Athena** executes merge queries using Iceberg format
- **Amazon S3** stores data and query results

### Security

Lambda has minimal IAM permissions for:

- Glue: GetTables, GetTable
- Athena: StartQueryExecution, GetQueryExecution
- S3: Read/Write access to target bucket
- SQS: Receive/delete messages
