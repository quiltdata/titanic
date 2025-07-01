# Titanic - AWS Data Lake Table Merger

Automatically merges multiple AWS Glue tables into a single queryable table while maintaining data consistency and avoiding duplicates. The system supports both Apache Iceberg and AWS S3 Tables formats through runtime configuration.

## Table Formats

The system supports two table formats controlled by the `USE_S3_TABLE` environment variable:

- **Glue Tables** (`USE_S3_TABLE=false`, default): Uses Glue catalog for ACID transactions and schema evolution
- **S3 Tables** (`USE_S3_TABLE=true`): Uses AWS S3 Tables service with built-in partitioning and optimization

## Table Structure

The system creates and manages these tables based on the normalized schema:

- **Source Views** (`*-view`): Views over your source data, e.g., `quilt-bake_packages-view`, `quilt-bake_objects-view`
- **Package Revisions** (`package_revision`): Specific versions of logical packages
- **Package Tags** (`package_tag`): Named versions (like `latest`) pointing to revisions
- **Package Entries** (`package_entry`): Individual files within package revisions

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
USE_S3_TABLE=false  # false = Glue (default), true = S3 Tables

# Project Configuration
QUEUE_NAME=YourQueueName
QUILT_CATALOG_DOMAIN=your-stacks-catalog-dns
QUILT_DATABASE_NAME=your-stacks-glue-database-name
QUILT_READ_POLICY_ARN=arn:aws:iam::your-account-id:policy/your-policy-name
```

Load the environment variables:

```bash
source .env
```

### Table Mode Selection

#### Glue Tables (Default)
- **Best for**: ACID transactions, schema evolution, time travel queries
- **Format**: Glue catalog with Parquet storage
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
export QUILT_DATABASE_NAME=your_database_name  # For Glue tables (Default: userathenadatabase)
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

# Process test/staff bucket (will error)
npm run event:staff
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
