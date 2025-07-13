# Deployment Guide

The Titanic stack now supports CloudFormation template parameters that can be configured at deployment time, allowing you to override environment variables and deploy the same template with different configurations.

## Quick Start

1. **Set up your environment variables** (optional - can be overridden at deployment):
   ```bash
   cp deploy.env.example .env
   # Edit .env with your values
   source .env
   ```

2. **Deploy the stack**:
   ```bash
   ./bin/deploy.sh --glue-database-name your_db --quilt-read-policy-arn arn:aws:iam::123456789012:policy/YourPolicy
   ```

## Deployment Options

### Using the deployment script (recommended)

The `bin/deploy.sh` script provides a convenient way to deploy with parameters:

```bash
# Basic deployment
./bin/deploy.sh \
  --glue-database-name mydb \
  --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy

# Full configuration
./bin/deploy.sh \
  --stack-name MyTitanicStack \
  --region us-west-2 \
  --profile myprofile \
  --glue-database-name mydb \
  --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy \
  --use-s3-table true \
  --lambda-timeout 300

# Generate CloudFormation template only (dry run)
./bin/deploy.sh --dry-run \
  --glue-database-name mydb \
  --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy
```

### Using CDK directly

```bash
# Build first
npm run build

# Deploy with parameters
npx cdk deploy \
  --parameters GlueDatabaseName=mydb \
  --parameters QuiltReadPolicyArn=arn:aws:iam::123456789012:policy/QuiltReadPolicy \
  --parameters UseS3Table=true \
  --parameters LambdaTimeout=300
```

### Using AWS CLI with generated template

```bash
# Generate template
./bin/deploy.sh --dry-run --glue-database-name mydb --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy

# Deploy with AWS CLI
aws cloudformation deploy \
  --template-file cdk.out/TitanicStack.template.json \
  --stack-name TitanicStack \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    GlueDatabaseName=mydb \
    QuiltReadPolicyArn=arn:aws:iam::123456789012:policy/QuiltReadPolicy \
    UseS3Table=true \
    LambdaTimeout=300
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `GlueDatabaseName` | String | `$QUILT_DATABASE_NAME` | Name of the Glue database containing source views |
| `QuiltReadPolicyArn` | String | `$QUILT_READ_POLICY_ARN` | ARN of IAM policy for reading from Quilt buckets |
| `UseS3Table` | String | `false` | Whether to use S3 Tables format (`true`/`false`) |
| `LambdaTimeout` | Number | `15000` | Lambda function timeout in seconds (1-900) |

## Environment Variables

The deployment script and CloudFormation parameters support the following environment variables as defaults:

- `QUILT_DATABASE_NAME` - Maps to `GlueDatabaseName` parameter
- `QUILT_READ_POLICY_ARN` - Maps to `QuiltReadPolicyArn` parameter  
- `USE_S3_TABLE` - Maps to `UseS3Table` parameter
- `LAMBDA_TIMEOUT` - Maps to `LambdaTimeout` parameter
- `AWS_DEFAULT_REGION` - AWS region for deployment
- `AWS_PROFILE` - AWS profile to use

## Examples

### Environment-based deployment
```bash
export QUILT_DATABASE_NAME=mydb
export QUILT_READ_POLICY_ARN=arn:aws:iam::123456789012:policy/QuiltReadPolicy
export USE_S3_TABLE=true
./bin/deploy.sh
```

### Parameter-based deployment (overrides environment)
```bash
./bin/deploy.sh \
  --glue-database-name override_db \
  --quilt-read-policy-arn arn:aws:iam::123456789012:policy/DifferentPolicy \
  --use-s3-table false
```

### Multi-environment deployments
```bash
# Development
./bin/deploy.sh --stack-name TitanicStack-Dev --glue-database-name dev_db --quilt-read-policy-arn arn:aws:iam::123456789012:policy/DevPolicy

# Production  
./bin/deploy.sh --stack-name TitanicStack-Prod --glue-database-name prod_db --quilt-read-policy-arn arn:aws:iam::123456789012:policy/ProdPolicy
```
