# Titanic - AWS Data Lake Table Merger

Automatically merges the packages and objects views from every bucket into a single queryable Iceberg catalog while maintaining data consistency and avoiding duplicates.

**🚀 Quick Start**: Download the [latest release](https://github.com/quiltdata/titanic/releases/latest) and follow the deployment steps in [the deployment README](bin/README.md).

## Usage

After deployment:

```bash
# Process all buckets manually
npm run deploy:event

# Monitor logs
npm run deploy:logs recent 5 # show last 5 minutes
```

## Table Structure

The system creates three normalized Iceberg tables:

- **Package Revisions** (`package_revision`): Specific versions of packages
- **Package Tags** (`package_tag`): Named versions (like `latest`)
- **Package Entries** (`package_entry`): Individual files within packages

See [doc/schema.md](doc/schema.md) for detailed schema design.

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

## Troubleshooting

### Common Issues

#### ❌ "Cannot find or access the specified bucket"

- **Cause**: CDK stack didn't deploy properly or missing S3 bucket
- **Solution**: Check deployment with `npm run deploy:outputs` and redeploy if needed: `npm run cdk`

#### ❌ "User is not authorized" / Permission denied

- **Cause**: Wrong policy ARN or insufficient permissions
- **Solution**: Verify `QUILT_READ_POLICY_ARN` is correct and check AWS credentials: `aws sts get-caller-identity`

#### ❌ "Table not found" errors

- **Cause**: Source Quilt views don't exist
- **Solution**: Verify views exist: `aws glue get-tables --database-name $ATHENA_DATABASE_NAME`

#### ❌ "Missing required environment variables"

- **Cause**: `.env` file missing or incomplete
- **Solution**: Copy `env.example` to `.env` and edit with your values

#### ❌ Template not found

- **Cause**: Running deployment from wrong directory
- **Solution**: Ensure you're running `./deploy.sh` from the package directory

#### ❌ AWS Permissions Errors

- **Cause**: Insufficient IAM permissions
- **Solution**: Verify AWS credentials have necessary permissions to create CloudFormation stacks

### Diagnostic Commands

```bash
# Check stack status and resources
npm run deploy:outputs
aws cloudformation describe-stacks --stack-name TitanicStack
aws s3 ls | grep titanic
aws glue get-tables --database-name $ATHENA_DATABASE_NAME

# Monitor logs
npm run deploy:logs recent 30      # Last 30 minutes
npm run deploy:logs errors         # Only errors

# View deployment events (if stack fails)
aws cloudformation describe-stack-events --stack-name TitanicStack
```

### When to Redeploy

**Full redeploy needed**: First deployment failed, changing `USE_S3_TABLE` setting, missing AWS resources

**Simple restart sufficient**: Lambda code changes only, temporary AWS API issues

## Cleanup

```bash
npm run destroy                     # Delete everything
npm run destroy:buckets:contents    # Delete data only
```

## Documentation

- **[doc/DEVELOP.md](doc/DEVELOP.md)** - Building directly from CDK
- **[doc/SCHEMA.md](doc/schema.md)** - Table schema design and decisions

## Version Information

This package uses pre-built Lambda assets from the public S3 bucket:

- **Assets bucket**: Generated deterministically as `titanic-assets-{account}-{region}`
- **Lambda code**: `lambda/merge-tables.zip`
- **Strategy**: Always uses the latest available version
