# Titanic - AWS Data Lake Table Merger

Automatically merges multiple AWS Glue tables into a single queryable table while maintaining data consistency and avoiding duplicates.

## Table Structure

The system creates and manages these tables:

- **Source Views** (`*-view`): Views over your source data, e.g., `bucket1_objects-view`, `bucket2_objects-view`
- **Merged Package Table** (`titanic_packages`): An Iceberg table containing deduplicated package metadata
- **Merged Objects Table** (`titanic_entries`): An Iceberg table containing deduplicated object metadata

### Package Table Schema

```sql
CREATE TABLE titanic_packages (
    pkg_name STRING,
    top_hash STRING,
    timestamp STRING,
    message STRING,
    user_meta STRING,
    source_bucket STRING
)
```

### Objects Table Schema

```sql
CREATE TABLE titanic_entries (
    pkg_name STRING,
    top_hash STRING,
    timestamp STRING,
    logical_key STRING,
    physical_key STRING,
    size BIGINT,
    hash STRUCT<type:STRING,value:STRING>,
    meta STRING,
    source_bucket STRING
)
```

### Example Queries

Query package metadata:

```sql
-- Get latest package versions
SELECT DISTINCT pkg_name, top_hash, timestamp 
FROM titanic_packages
ORDER BY timestamp DESC
LIMIT 10;

-- Find packages from a specific source
SELECT * FROM titanic_packages 
WHERE source_bucket = 'my-bucket'
LIMIT 10;

-- Time travel query (point-in-time view)
SELECT * FROM titanic_packages 
FOR SYSTEM_TIME AS OF TIMESTAMP '2025-04-14 12:00:00'
WHERE pkg_name = 'my-package';
```

Query objects with their package metadata:

```sql
-- Join packages and objects
SELECT p.pkg_name, p.top_hash, o.logical_key, o.size
FROM titanic_packages p
JOIN titanic_entries o 
  ON p.pkg_name = o.pkg_name 
  AND p.top_hash = o.top_hash
WHERE p.source_bucket = 'my-bucket'
LIMIT 10;

-- Find all objects in a specific package version
SELECT o.* 
FROM titanic_entries o
WHERE o.pkg_name = 'my-package'
  AND o.top_hash = 'abc123'
ORDER BY o.logical_key;

-- Get total size of objects per package
SELECT 
  o.pkg_name,
  o.top_hash,
  COUNT(*) as num_objects,
  SUM(o.size) as total_bytes
FROM titanic_entries o
GROUP BY o.pkg_name, o.top_hash
ORDER BY total_bytes DESC
LIMIT 10;
```

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

# Quilt Configuration
QUILT_CATALOG_DOMAIN=your-catalog-domain
QUILT_DATABASE_NAME=your-database-name
QUILT_READ_POLICY_ARN=arn:aws:iam::your-account-id:policy/your-policy-name

# Titanic Configuration
ATHENA_BUCKET=your-athena-results-bucket
SERVICE_BUCKET=your-titanic-bucket
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
