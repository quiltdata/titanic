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

For repeated deployments, you can use environment variables (as in example.env) instead of CLI parameters:

| Description             | Default      | CLI Parameter              | Env Variable           |
|-------------------------|--------------|----------------------------|------------------------|
| Athena DB name          | (required)   | `--athena-database-name`   | `ATHENA_DATABASE_NAME` |
| Quilt read policy ARN   | (required)   | `--quilt-read-policy-arn`  | `QUILT_READ_POLICY_ARN`|
| AWS region              | `us-east-1`  | `--aws-region`             | `AWS_DEFAULT_REGION`   |
| AWS profile             | `default`    | `--aws-profile`            | `AWS_PROFILE`          |

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
