#!/bin/bash

set -euo pipefail

# Required values that MUST be provided for production deployment
STACK_NAME="${STACK_NAME:-titanic-ml-pipeline}"
AWS_REGION="${AWS_DEFAULT_REGION:-}"
USE_S3_TABLES="${USE_S3_TABLES:-false}"
GLUE_DB="${GLUE_DATABASE_NAME:-}"

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

IMPORTANT: This script requires production values and will NOT use template defaults.
Set environment variables or use command-line arguments to specify all required values.

Required Arguments:
    --region REGION            AWS region (or set AWS_DEFAULT_REGION)

Required Environment Variables or Arguments:
    --glue-db NAME             Source Glue database name (or set GLUE_DATABASE_NAME)

Optional Arguments:
    --stack-name NAME          CloudFormation stack name (default: titanic-ml-pipeline)
    --region REGION            AWS region (default: from AWS_DEFAULT_REGION)
    --use-s3-tables            Enable S3 Tables instead of Glue Tables (default: false)
    --glue-db NAME             Glue database name (default: from GLUE_DATABASE_NAME)
    --help                     Show this help message

Environment Variables (alternative to command line):
    AWS_DEFAULT_REGION         AWS region
    GLUE_DATABASE_NAME         Source Glue database name
    USE_S3_TABLES              true/false for S3 Tables mode

Examples:
    # Deploy with command line arguments
    $0 --stack-name prod-titanic --region us-west-2 \\
       --glue-db prod-source-db

    # Deploy with environment variables
    export AWS_DEFAULT_REGION=us-west-2
    export GLUE_DATABASE_NAME=prod-source-db
    $0 --stack-name prod-titanic
EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        --lambda-bucket)
            LAMBDA_BUCKET="$2"
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

# Validate required parameters
validate_required_params() {
    local errors=()
    
    # Required parameters
    if [[ -z "$STACK_NAME" ]]; then
        errors+=("--stack-name is required")
    fi
    
    if [[ -z "$AWS_REGION" ]]; then
        errors+=("--region is required (or set AWS_DEFAULT_REGION)")
    fi
    
    # Set defaults for optional parameters if not provided
    USE_S3_TABLES="${USE_S3_TABLES:-false}"
    GLUE_DB="${GLUE_DB:-titanic-source-db}"
    
    # Validate against dummy/template defaults - MUST NOT be used in production
    local dummy_defaults=(
        "titanic-source-db"
        "titanic-lambda-deployments"
    )
    
    for dummy in "${dummy_defaults[@]}"; do
        if [[ "$GLUE_DB" == "$dummy" || "$LAMBDA_BUCKET" == "$dummy" ]]; then
            errors+=("Production deployment cannot use template default value: '$dummy'. Please specify a real production value.")
        fi
    done
    
    # Report all errors
    if [[ ${#errors[@]} -gt 0 ]]; then
        log_error "Production deployment validation failed:"
        for error in "${errors[@]}"; do
            log_error "  - $error"
        done
        echo ""
        log_error "This script requires production values and will NOT deploy with template defaults."
        log_error "Use --help for usage information."
        exit 1
    fi
}

validate_required_params

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
        LambdaCodeBucket="$LAMBDA_BUCKET"

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
