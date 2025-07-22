# Titanic Stack Deployment Package

This technology preview creates an Iceberg catalog with tables that mirrors the package information from a Quilt stack:

- package_revision
- package_tag
- package_entry

You can query it from the Athena console
(or the Queries tab, **if** you add the Titanic bucket to your stack).
It includes an EventBridge rule that will update the catalog as new packages are created,
which is also used to initialize the catalog.

## Quick Start

To deploy, just `cd` into the release directory, and run the deploy script with the appropriate parameters
for your Quilt stack.

```bash
# Deploy with CLI parameters
./deploy.sh --athena-database-name userathenadatabase-XXXXXXXX \
            --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy \
            --aws-region us-east-1
```

## Configuration Parameters

| Description             | Default      | CLI Parameter              | Env Variable           |
|-------------------------|--------------|----------------------------|------------------------|
| Athena DB name          | (required)   | `--athena-database-name`   | `ATHENA_DATABASE_NAME` |
| Quilt read policy ARN   | (required)   | `--quilt-read-policy-arn`  | `QUILT_READ_POLICY_ARN`|
| AWS region              | `us-east-1`  | `--aws-region`             | `AWS_DEFAULT_REGION`   |
| AWS profile             | `default`    | `--aws-profile`            | `AWS_PROFILE`          |

## Advanced Configuration

For repeated deployments, you can use environment variables instead of CLI parameters:

```bash
# 1. Copy and edit configuration
cp env.example .env
# Edit .env with your configuration values

# 2. Deploy using environment variables
./deploy.sh
```

## Prerequisites

- AWS CLI configured with deployment permissions
- Required AWS permissions:
  - CloudFormation (create/update stacks)
  - S3 (create buckets, manage objects)
  - IAM (create/attach policies and roles)
  - Lambda (create/update functions)
  - Athena (query execution)
  - Glue (database/table management)
  - EventBridge (create/manage rules)

## Package Contents

- `README.md` - This documentation
- `deploy.sh` - Deployment script with automatic environment loading
- `env.example` - Configuration template
- `initial-event.json` - EventBridge event to initialize catalog
- `template.json` - CloudFormation template with parameterized deployment

## Deployment Process Details

The deployment script will:

1. **Load configuration** from `.env` file (if present)
2. **Validate parameters** and AWS CLI setup
3. **Deploy CloudFormation stack** with your parameters
4. **Create AWS resources**:
   - S3 buckets for Glue tables and S3 Tables
   - Lambda function for table merging
   - EventBridge rule for package revision events
   - IAM roles and policies
5. **Display stack outputs** including bucket names and function details

## Troubleshooting

### Common Issues

#### Template not found

- Ensure you're running `./deploy.sh` from the package directory

### Missing Required Parameters

- Set `ATHENA_DATABASE_NAME` and `QUILT_READ_POLICY_ARN` in `.env` or via command line

### AWS Permissions Errors

- Verify your AWS credentials have necessary permissions
- Check that your IAM user/role can create CloudFormation stacks

### Stack Deployment Fails

- Review CloudFormation events in AWS Console
- Check the deployment output for specific error messages
- Ensure the Quilt read policy ARN exists and is accessible

### Getting Help

**View stack status:**

```bash
aws cloudformation describe-stacks --stack-name TitanicStack
```

**View deployment events:**

```bash
aws cloudformation describe-stack-events --stack-name TitanicStack
```

**Delete stack (if needed):**

```bash
aws cloudformation delete-stack --stack-name TitanicStack
```

## Architecture

The Titanic Stack creates a data lake table merger that:

1. **Listens for package revision events** via EventBridge
2. **Merges Quilt package metadata** into consolidated Athena tables
3. **Supports both Glue and S3 Tables** formats
4. **Provides unified views** of package revisions, tags, and entries

### Key Components

- **Lambda Function**: Processes events and manages table operations
- **S3 Buckets**: Store Glue tables and S3 Tables data
- **EventBridge Rule**: Routes package events to the Lambda function
- **IAM Roles**: Provide necessary permissions for cross-service access

## Version Information

This package uses pre-built Lambda assets from the public S3 bucket:

- **Assets bucket**: Generated deterministically as `titanic-assets-{account}-{region}`
- **Lambda code**: `lambda/merge-tables.zip`
- **Strategy**: Always uses the latest available version

For development or custom builds, see the source repository for building from source.
