# Titanic - AWS Data Lake Table Merger

Automatically merges the packages and objects views from every bucket into a single queryable Iceberg catalog while maintaining data consistency and avoiding duplicates. The system creates a standard S3 bucket to host the Iceberg catalog, and makes it readable by the Quilt stack.

There is also experimental support for S3 Table buckets (see Appendix).


## Table Structure

The lambda assumes you are running a Quilt stack that automatically creates tables and views for every bucket, e.g., `source-bucket_packages-view`, `source-bucket_objects-view`

The system creates and manages three tables based on a normalized schema from those views:

- **Package Revisions** (`package_revision`): Specific versions of logical packages
- **Package Tags** (`package_tag`): Named versions (like `latest`) pointing to revisions
- **Package Entries** (`package_entry`): Individual files within package revisions

## Schema Design

The new Iceberg schema addresses several limitations of the legacy views:

### Key Improvements

1. **Separation of Concerns**: Package revisions, tags, and entries are normalized into separate tables
3. **Flexible Tagging**: Tags (like `latest`) can be updated to point to different revisions
4. **Multihash Format**: Standardized content hashing based on the multihash spec (no need to parse a complex struct to for each object hash)
5. **Efficient Partitioning**: Tables are partitioned for optimal query performance

### Write Policies

- **package_tag**: Mutable - tracks which top_hash is the latest for each pkg_name
- **package_revision**: Immutable - only insert new rows, never update or delete
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

# Project Configuration
QUILT_CATALOG_DOMAIN=your-stacks-catalog-dns
QUILT_DATABASE_NAME=your-stacks-glue-database-name
QUILT_READ_POLICY_ARN=arn:aws:iam::$CDK_DEFAULT_ACCOUNT:policy/STACK-BucketReadPolicy-XXXX
```



### Quick Start

1.  Load the environment variables:

```bash
source .env
```

2. If you haven't already, you must bootstrap CDK for each region you use it in:

```bash
cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
```

3. Install dependencies:

```bash
npm install
```


4. Deploy:

This will:

a. run the tests
b. create the CloudFormation template
c. push it to your AWS account
d. send an event to merge tables from every bucket in your stack
e. dump the logs

```bash
npm run cdk
```

### Triggering Manual Merges

Once installed, the system will automatically update the iceberg catalog every time a new package revision is created.
For testing and initialization purposes, you can also submit a manual event.

The system provides an npm script to simplify that process:

```bash
# Process all buckets
npm run event

# Process a specific bucket (e.g., s3://test-bucket)
npm run event test-bucket

```

## Troubleshooting

For detailed troubleshooting information, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

### Error Handling

The system includes robust error handling, and will try to recover from invalid inputs.

- **S3 Access Denied**: Continues processing other buckets/tables
- **Missing Buckets**: Logs warnings but doesn't crash
- **Glue/Athena Errors**: Reports errors and continues with remaining operations
- **First Run**: Automatically drops existing tables on first deployment


### Common Issues

**Tables not found**: Check that source views exist and are accessible
```bash
aws glue get-tables --database-name $QUILT_DATABASE_NAME
```

**Cannot find or access the specified bucket**: The most common issue is missing or inaccessible S3 buckets for Athena results. This typically means:
- The CDK stack wasn't deployed successfully
- Environment variables are missing or incorrect  
- Lambda lacks S3 permissions

**Permission errors**: Verify IAM roles have required permissions:
- Glue: `GetTables`, `GetTable`
- Athena: `StartQueryExecution`, `GetQueryExecution`  
- S3: Read/write access to target bucket
- SQS: `ReceiveMessage`, `DeleteMessage`

**Wrong table format**: Check `USE_S3_TABLE` environment variable matches desired format

### Logs and Monitoring

Lambda logs are available in CloudWatch Logs. We provide convenience methods to monitor them:

```bash
npm run logs
```


Look for:
- Table creation/merge statistics
- Error details with bucket/table context
- Performance metrics per operation

## Development

For detailed development information, see [doc/DEVELOP.md](doc/DEVELOP.md).

## Appendix: S3 Table Buckets

WARNING: S3 Table Buckets are a relatively new feature in AWS, and not fully supported by some tools and services.
This support is experimental; use at your risk.

### Table Mode Selection

Edit your `.env` file to enable S3 Table Buckets.

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
