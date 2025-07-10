#!/bin/bash

set -euo pipefail

# Required values that MUST be provided for production deployment
STACK_NAME=""
AWS_REGION="${AWS_DEFAULT_REGION:-}"
USE_S3_TABLES="${USE_S3_TABLES:-}"
GLUE_DB="${GLUE_DATABASE_NAME:-}"
S3TABLE_DB="${S3TABLE_DATABASE_NAME:-}"
QUILT_DOMAIN="${QUILT_CATALOG_DOMAIN:-}"
LAMBDA_BUCKET=""
AUTO_APPROVE="false"

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

Deploy Titanic ML Pipeline using Terraform.

IMPORTANT: This script requires production values and will NOT use template defaults.
Set environment variables or use command-line arguments to specify all required values.

Required Arguments:
    --stack-name NAME          Resource name prefix
    --lambda-bucket BUCKET     S3 bucket containing Lambda deployment package

Optional Arguments:
    --region REGION            AWS region (default: from AWS_DEFAULT_REGION)
    --use-s3-tables            Enable S3 Tables instead of Glue Tables (default: false)
    --glue-db NAME             Glue database name (default: from GLUE_DATABASE_NAME)
    --s3table-db NAME          S3 Tables database name (default: from S3TABLE_DATABASE_NAME)
    --quilt-domain DOMAIN      Quilt catalog domain (default: from QUILT_CATALOG_DOMAIN)
    --auto-approve             Skip interactive approval
    --help                     Show this help message

Examples:
    # Deploy with command line arguments
    $0 --stack-name prod-titanic --lambda-bucket my-lambda-bucket \\
       --glue-db prod-source-db --quilt-domain prod.company.com

    # Deploy with auto-approve
    $0 --stack-name prod-titanic --lambda-bucket my-lambda-bucket --auto-approve

    # Destroy infrastructure  
    $0 destroy --auto-approve
EOF
}

# Parse arguments
ACTION="apply"
while [[ $# -gt 0 ]]; do
    case $1 in
        destroy)
            ACTION="destroy"
            shift
            ;;
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
        --auto-approve)
            AUTO_APPROVE="true"
            shift
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

log_info "Terraform action: $ACTION"
log_info "Stack name: $STACK_NAME"
log_info "Region: $AWS_REGION"
log_info "Use S3 Tables: $USE_S3_TABLES"

# Check Terraform
if ! command -v terraform &> /dev/null; then
    log_error "Terraform is required but not installed"
    exit 1
fi

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

# Initialize Terraform
log_info "Initializing Terraform..."
terraform init

# Create terraform.tfvars
cat > terraform.tfvars << TFVARS
stack_name = "$STACK_NAME"
aws_region = "$AWS_REGION"
use_s3_tables = $USE_S3_TABLES
glue_database_name = "$GLUE_DB"
s3table_database_name = "$S3TABLE_DB"
quilt_catalog_domain = "$QUILT_DOMAIN"
TFVARS

if [[ "$ACTION" == "apply" ]]; then
    # Plan and apply
    log_info "Planning Terraform deployment..."
    terraform plan
    
    if [[ "$AUTO_APPROVE" == "true" ]]; then
        log_info "Applying Terraform configuration..."
        terraform apply -auto-approve
    else
        log_info "Applying Terraform configuration..."
        terraform apply
    fi
    
    log_success "Terraform deployment completed!"
    
    # Show outputs
    log_info "Terraform outputs:"
    terraform output
    
elif [[ "$ACTION" == "destroy" ]]; then
    # Destroy
    log_info "Planning Terraform destruction..."
    terraform plan -destroy
    
    if [[ "$AUTO_APPROVE" == "true" ]]; then
        log_info "Destroying Terraform infrastructure..."
        terraform destroy -auto-approve
    else
        log_info "Destroying Terraform infrastructure..."
        terraform destroy
    fi
    
    log_success "Terraform destruction completed!"
fi
