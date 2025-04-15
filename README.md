# Titanic - AWS Data Lake Table Manager

This project creates and manages merged Iceberg/Parquet tables in AWS using CDK. It automatically combines data from multiple source tables into a single queryable table while maintaining data consistency and avoiding duplicates.

## Architecture

- **AWS CDK Infrastructure** written in TypeScript
- Uses **AWS Glue** for table definitions
- **AWS Lambda** function to perform table merges
- **Amazon SQS** for triggering merges
- **Amazon Athena** for querying and merging data
- **Amazon S3** for data storage

## Prerequisites

- Node.js 18.x or later
- AWS CLI configured with appropriate credentials
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Setup

1. Install dependencies:

```bash
npm install
```

1. Configure environment variables:

```bash
export QUILT_DATABASE_NAME=your_database_name  # Default: userathenadatabase
export QUILT_LAMBDA_TIMEOUT=10000             # Default: 5000 (milliseconds)
export CDK_DEFAULT_ACCOUNT=your_aws_account_id
export CDK_DEFAULT_REGION=your_aws_region
```

1. Deploy the stack:

```bash
npm run cdk
```

## Table Schema

### Merged Table (`titanic_merged`)

```sql
CREATE TABLE titanic_merged (
  pkg_name STRING,
  top_hash STRING,
  timestamp STRING,
  message STRING,
  user_meta STRING,
  source_bucket STRING
)
PARTITIONED BY (source_bucket)
STORED AS PARQUET
```

## Development

- `npm run build` - Compile TypeScript
- `npm run test` - Run unit tests
- `npm run cdk` - Deploy stack (runs tests first)
- `npx cdk diff` - Show pending changes
- `npx cdk synth` - Generate CloudFormation template

## Debug Mode

To merge tables from only a specific source bucket:

```bash
DEBUG_BUCKET=quilt-bake npm run cdk
```

## Testing

Tests are written using Jest and the AWS CDK Assertions library:

```bash
npm run test
```

## Triggering Table Merges

To trigger a merge operation manually:

```bash
# Get the queue URL
QUEUE_URL=$(aws sqs get-queue-url --queue-name TitanicStack-MergeQueue --query 'QueueUrl' --output text)

# Send a message to trigger merge
aws sqs send-message --queue-url $QUEUE_URL --message-body '{"action": "merge"}'
```

## Cleanup

To remove all resources:

```bash
npx cdk destroy
```

## Security

The Lambda function has minimal IAM permissions:

- Glue: GetTables, GetTable
- Athena: StartQueryExecution
- S3: Read/Write to specified bucket
- SQS: Receive and delete messages

## Limitations

- Assumes source tables have compatible schemas
- Athena queries run asynchronously
- No automatic cleanup of Athena query results
