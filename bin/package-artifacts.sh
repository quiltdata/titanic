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
TEMPLATES_DIR="$PROJECT_ROOT/templates"
DIST_DIR="$PROJECT_ROOT/dist"
ARTIFACTS_DIR="$PROJECT_ROOT/artifacts"

# Default values
VERSION="${VERSION:-$(date +%Y%m%d-%H%M%S)}"
INCLUDE_TERRAFORM="true"
INCLUDE_CLOUDFORMATION="true"
CREATE_ZIP="true"

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
    --no-zip                   Don't create ZIP archives
    --help                     Show this help message

Examples:
    # Build all artifacts with timestamp version
    $0

    # Build with custom version
    $0 --version v1.0.0

    # Skip ZIP creation
    $0 --no-zip
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
            --no-zip)
                CREATE_ZIP="false"
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

    # Clean and create dist directory
    rm -rf "$DIST_DIR"
    mkdir -p "$DIST_DIR"

    # Build TypeScript
    log_info "Compiling TypeScript..."
    npm run build

    # Create Lambda package
    log_info "Creating Lambda package..."
    cd "$DIST_DIR"
    
    # Copy built files
    cp -r lib/* .
    
    # Install production dependencies
    cp "$PROJECT_ROOT/package.json" .
    npm install --production --silent
    
    # Create ZIP package
    zip -r lambda-package.zip . -x "*.zip"
    
    cd "$PROJECT_ROOT"
    log_success "Lambda package created: $DIST_DIR/lambda-package.zip"
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
    cp "$DIST_DIR/lambda-package.zip" "$cf_dir/"

    # Create deployment script
    cat > "$cf_dir/deploy.sh" << 'EOF'
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
EOF

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
    cp "$DIST_DIR/lambda-package.zip" "$tf_dir/"

    # Create deployment script
    cat > "$tf_dir/deploy.sh" << 'EOF'
#!/bin/bash

set -euo pipefail

# Default values
STACK_NAME="titanic-ml-pipeline"
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-2}"
USE_S3_TABLES="${USE_S3_TABLES:-false}"
GLUE_DB="${GLUE_DATABASE_NAME:-titanic-glue-db}"
S3TABLE_DB="${S3TABLE_DATABASE_NAME:-titanic-s3table-db}"
QUILT_DOMAIN="${QUILT_CATALOG_DOMAIN:-stable.quilttest.com}"
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

Optional Arguments:
    --stack-name NAME          Resource name prefix (default: $STACK_NAME)
    --region REGION            AWS region (default: $AWS_REGION)
    --use-s3-tables            Enable S3 Tables instead of Glue Tables
    --glue-db NAME             Glue database name (default: $GLUE_DB)
    --s3table-db NAME          S3 Tables database name (default: $S3TABLE_DB)
    --quilt-domain DOMAIN      Quilt catalog domain (default: $QUILT_DOMAIN)
    --auto-approve             Skip interactive approval
    --help                     Show this help message

Examples:
    # Deploy with defaults
    $0

    # Deploy with custom settings
    $0 --stack-name my-titanic --use-s3-tables --auto-approve

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
EOF

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

# Create ZIP archives
create_zip_archives() {
    if [[ "$CREATE_ZIP" == "false" ]]; then
        return
    fi

    log_info "Creating ZIP archives..."

    cd "$ARTIFACTS_DIR"

    if [[ "$INCLUDE_CLOUDFORMATION" == "true" ]]; then
        log_info "Creating CloudFormation ZIP archive..."
        zip -r "titanic-cloudformation-$VERSION.zip" "cloudformation-$VERSION/"
        log_success "Created: titanic-cloudformation-$VERSION.zip"
    fi

    if [[ "$INCLUDE_TERRAFORM" == "true" ]]; then
        log_info "Creating Terraform ZIP archive..."
        zip -r "titanic-terraform-$VERSION.zip" "terraform-$VERSION/"
        log_success "Created: titanic-terraform-$VERSION.zip"
    fi

    cd "$PROJECT_ROOT"
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
    echo "- **ZIP Archive:** \`titanic-cloudformation-$VERSION.zip\`"
    echo ""
fi)

$(if [[ "$INCLUDE_TERRAFORM" == "true" ]]; then
    echo "### Terraform"
    echo "- **Directory:** \`terraform-$VERSION/\`"
    echo "- **Quick Deploy:** \`./terraform-$VERSION/deploy.sh\`"
    echo "- **ZIP Archive:** \`titanic-terraform-$VERSION.zip\`"
    echo ""
fi)

## For End Users

### CloudFormation Users
1. Download and extract \`titanic-cloudformation-$VERSION.zip\`
2. Run \`./deploy.sh\` for guided deployment
3. Or use AWS CLI: \`aws cloudformation deploy --template-file template.yaml --stack-name my-stack --capabilities CAPABILITY_NAMED_IAM\`

### Terraform Users  
1. Download and extract \`titanic-terraform-$VERSION.zip\`
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
    log_info "Create ZIP archives: $CREATE_ZIP"
    
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
    
    create_zip_archives
    create_summary
    
    log_success "Standalone artifacts created successfully!"
    log_info "Artifacts location: $ARTIFACTS_DIR"
    
    # Show directory structure
    log_info "Directory structure:"
    tree "$ARTIFACTS_DIR" 2>/dev/null || find "$ARTIFACTS_DIR" -type f | head -20
}

# Run main function with all arguments
main "$@"
