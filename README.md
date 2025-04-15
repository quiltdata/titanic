# Titanic - AWS Data Lake Table Merger

Automatically merges multiple AWS Glue tables into a single queryable table while maintaining data consistency and avoiding duplicates.

## Usage

### Prerequisites

- Node.js 18.x or later
- AWS CLI configured
- AWS CDK CLI (`npm install -g aws-cdk`)

### Quick Start

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
export QUILT_DATABASE_NAME=your_database_name  # Default: userathenadatabase
export CDK_DEFAULT_ACCOUNT=your_aws_account_id
export CDK_DEFAULT_REGION=your_aws_region
```

3. Deploy:
```bash
npm run cdk
```

### Triggering Merges

Send a message to the SQS queue to trigger a merge:

```bash
# Get queue URL
QUEUE_URL=$(aws sqs get-queue-url --queue-name TitanicStack-MergeQueue --query 'QueueUrl' --output text)

# Merge all tables
aws sqs send-message --queue-url $QUEUE_URL --message-body '{}'

# Merge specific tables
aws sqs send-message --queue-url $QUEUE_URL --message-body '{"table_prefix": "myprefix"}'
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
- **Amazon Athena** executes merge queries
- **Amazon S3** stores data and query results

### Security

Lambda has minimal IAM permissions for:
- Glue: GetTables, GetTable
- Athena: StartQueryExecution, GetQueryExecution
- S3: Read/Write access to target bucket
- SQS: Receive/delete messages
