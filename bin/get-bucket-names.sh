#!/bin/bash

# Utility script to get bucket names for the current AWS account/region
# This is used by other scripts to get deterministic bucket names

# Get current AWS account and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
AWS_REGION=${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-1")}

if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo "Error: Could not determine AWS account ID. Make sure AWS CLI is configured." >&2
    exit 1
fi

# Generate bucket names using the same pattern as the CDK stack
GLUE_TABLES_BUCKET="titanic-glue-tables-${AWS_ACCOUNT_ID}-${AWS_REGION}"
S3_TABLES_BUCKET="titanic-s3-tables-${AWS_ACCOUNT_ID}-${AWS_REGION}"
ASSETS_BUCKET="titanic-assets-${AWS_ACCOUNT_ID}-${AWS_REGION}"

# Function to get a specific bucket name
get_bucket_name() {
    case "$1" in
        "glue"|"glue-tables")
            echo "$GLUE_TABLES_BUCKET"
            ;;
        "s3"|"s3-tables")
            echo "$S3_TABLES_BUCKET"
            ;;
        "assets")
            echo "$ASSETS_BUCKET"
            ;;
        *)
            echo "Usage: get_bucket_name [glue|s3|assets]" >&2
            echo "Available buckets:" >&2
            echo "  glue-tables: $GLUE_TABLES_BUCKET" >&2
            echo "  s3-tables: $S3_TABLES_BUCKET" >&2
            echo "  assets: $ASSETS_BUCKET" >&2
            exit 1
            ;;
    esac
}

# If called with arguments, return specific bucket name
if [ $# -gt 0 ]; then
    get_bucket_name "$1"
else
    # If called without arguments, return all bucket names as JSON
    cat << EOF
{
  "account": "$AWS_ACCOUNT_ID",
  "region": "$AWS_REGION",
  "buckets": {
    "glueTablesBucket": "$GLUE_TABLES_BUCKET",
    "s3TablesBucket": "$S3_TABLES_BUCKET",
    "assetsBucket": "$ASSETS_BUCKET"
  }
}
EOF
fi
