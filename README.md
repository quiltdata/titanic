# Titanic - AWS Data Lake Table Merger

Automatically merges the packages and objects views from every bucket into a single queryable Iceberg catalog while maintaining data consistency and avoiding duplicates.

**🚀 Quick Start**: Download the [latest release](https://github.com/quiltdata/titanic/releases/latest) and follow the deployment steps below.

## Installation

Download and deploy a pre-built package:

```bash
# Download latest release
curl -L -o titanic-release.tar.gz https://github.com/quiltdata/titanic/releases/latest/download/release-*.tar.gz
tar -xzf titanic-release.tar.gz
cd release-*/

# Configure
cp env.example .env
# Edit .env with your required values (see Configuration below)

# Deploy
./deploy.sh
```

### Configuration

Edit `.env` with these **required** values:

```env
# Required: Your Quilt stack configuration
QUILT_DATABASE_NAME=your_glue_database_name
QUILT_READ_POLICY_ARN=arn:aws:iam::123456789012:policy/STACK-BucketReadPolicy-XXXX

# Optional: Advanced settings
USE_S3_TABLE=false          # Use S3 Tables format (experimental)
LAMBDA_TIMEOUT=900          # Lambda timeout in seconds
AWS_DEFAULT_REGION=us-east-1
```

## Usage

After deployment:

```bash
# Process all buckets manually
npm run deploy:event

# Monitor logs
npm run deploy:logs recent 5 # show last 5 minutes
```

## Troubleshooting

### Common Issues

**❌ "Cannot find or access the specified bucket"**
- **Cause**: CDK stack didn't deploy properly or missing S3 bucket
- **Solution**: 
  1. Check deployment: `npm run deploy:outputs`
  2. Redeploy if needed: `npm run cdk`

**❌ "User is not authorized" / Permission denied**
- **Cause**: Wrong policy ARN or insufficient permissions
- **Solution**: 
  1. Verify `QUILT_READ_POLICY_ARN` is correct
  2. Check AWS credentials: `aws sts get-caller-identity`

**❌ "Table not found" errors**
- **Cause**: Source Quilt views don't exist
- **Solution**: Verify views exist: `aws glue get-tables --database-name $QUILT_DATABASE_NAME`

**❌ "Missing required environment variables"**
- **Cause**: `.env` file missing or incomplete
- **Solution**: Copy `env.example` to `.env` and edit with your values

### Diagnostic Commands

```bash
# Check stack status
npm run deploy:outputs
aws cloudformation describe-stacks --stack-name TitanicStack

# Check resources
aws s3 ls | grep titanic
aws glue get-tables --database-name $QUILT_DATABASE_NAME

# Monitor logs
npm run deploy:logs recent 30      # Last 30 minutes
npm run deploy:logs errors         # Only errors
```

### When to Redeploy

**Full redeploy needed**:
- First deployment failed
- Changing `USE_S3_TABLE` setting
- Missing AWS resources

**Simple restart sufficient**:
- Lambda code changes only
- Temporary AWS API issues

## Table Structure

The system creates three normalized Iceberg tables:

- **Package Revisions** (`package_revision`): Specific versions of packages
- **Package Tags** (`package_tag`): Named versions (like `latest`) 
- **Package Entries** (`package_entry`): Individual files within packages

See [doc/SCHEMA.md](doc/SCHEMA.md) for detailed schema design.

## Cleanup

```bash
npm run destroy              # Delete everything
npm run destroy:buckets:contents    # Delete data only
```

## Documentation

- **[doc/DEVELOP.md](doc/DEVELOP.md)** - Architecture, development, and building
- **[doc/SCHEMA.md](doc/SCHEMA.md)** - Table schema design and decisions

## S3 Tables Support (Experimental)

Set `USE_S3_TABLE=true` to use AWS S3 Tables instead of Glue tables. This is experimental and has limited tool support.

⚠️ **Warning**: Switching table modes recreates all tables, losing existing data.


