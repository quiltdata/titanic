#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/cdk.out"
ARTIFACTS_DIR="$PROJECT_ROOT/artifacts"

# Default values
VERSION="${VERSION:-$(date +%Y%m%d-%H%M%S)}"
INCLUDE_TERRAFORM="true"
INCLUDE_CLOUDFORMATION="true"

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Usage information
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Package standalone deployment artifacts for Titanic ML Pipeline.

Optional Arguments:
    --version VERSION           Artifact version (default: timestamp)
    --no-terraform             Skip Terraform artifacts
    --no-cloudformation        Skip CloudFormation artifacts
    --help                     Show this help message

Examples:
    # Build all artifacts with timestamp version
    $0

    # Build with custom version
    $0 --version v1.0.0

    # Build CloudFormation artifacts only
    $0 --no-terraform

    # Build Terraform artifacts only
    $0 --no-cloudformation
EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --version)
                VERSION="$2"
                shift 2
                ;;
            --no-terraform)
                INCLUDE_TERRAFORM="false"
                shift
                ;;
            --no-cloudformation)
                INCLUDE_CLOUDFORMATION="false"
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
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Node.js and npm
    if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
        log_error "Node.js and npm are required but not installed"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# Build Lambda function
build_lambda() {
    log_info "Building Lambda function..."

    # Use CDK to build the Lambda function (this handles TypeScript compilation)
    log_info "Using CDK to compile TypeScript Lambda function..."
    cd "$PROJECT_ROOT"
    
    # Generate CDK output which includes compiled Lambda
    npx cdk synth --quiet
    
    # Find the compiled Lambda assets in cdk.out
    local lambda_asset_dir=$(find cdk.out -name "*.zip" -path "*/asset.*" | head -1 | xargs dirname)
    
    if [[ -n "$lambda_asset_dir" && -f "$lambda_asset_dir/index.js" ]]; then
        log_info "Copying compiled Lambda code from CDK assets..."
        
        # Ensure lambda directory exists in cdk.out
        mkdir -p "$BUILD_DIR/lambda"
        cd "$lambda_asset_dir"
        zip -r "$BUILD_DIR/lambda/package.zip" . -x "*.zip"
        cd "$PROJECT_ROOT"
        
        log_success "Lambda package created: $BUILD_DIR/lambda/package.zip"
    else
        log_error "Could not find compiled Lambda assets from CDK"
        log_info "Falling back to source-only package for development..."
        
        # Create a source-only package (TypeScript files)
        mkdir -p "$BUILD_DIR/lambda"
        cd "$BUILD_DIR/lambda"
        
        cp -r "$PROJECT_ROOT/lib" ./ 2>/dev/null || true
        cp "$PROJECT_ROOT/package.json" ./
        cp "$PROJECT_ROOT/tsconfig.json" ./ 2>/dev/null || true
        
        # Install all dependencies (including dev dependencies for TypeScript compilation)
        npm install --silent
        
        # Create ZIP package with source code
        zip -r package.zip lib/ node_modules/ package.json tsconfig.json -x "node_modules/.cache/*"
        
        # Clean up temporary files
        rm -rf lib/ node_modules/ package.json tsconfig.json
        cd "$PROJECT_ROOT"
        
        log_warn "Created source-only Lambda package - deployment environment must handle TypeScript compilation"
    fi
}

# Create CloudFormation artifacts
create_cloudformation_artifacts() {
    log_info "Creating CloudFormation artifacts..."

    local cf_dir="$ARTIFACTS_DIR/cloudformation-$VERSION"
    mkdir -p "$cf_dir"

    # Generate CloudFormation template using the template generator
    log_info "Generating CloudFormation template..."
    "$SCRIPT_DIR/generate-templates.sh" --type cloudformation --output-dir "$cf_dir"

    # Copy the generated template.yaml to the expected location
    if [[ -f "$cf_dir/template.yaml" ]]; then
        log_success "CloudFormation template generated successfully"
    else
        log_error "Failed to generate CloudFormation template"
        exit 1
    fi

    # Copy Lambda package
    cp "$BUILD_DIR/lambda/package.zip" "$cf_dir/lambda-package.zip"

    # Copy deployment script from bin directory
    cp "$SCRIPT_DIR/deploy-cloudformation.sh" "$cf_dir/deploy.sh"
    chmod +x "$cf_dir/deploy.sh"

    # Create README
    cat > "$cf_dir/README.md" << EOF
# Titanic ML Pipeline - CloudFormation Deployment

This package contains standalone CloudFormation templates for deploying the Titanic ML Pipeline.

## Contents

- \`template.yaml\` - CloudFormation template
- \`lambda-package.zip\` - Lambda function code
- \`deploy.sh\` - Deployment script
- \`README.md\` - This file

## Quick Start

\`\`\`bash
# Deploy with defaults
./deploy.sh

# Deploy with custom settings
./deploy.sh --stack-name my-titanic --use-s3-tables
\`\`\`

## Manual Deployment

\`\`\`bash
aws cloudformation deploy \\
    --template-file template.yaml \\
    --stack-name titanic-ml-pipeline \\
    --capabilities CAPABILITY_NAMED_IAM \\
    --parameter-overrides UseS3Tables=false
\`\`\`

## Parameters

- \`UseS3Tables\` - Enable S3 Tables instead of Glue Tables (default: false)
- \`GlueDatabaseName\` - Source Glue database name (default: titanic-glue-db)
- \`S3TableDatabaseName\` - Target S3 Tables database name (default: titanic-s3table-db)
- \`QuiltCatalogDomain\` - Quilt catalog domain (default: stable.quilttest.com)

## Version

**Version:** $VERSION  
**Created:** $(date)
EOF

    log_success "CloudFormation artifacts created in: $cf_dir"
}

# Create Terraform artifacts
create_terraform_artifacts() {
    log_info "Creating Terraform artifacts..."

    local tf_dir="$ARTIFACTS_DIR/terraform-$VERSION"
    mkdir -p "$tf_dir"

    # Generate Terraform templates using the template generator
    log_info "Generating Terraform templates..."
    "$SCRIPT_DIR/generate-templates.sh" --type terraform --output-dir "$tf_dir"

    # Verify templates were generated
    if [[ -f "$tf_dir/main.tf" ]]; then
        log_success "Terraform templates generated successfully"
    else
        log_error "Failed to generate Terraform templates"
        exit 1
    fi

    # Copy Lambda package
    cp "$BUILD_DIR/lambda/package.zip" "$tf_dir/lambda-package.zip"

    # Copy deployment script from bin directory
    cp "$SCRIPT_DIR/deploy-terraform.sh" "$tf_dir/deploy.sh"
    chmod +x "$tf_dir/deploy.sh"

    # Create README
    cat > "$tf_dir/README.md" << EOF
# Titanic ML Pipeline - Terraform Deployment

This package contains standalone Terraform templates for deploying the Titanic ML Pipeline.

## Contents

- \`main.tf\` - Main Terraform configuration
- \`variables.tf\` - Input variables
- \`outputs.tf\` - Output values
- \`lambda-package.zip\` - Lambda function code
- \`deploy.sh\` - Deployment script
- \`README.md\` - This file

## Quick Start

\`\`\`bash
# Deploy with defaults
./deploy.sh

# Deploy with custom settings
./deploy.sh --stack-name my-titanic --use-s3-tables --auto-approve

# Destroy infrastructure
./deploy.sh destroy --auto-approve
\`\`\`

## Manual Deployment

\`\`\`bash
# Initialize
terraform init

# Plan and apply
terraform plan
terraform apply

# Destroy
terraform destroy
\`\`\`

## Variables

- \`stack_name\` - Resource name prefix (default: titanic-ml-pipeline)
- \`aws_region\` - AWS region (default: us-east-2)
- \`use_s3_tables\` - Enable S3 Tables instead of Glue Tables (default: false)
- \`glue_database_name\` - Source Glue database name (default: titanic-glue-db)
- \`s3table_database_name\` - Target S3 Tables database name (default: titanic-s3table-db)
- \`quilt_catalog_domain\` - Quilt catalog domain (default: stable.quilttest.com)

## Version

**Version:** $VERSION  
**Created:** $(date)
EOF

    log_success "Terraform artifacts created in: $tf_dir"
}

# Create summary report
create_summary() {
    log_info "Creating deployment summary..."

    cat > "$ARTIFACTS_DIR/deployment-summary-$VERSION.md" << EOF
# Titanic ML Pipeline - Deployment Artifacts Summary

**Version:** $VERSION  
**Created:** $(date)  
**Build Host:** $(hostname)

## Available Artifacts

$(if [[ "$INCLUDE_CLOUDFORMATION" == "true" ]]; then
    echo "### CloudFormation"
    echo "- **Directory:** \`cloudformation-$VERSION/\`"
    echo "- **Quick Deploy:** \`./cloudformation-$VERSION/deploy.sh\`"
    echo ""
fi)

$(if [[ "$INCLUDE_TERRAFORM" == "true" ]]; then
    echo "### Terraform"
    echo "- **Directory:** \`terraform-$VERSION/\`"
    echo "- **Quick Deploy:** \`./terraform-$VERSION/deploy.sh\`"
    echo ""
fi)

## For End Users

### CloudFormation Users
1. Navigate to the \`cloudformation-$VERSION/\` directory
2. Run \`./deploy.sh\` for guided deployment
3. Or use AWS CLI: \`aws cloudformation deploy --template-file template.yaml --stack-name my-stack --capabilities CAPABILITY_NAMED_IAM\`

### Terraform Users  
1. Navigate to the \`terraform-$VERSION/\` directory
2. Run \`./deploy.sh\` for guided deployment
3. Or use Terraform CLI: \`terraform init && terraform apply\`

## Architecture

- **Lambda Function**: Handles table merging operations
- **S3 Buckets**: Data storage and query results
- **IAM Roles**: Secure access controls
- **Athena WorkGroup**: Query execution environment
- **Glue/S3 Tables**: Data catalog (configurable)

Built from commit: \$(git rev-parse HEAD 2>/dev/null || echo "unknown")
EOF

    log_success "Deployment summary created: $ARTIFACTS_DIR/deployment-summary-$VERSION.md"
}

# Main function
main() {
    parse_args "$@"
    
    log_info "Packaging Titanic ML Pipeline Standalone Artifacts"
    log_info "Version: $VERSION"
    log_info "Include CloudFormation: $INCLUDE_CLOUDFORMATION"
    log_info "Include Terraform: $INCLUDE_TERRAFORM"
    
    check_prerequisites
    
    # Clean and create artifacts directory
    rm -rf "$ARTIFACTS_DIR"
    mkdir -p "$ARTIFACTS_DIR"
    
    # Build Lambda package (needed by template generator)
    build_lambda
    
    if [[ "$INCLUDE_CLOUDFORMATION" == "true" ]]; then
        create_cloudformation_artifacts
    fi
    
    if [[ "$INCLUDE_TERRAFORM" == "true" ]]; then
        create_terraform_artifacts
    fi
    
    create_summary
    
    log_success "Standalone artifacts created successfully!"
    log_info "Artifacts location: $ARTIFACTS_DIR"
    
    # Show directory structure
    log_info "Directory structure:"
    tree "$ARTIFACTS_DIR" 2>/dev/null || find "$ARTIFACTS_DIR" -type f | head -20
}

# Run main function with all arguments
main "$@"
