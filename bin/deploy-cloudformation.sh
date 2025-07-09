#!/bin/bash

set -euo pipefail

# Default values
STACK_NAME="titanic-ml-pipeline"
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-2}"
USE_S3_TABLES="${USE_S3_TABLES:-false}"
GLUE_DB="${GLUE_DATABASE_NAME:-titanic-glue-db}"
S3TABLE_DB="${S3TABLE_DATABASE_NAME:-titanic-s3table-db}"
QUILT_DOMAIN="${QUILT_CATALOG_DOMAIN:-stable.quilttest.com}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy Titanic ML Pipeline using CloudFormation.

Optional Arguments:
    --stack-name NAME          CloudFormation stack name (default: $STACK_NAME)
    --region REGION            AWS region (default: $AWS_REGION)
    --use-s3-tables            Enable S3 Tables instead of Glue Tables
    --glue-db NAME             Glue database name (default: $GLUE_DB)
    --s3table-db NAME          S3 Tables database name (default: $S3TABLE_DB)
    --quilt-domain DOMAIN      Quilt catalog domain (default: $QUILT_DOMAIN)
    --help                     Show this help message

Examples:
    # Deploy with defaults
    $0

    # Deploy with custom stack name and region
    $0 --stack-name my-titanic --region us-west-2

    # Deploy with S3 Tables enabled
    $0 --use-s3-tables --s3table-db my-s3table-db
EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --use-s3-tables)
            USE_S3_TABLES="true"
            shift
            ;;
        --glue-db)
            GLUE_DB="$2"
            shift 2
            ;;
        --s3table-db)
            S3TABLE_DB="$2"
            shift 2
            ;;
        --quilt-domain)
            QUILT_DOMAIN="$2"
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

log_info "Deploying CloudFormation stack: $STACK_NAME"
log_info "Region: $AWS_REGION"
log_info "Use S3 Tables: $USE_S3_TABLES"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is required but not installed"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS credentials not configured. Run 'aws configure' first"
    exit 1
fi

# Deploy CloudFormation stack
aws cloudformation deploy \
    --template-file template.yaml \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
        UseS3Tables="$USE_S3_TABLES" \
        GlueDatabaseName="$GLUE_DB" \
        S3TableDatabaseName="$S3TABLE_DB" \
        QuiltCatalogDomain="$QUILT_DOMAIN"

log_success "CloudFormation deployment completed!"

# Show stack outputs
log_info "Stack outputs:"
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs' \
    --output table

log_info "To update Lambda function code:"
log_info "aws lambda update-function-code --function-name \${FUNCTION_NAME} --zip-file fileb://lambda-package.zip"
