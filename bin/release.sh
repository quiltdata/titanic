#!/bin/bash

# Titanic Stack Release Package Generator
# This script generates a standalone deployment package from CDK code

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
BASE_DIST_DIR="dist"
RELEASE_SUBDIR="release"
ARTIFACTS_DIR="artifacts"
VERSION=""
VERIFY_ASSETS_ONLY=false
VERIFY_ASSETS_WARN=false

# Global variables
ASSETS_BUCKET=""
RELEASE_DIR=""
ARCHIVE_DIR=""
CDK_VERSION=""

# Initialize environment and load configuration
initialize_environment() {
    # Auto-load .env file if it exists
    if [[ -f ".env" ]]; then
        echo -e "${YELLOW}Loading environment variables from .env file...${NC}"
        set -a  # automatically export all variables
        source .env
        set +a  # stop automatically exporting
        echo -e "${GREEN}✅ Environment variables loaded from .env${NC}"
    fi

    # Validate required environment variables
    if [[ -z "$CDK_DEFAULT_ACCOUNT" ]]; then
        echo -e "${RED}❌ Error: CDK_DEFAULT_ACCOUNT environment variable is required${NC}" >&2
        echo -e "${RED}   Please set CDK_DEFAULT_ACCOUNT to your AWS account ID${NC}" >&2
        exit 1
    fi

    if [[ -z "$CDK_DEFAULT_REGION" ]]; then
        echo -e "${RED}❌ Error: CDK_DEFAULT_REGION environment variable is required${NC}" >&2
        echo -e "${RED}   Please set CDK_DEFAULT_REGION to your target AWS region${NC}" >&2
        exit 1
    fi

    # Construct the assets bucket name using the standard pattern
    ASSETS_BUCKET="titanic-assets-${CDK_DEFAULT_ACCOUNT}-${CDK_DEFAULT_REGION}"
    echo -e "${GREEN}✅ Constructed assets bucket name: ${ASSETS_BUCKET}${NC}"

    # Get CDK version
    CDK_VERSION=$(npx cdk --version 2>/dev/null || echo "N/A")
    CDK_STATUS=$?
    if [[ $CDK_STATUS -ne 0 ]]; then
        echo -e "${YELLOW}Warning: Failed to get CDK version${NC}" >&2
        CDK_VERSION="N/A"
    fi
    
    echo -e "${BLUE}[initialize_environment] Environment initialized - Assets bucket: ${ASSETS_BUCKET}, CDK version: ${CDK_VERSION}${NC}"
}

# Display help information
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Generate a standalone deployment package for the Titanic Stack.
This creates a self-contained package with CloudFormation template, Lambda assets, and deployment script.

OPTIONS:
    -h, --help                      Show this help message
    -v, --version VERSION           Version tag for the release (e.g., v1.0.0)
    --verify-assets-only           Only verify assets exist, skip release generation
    --verify-assets-warn           Verify assets exist but warn instead of exit if missing

DIRECTORY STRUCTURE:
    dist/
    ├── release-v1.0.0/            # Release package directory
    │   ├── template.json
    │   ├── deploy.sh
    │   └── assets/
    └── artifacts/                  # Compressed archives
        ├── release-v1.0.0.tar.gz
        └── release-v1.0.0.zip

EXAMPLES:
    # Generate release package (requires CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION)
    CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=us-east-1 $0

    # Generate with version tag
    CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=us-east-1 $0 --version v1.2.0

    # Verify assets are available (no release generation)
    CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=us-east-1 $0 --verify-assets-only

    # Verify assets with warnings only (continue with release even if missing)
    CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=us-east-1 $0 --verify-assets-warn

ENVIRONMENT VARIABLES:
    CDK_DEFAULT_ACCOUNT     AWS Account ID (required)
    CDK_DEFAULT_REGION      AWS Region (required)

ASSETS BUCKET:
    The script constructs the assets bucket name using the standard CDK pattern:
    cdk-hnb659fds-assets-{ACCOUNT}-{REGION}

WORKFLOW:
    1. Cleans output directory and validates environment
    2. Verifies Lambda assets in S3
    3. Synthesizes and validates CloudFormation template
    4. Archives template, scripts, config, and assets to release artifacts

EOF
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--version)
                VERSION="$2"
                shift 2
                ;;
            --verify-assets-only)
                VERIFY_ASSETS_ONLY=true
                shift
                ;;
            --verify-assets-warn)
                VERIFY_ASSETS_WARN=true
                shift
                ;;
            *)
                echo -e "${RED}Error: Unknown option $1${NC}"
                show_help
                exit 1
                ;;
        esac
    done
    
    echo -e "${BLUE}[parse_arguments] Parsed arguments - Version: ${VERSION:-"unset"}, Verify assets only: ${VERIFY_ASSETS_ONLY}, Verify assets warn: ${VERIFY_ASSETS_WARN}${NC}"
}

# Setup directories and validate environment
setup_directories() {
    # Construct directory paths
    if [[ -n "$VERSION" ]]; then
        RELEASE_DIR="$BASE_DIST_DIR/${RELEASE_SUBDIR}-${VERSION}"
    else
        RELEASE_DIR="$BASE_DIST_DIR/$RELEASE_SUBDIR"
    fi
    ARCHIVE_DIR="$BASE_DIST_DIR/$ARTIFACTS_DIR"

    # Clean output directory if requested
    if [[ -d "$BASE_DIST_DIR" ]]; then
        echo -e "${YELLOW}Cleaning existing dist directory: $BASE_DIST_DIR${NC}"
        rm -rf "$BASE_DIST_DIR"
    fi

    # Create dist and artifacts directories
    mkdir -p "$BASE_DIST_DIR"
    mkdir -p "$ARCHIVE_DIR"

    # Ensure we're in the project root (package.json and cdk.json are required for CDK operations)
    if [[ ! -f "package.json" || ! -f "cdk.json" ]]; then
        echo -e "${RED}Error: Must be run from the project root directory${NC}"
        echo -e "${RED}   Both package.json and cdk.json are required${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}[setup_directories] Directories configured - Release: ${RELEASE_DIR}, Archive: ${ARCHIVE_DIR}${NC}"
}

# Display configuration information
display_config() {
    echo -e "${BLUE}=== Titanic Stack Release Package Generator ===${NC}"
    echo "Base Directory: $BASE_DIST_DIR"
    echo "Release Directory: $RELEASE_DIR"
    echo "Archive Directory: $ARCHIVE_DIR"
    echo "CDK Account: $CDK_DEFAULT_ACCOUNT"
    echo "CDK Region: $CDK_DEFAULT_REGION"
    echo "Assets Bucket: $ASSETS_BUCKET"
    if [[ -n "$VERSION" ]]; then
        echo "Version: $VERSION"
    fi
    echo ""
    
    echo -e "${BLUE}[display_config] Configuration displayed - Base: ${BASE_DIST_DIR}, Release: ${RELEASE_DIR}, Assets bucket: ${ASSETS_BUCKET}${NC}"
}

# Verify Lambda assets are available in S3
verify_assets() {
    echo -e "${YELLOW}Verifying Lambda assets are available in assets bucket...${NC}"
    echo -e "${GREEN}📦 Using assets bucket: ${ASSETS_BUCKET}${NC}"
    
    local lambda_zip_path="lambda/merge-tables.zip"
    
    # Use anonymous access to check if assets exist
    echo "Checking for Lambda assets at s3://$ASSETS_BUCKET/$lambda_zip_path"
    if curl -f -s -I "https://$ASSETS_BUCKET.s3.amazonaws.com/$lambda_zip_path" > /dev/null; then
        echo -e "${GREEN}✅ Lambda assets found in public bucket${NC}"
        echo "Asset URL: https://$ASSETS_BUCKET.s3.amazonaws.com/$lambda_zip_path"
        echo -e "${BLUE}ℹ️  All deployments will use the latest available Lambda code${NC}"
    else
        echo -e "${RED}❌ Lambda assets not found in public bucket${NC}"
        echo -e "${RED}Please upload Lambda assets to s3://$ASSETS_BUCKET/$lambda_zip_path before releasing${NC}"
        echo "Expected URL: https://$ASSETS_BUCKET.s3.amazonaws.com/$lambda_zip_path"
        echo ""
        echo -e "${YELLOW}To upload assets:${NC}"
        echo "npm run deploy:upload"
        echo ""
        echo -e "${YELLOW}To upload manually:${NC}"
        echo "1. Run: npm run deploy:upload"
        
        if [[ "$VERIFY_ASSETS_WARN" == "true" ]]; then
            echo -e "${YELLOW}⚠️  Continuing with release despite missing assets...${NC}"
            echo -e "${YELLOW}⚠️  Deployments may fail without Lambda assets${NC}"
        else
            exit 1
        fi
    fi
    
    if [[ "$VERIFY_ASSETS_WARN" != "true" ]]; then
        echo -e "${GREEN}Asset verification completed successfully${NC}"
    fi
    echo ""
    
    # If only verifying assets, exit here
    if [[ "$VERIFY_ASSETS_ONLY" == "true" ]]; then
        echo -e "${GREEN}✅ Asset verification complete - assets are available for release${NC}"
        exit 0
    fi
    
    echo -e "${BLUE}[verify_assets] Asset verification completed - Bucket: ${ASSETS_BUCKET}, Assets found: $(if curl -f -s -I "https://$ASSETS_BUCKET.s3.amazonaws.com/lambda/merge-tables.zip" > /dev/null; then echo "yes"; else echo "no"; fi)${NC}"
}

# Generate and validate CloudFormation template
generate_template() {
    echo -e "${YELLOW}Synthesizing external CloudFormation template with parameters...${NC}"
    echo "Using pre-built Lambda assets from public bucket"
    if ! npm run cdk:external; then
        echo -e "${RED}Error: Failed to run CDK synthesis${NC}"
        exit 1
    fi

    # Verify cdk.out exists and has the expected files
    if [[ ! -d "cdk.out" ]]; then
        echo -e "${RED}Error: cdk.out directory not found${NC}"
        exit 1
    fi

    local stack_template="cdk.out/TitanicStack.template.json"
    if [[ ! -f "$stack_template" ]]; then
        echo -e "${RED}Error: CloudFormation template not found at $stack_template${NC}"
        exit 1
    fi

    validate_template "$stack_template"
    
    echo -e "${BLUE}[generate_template] Template generation completed - Template: ${stack_template}, CDK synthesis: successful${NC}"
}

# Validate CloudFormation template
validate_template() {
    local stack_template="$1"
    
    echo -e "${YELLOW}Validating CloudFormation template...${NC}"

    # Check if template has parameters section
    if ! grep -q '"Parameters"' "$stack_template"; then
        echo -e "${RED}Error: CloudFormation template missing Parameters section${NC}"
        exit 1
    fi

    # Check for required parameters
    local required_params=("AthenaDatabaseName" "QuiltReadPolicyArn" "UseS3Table")
    for param in "${required_params[@]}"; do
        if ! grep -q "\"$param\"" "$stack_template"; then
            echo -e "${RED}Error: Missing required parameter: $param${NC}"
            exit 1
        fi
    done

    # Check template size (CloudFormation limit is 460,800 bytes for direct upload)
    local template_size=$(wc -c < "$stack_template")
    WC_STATUS=$?
    if [[ $WC_STATUS -ne 0 ]]; then
        echo -e "${RED}Error: Failed to get template size${NC}"
        exit 1
    fi
    echo "CloudFormation template size: $template_size bytes"

    if [[ $template_size -gt 460800 ]]; then
        echo -e "${RED}Error: Template size ($template_size bytes) exceeds CloudFormation limit (460,800 bytes)${NC}"
        exit 1
    elif [[ $template_size -gt 400000 ]]; then
        echo -e "${YELLOW}⚠️  Warning: Template size is approaching CloudFormation limits${NC}"
    fi

    # Count resources and validate structure
    local resource_count=$(grep -c '"Type"' "$stack_template" 2>/dev/null || echo "0")
    GREP_STATUS=$?
    local parameter_count=$(grep -c '"Parameters"' "$stack_template" 2>/dev/null || echo "0")
    GREP2_STATUS=$?
    
    if [[ $GREP_STATUS -ne 0 || $GREP2_STATUS -ne 0 ]]; then
        echo -e "${YELLOW}Warning: Failed to count template components${NC}"
        resource_count="unknown"
        parameter_count="unknown"
    fi

    echo "Template validation results:"
    echo "- Resources: $resource_count"
    echo "- Parameters: $parameter_count"
    echo "- Size: $template_size bytes"

    echo -e "${GREEN}✅ CloudFormation template validation passed${NC}"
    
    echo -e "${BLUE}[validate_template] Template validation completed - Size: ${template_size} bytes, Resources: ${resource_count}, Parameters: ${parameter_count}${NC}"
}

# Create release package with all necessary files
create_release_package() {
    echo -e "${YELLOW}Creating release package...${NC}"
    mkdir -p "$RELEASE_DIR"

    copy_template
    copy_deployment_config
    copy_lambda_assets
    copy_scripts_and_docs

    echo -e "${GREEN}Release package created successfully!${NC}"
    echo ""
    
    echo -e "${BLUE}[create_release_package] Release package creation completed - Directory: ${RELEASE_DIR}${NC}"
}

# Copy CloudFormation template
copy_template() {
    local stack_template="cdk.out/TitanicStack.template.json"
    echo "Copying CloudFormation template..."
    cp "$stack_template" "$RELEASE_DIR/template.json"
    
    echo -e "${BLUE}[copy_template] Template copied - Source: ${stack_template}, Destination: ${RELEASE_DIR}/template.json${NC}"
}

# Copy deployment configuration
copy_deployment_config() {
    echo "Creating deployment configuration..."
    
    # Create a minimal deployment config with the current account and region
    cat > "$RELEASE_DIR/deployment-config.json" << EOF
{
  "account": "$CDK_DEFAULT_ACCOUNT",
  "region": "$CDK_DEFAULT_REGION",
  "buckets": {
    "assetsBucket": "$ASSETS_BUCKET"
  }
}
EOF
    
    echo "✅ Deployment configuration created with current environment settings"
    echo "   Account: $CDK_DEFAULT_ACCOUNT"
    echo "   Region: $CDK_DEFAULT_REGION" 
    echo "   Assets Bucket: $ASSETS_BUCKET"
    
    echo -e "${BLUE}[copy_deployment_config] Deployment config created - Account: ${CDK_DEFAULT_ACCOUNT}, Region: ${CDK_DEFAULT_REGION}, Bucket: ${ASSETS_BUCKET}${NC}"
}

# Copy Lambda assets
copy_lambda_assets() {
    echo "Skipping asset copying - using pre-built assets from assets bucket"
    echo "Lambda code will be loaded from: s3://$ASSETS_BUCKET/lambda/merge-tables.zip"
    
    echo -e "${BLUE}[copy_lambda_assets] Assets configuration completed - Using pre-built assets from bucket: ${ASSETS_BUCKET}${NC}"
}

# Copy scripts and documentation
copy_scripts_and_docs() {
    echo "Copying deployment script and documentation..."
    cp "bin/deploy.sh" "$RELEASE_DIR/"
    chmod +x "$RELEASE_DIR/deploy.sh"

    # Generating default event file
    if [[ -f "bin/send-event.sh" ]]; then
        # Generate a default event file for the release
        echo "Generating default event file..."
        bin/send-event.sh --write "$RELEASE_DIR"
    else
        echo -e "${YELLOW}Warning: bin/send-event.sh not found${NC}"
    fi

    # Copy README
    if [[ -f "bin/README.md" ]]; then
        cp "bin/README.md" "$RELEASE_DIR/"
    else
        echo -e "${YELLOW}Warning: bin/README.md not found${NC}"
    fi

    # Copy example environment file
    echo "Copying example environment file..."
    if [[ -f "env.example" ]]; then
        cp "env.example" "$RELEASE_DIR/"
    else
        echo -e "${YELLOW}Warning: env.example not found${NC}"
    fi
    
    echo -e "${BLUE}[copy_scripts_and_docs] Scripts and docs copied - Deploy script, README, and example env copied to ${RELEASE_DIR}${NC}"
}

# Create compressed archives
create_archives() {
    echo -e "${YELLOW}Creating release archives...${NC}"

    # Extract just the release directory name for the archive
    local release_name=$(basename "$RELEASE_DIR")

    # Create compressed archive in artifacts directory
    if tar -czf "$ARCHIVE_DIR/${release_name}.tar.gz" -C "$BASE_DIST_DIR" "$release_name/"; then
        echo "Created: $ARCHIVE_DIR/${release_name}.tar.gz"
    else
        echo -e "${RED}Error: Failed to create tar.gz archive${NC}"
        exit 1
    fi

    # Create zip archive for Windows users in artifacts directory
    if command -v zip >/dev/null 2>&1; then
        if (cd "$BASE_DIST_DIR" && zip -r "../$ARCHIVE_DIR/${release_name}.zip" "$release_name/"); then
            echo "Created: $ARCHIVE_DIR/${release_name}.zip"
        else
            echo -e "${RED}Error: Failed to create zip archive${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}⚠️  Warning: zip command not found, skipping .zip archive${NC}"
    fi
    
    echo -e "${BLUE}[create_archives] Archive creation completed - Created: ${ARCHIVE_DIR}/${release_name}.tar.gz$(if command -v zip >/dev/null 2>&1; then echo " and ${ARCHIVE_DIR}/${release_name}.zip"; fi)${NC}"
}

# Display final summary
display_summary() {
    local release_name=$(basename "$RELEASE_DIR")

    echo ""
    echo -e "${BLUE}Archive Details:${NC}"
    ls -lh "$ARCHIVE_DIR/${release_name}".tar.gz 2>/dev/null || true
    ls -lh "$ARCHIVE_DIR/${release_name}".zip 2>/dev/null || true
    echo ""

    # For more details about the release process, refer to the release README.
    echo -e "${BLUE}For release details, see: $RELEASE_DIR/README.md${NC}"
    echo -e "${GREEN}Release package is ready!${NC}"
    
    echo -e "${BLUE}[display_summary] Summary displayed - Release: ${release_name}, Archives in: ${ARCHIVE_DIR}${NC}"
}

# Main execution flow
main() {
    initialize_environment
    parse_arguments "$@"
    setup_directories
    display_config
    
    echo -e "${YELLOW}Running TypeScript validation and CDK synthesis...${NC}"
    verify_assets
    generate_template
    
    create_release_package
    create_archives
    display_summary
    
    echo -e "${BLUE}[main] Release process completed successfully - Package ready in: ${RELEASE_DIR}, Archives in: ${ARCHIVE_DIR}${NC}"
}

# Run main function with all arguments
main "$@"
