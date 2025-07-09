# Troubleshooting Guide - Titanic Data Lake Table Merger

## Common Issues and Solutions

### 1. "Cannot find or access the specified bucket" Error

**Error Message:**
```
❌ Failed to drop table package_revision from database userathenadatabase-6fosfzznfasm: Cannot find or access the specified bucket
```

**Important Note:**
You may notice that table existence checks succeed while DROP TABLE operations fail. This is because:
- **Table existence checks** use the Glue Data Catalog API (no S3 bucket required)
- **DROP TABLE operations** use the Athena query API (requires S3 bucket for results)

This is why you see logs like:
```
📋 Table package_revision EXISTS in database userathenadatabase-6fosfzznfasm  ✅ (Glue API works)
❌ Failed to drop table package_revision: Cannot find or access the specified bucket  ❌ (Athena API fails)
```

**Cause:**
The Athena service cannot access the S3 bucket configured for query results. This typically happens when:
- The S3 bucket for Athena results doesn't exist
- The Lambda function doesn't have permissions to access the bucket
- Environment variables are not properly configured

**Solutions:**

#### 1. Verify CDK Deployment
```bash
# Check if the stack was deployed successfully
npx cdk list
npx cdk diff

# If not deployed, deploy it
npm run cdk
```

#### 2. Check Bucket Existence
```bash
# Replace with your account ID and region
aws s3 ls s3://titanic-glue-tables-{ACCOUNT-ID}-{REGION}/
```

#### 3. Verify Environment Variables
Check the Lambda function's environment variables in the AWS Console:
- `GLUE_TABLES_BUCKET_ARN` should be set to `titanic-glue-tables-{ACCOUNT-ID}-{REGION}`
- `S3_TABLES_BUCKET_ARN` should be set to `titanic-s3-tables-{ACCOUNT-ID}-{REGION}`
- `ATHENA_RESULTS_BUCKET` should be set to the same as `GLUE_TABLES_BUCKET_ARN`

#### 4. Check IAM Permissions
The Lambda execution role should have:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:GetBucketLocation"
            ],
            "Resource": [
                "arn:aws:s3:::titanic-glue-tables-{ACCOUNT-ID}-{REGION}",
                "arn:aws:s3:::titanic-glue-tables-{ACCOUNT-ID}-{REGION}/*"
            ]
        }
    ]
}
```

#### 5. Manual Bucket Creation (Last Resort)
If the CDK deployment failed to create the bucket:
```bash
# Replace with your account ID and region
aws s3 mb s3://titanic-glue-tables-{ACCOUNT-ID}-{REGION}
```

### 2. Table Access Permission Errors

**Error Message:**
```
AccessDenied: User is not authorized
```

**Solution:**
0. Ensure you have properly set the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
1. Verify the `QUILT_READ_POLICY_ARN` environment variable is set correctly
2. Ensure the Lambda execution role has the proper Glue permissions
3. Check that the source database exists and is accessible

### 3. Missing Environment Variables

**Error Message:**
```
Missing required environment variables: GLUE_DATABASE_NAME, S3TABLE_DATABASE_NAME, GLUE_TABLES_BUCKET_ARN, or S3_TABLES_BUCKET_ARN
```

**Solution:**
Ensure all required environment variables are set before deployment:
```bash
export QUILT_DATABASE_NAME=your_database_name
export CDK_DEFAULT_ACCOUNT=your_aws_account_id
export CDK_DEFAULT_REGION=your_aws_region
npm run cdk
```

### 4. Table Mode Configuration Issues

**Problem:** Wrong table format being used

**Solution:**
- For Glue tables: `export USE_S3_TABLE=false` (default)
- For S3 Tables: `export USE_S3_TABLE=true`

Re-deploy after changing:
```bash
npm run cdk
```

## Diagnostic Commands

### Check CDK Stack Status
```bash
npx cdk list
npx cdk diff
```

### Verify S3 Buckets
```bash
# List all buckets
aws s3 ls | grep titanic

# Check specific bucket
aws s3 ls s3://titanic-glue-tables-{ACCOUNT-ID}-{REGION}/
```

### Check Lambda Function
```bash
# Get function configuration
aws lambda get-function-configuration --function-name TitanicStack-TitanicMergeTables
```

### Verify Glue Database
```bash
aws glue get-database --name your_database_name
aws glue get-tables --database-name your_database_name
```

### Check Lambda Logs
```bash
# View recent logs
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/TitanicStack-TitanicMergeTables
aws logs tail /aws/lambda/TitanicStack-TitanicMergeTables --follow
```

## Environment Variable Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `QUILT_DATABASE_NAME` | Yes | Source database name | `userathenadatabase-6fosfzznfasm` |
| `GLUE_TABLES_BUCKET_ARN` | Yes | S3 bucket for Glue tables and Athena results | `titanic-glue-tables-712023778557-us-east-2` |
| `S3_TABLES_BUCKET_ARN` | Yes | S3 Tables bucket for S3 table format | `titanic-s3-tables-712023778557-us-east-2` |
| `USE_S3_TABLE` | No | Table format selection | `false` (default) or `true` |
| `QUILT_READ_POLICY_ARN` | Yes | IAM policy for source bucket access | `arn:aws:iam::account:policy/policy-name` |

## Contact and Support

If these solutions don't resolve your issue:
1. Check the CloudWatch logs for more detailed error messages
2. Verify all AWS resources exist in the correct region
3. Ensure your AWS credentials have sufficient permissions
4. Consider redeploying the entire CDK stack
