#!/bin/bash

# Titanic Stack Release Package Generator
# This script generates a standalone deployment package from CDK code

set -ex

# Auto-load .env file if it exists
if [[ -f ".env" ]]; then
    echo -e "${YELLOW}Loading environment variables from .env file...${NC}"
    set -a  # automatically export all variables
    source .env
    set +a  # stop automatically exporting
    echo -e "${GREEN}✅ Environment variables loaded from .env${NC}"
fi

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
USE_PREBUILT_ASSETS=false

# Help function
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Generate a standalone deployment package for the Titanic Stack.
This creates a self-contained package with CloudFormation template, Lambda assets, and deployment script.

OPTIONS:
    -h, --help                      Show this help message
    -v, --version VERSION           Version tag for the release (e.g., v1.0.0)
    --use-prebuilt-assets          Use pre-built Lambda assets from public bucket

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
    # Generate release package
    $0

    # Generate with version tag
    $0 --version v1.2.0

WORKFLOW:
    1. Cleans output directory and builds TypeScript project
    2. Runs CDK synth and validates CloudFormation template
    3. Creates standalone deployment package with all assets
    4. Creates compressed archives (tar.gz and zip)

EOF
}

# Parse command line arguments
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
        --use-prebuilt-assets)
            USE_PREBUILT_ASSETS=true
            shift
            ;;
        *)
            echo -e "${RED}Error: Unknown option $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

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

# Ensure we're in the project root
if [[ ! -f "package.json" || ! -f "cdk.json" ]]; then
    echo -e "${RED}Error: Must be run from the project root directory${NC}"
    exit 1
fi

echo -e "${BLUE}=== Titanic Stack Release Package Generator ===${NC}"
echo "Base Directory: $BASE_DIST_DIR"
echo "Release Directory: $RELEASE_DIR"
echo "Archive Directory: $ARCHIVE_DIR"
if [[ -n "$VERSION" ]]; then
    echo "Version: $VERSION"
fi
echo ""

# Build the project
echo -e "${YELLOW}Running TypeScript validation and CDK synthesis...${NC}"

# Verify assets are available when using pre-built assets
if [[ "$USE_PREBUILT_ASSETS" == "true" ]]; then
    echo -e "${YELLOW}Verifying Lambda assets are available in public bucket...${NC}"
    
    ASSETS_BUCKET="quilt-titanic-assets"
    LAMBDA_ZIP_PATH="lambda/merge-tables.zip"
    
    # Use anonymous access to check if assets exist
    echo "Checking for Lambda assets at s3://$ASSETS_BUCKET/$LAMBDA_ZIP_PATH"
    if curl -f -s -I "https://$ASSETS_BUCKET.s3.amazonaws.com/$LAMBDA_ZIP_PATH" > /dev/null; then
        echo -e "${GREEN}✅ Lambda assets found in public bucket${NC}"
        echo "Asset URL: https://$ASSETS_BUCKET.s3.amazonaws.com/$LAMBDA_ZIP_PATH"
        echo -e "${BLUE}ℹ️  All deployments will use the latest available Lambda code${NC}"
    else
        echo -e "${RED}❌ Lambda assets not found in public bucket${NC}"
        echo -e "${RED}Please upload Lambda assets to s3://$ASSETS_BUCKET/$LAMBDA_ZIP_PATH before releasing${NC}"
        echo "Expected URL: https://$ASSETS_BUCKET.s3.amazonaws.com/$LAMBDA_ZIP_PATH"
        echo ""
        echo -e "${YELLOW}To upload assets manually:${NC}"
        echo "1. Build the Lambda: npm run build"
        echo "2. Bundle: zip -j lambda-merge-tables.zip lib/merge-tables.js"
        echo "3. Upload: aws s3 cp lambda-merge-tables.zip s3://$ASSETS_BUCKET/$LAMBDA_ZIP_PATH --acl public-read"
        exit 1
    fi
    
    echo -e "${GREEN}Asset verification completed successfully${NC}"
    echo ""
fi

# Run CDK synth to generate CloudFormation template with parameters
echo -e "${YELLOW}Synthesizing CloudFormation template with parameters...${NC}"
if [[ "$USE_PREBUILT_ASSETS" == "true" ]]; then
    echo "Using pre-built Lambda assets from public bucket"
    if ! npx cdk synth --app "node bin/titanic-params.js" --context usePreBuiltAssets=true; then
        echo -e "${RED}Error: Failed to run CDK synthesis with pre-built assets${NC}"
        exit 1
    fi
else
    echo "Using local Lambda bundling"
    if ! npm run cdk:params; then
        echo -e "${RED}Error: Failed to run CDK synthesis${NC}"
        exit 1
    fi
fi

# Verify cdk.out exists and has the expected files
if [[ ! -d "cdk.out" ]]; then
    echo -e "${RED}Error: cdk.out directory not found${NC}"
    exit 1
fi

STACK_TEMPLATE="cdk.out/TitanicStack.template.json"
if [[ ! -f "$STACK_TEMPLATE" ]]; then
    echo -e "${RED}Error: CloudFormation template not found at $STACK_TEMPLATE${NC}"
    exit 1
fi

# Comprehensive CloudFormation template validation
echo -e "${YELLOW}Validating CloudFormation template...${NC}"

# Check if template has parameters section
if ! grep -q '"Parameters"' "$STACK_TEMPLATE"; then
    echo -e "${RED}Error: CloudFormation template missing Parameters section${NC}"
    exit 1
fi

# Check for required parameters
REQUIRED_PARAMS=("AthenaDatabaseName" "QuiltReadPolicyArn" "UseS3Table")
for param in "${REQUIRED_PARAMS[@]}"; do
    if ! grep -q "\"$param\"" "$STACK_TEMPLATE"; then
        echo -e "${RED}Error: Missing required parameter: $param${NC}"
        exit 1
    fi
done

# Check template size (CloudFormation limit is 460,800 bytes for direct upload)
TEMPLATE_SIZE=$(wc -c < "$STACK_TEMPLATE")
echo "CloudFormation template size: $TEMPLATE_SIZE bytes"

if [[ $TEMPLATE_SIZE -gt 460800 ]]; then
    echo -e "${RED}Error: Template size ($TEMPLATE_SIZE bytes) exceeds CloudFormation limit (460,800 bytes)${NC}"
    exit 1
elif [[ $TEMPLATE_SIZE -gt 400000 ]]; then
    echo -e "${YELLOW}⚠️  Warning: Template size is approaching CloudFormation limits${NC}"
fi

# Count resources and validate structure
RESOURCE_COUNT=$(grep -c '"Type"' "$STACK_TEMPLATE" 2>/dev/null || echo "0")
PARAMETER_COUNT=$(grep -c '"Parameters"' "$STACK_TEMPLATE" 2>/dev/null || echo "0")
CDK_VERSION=$(npx cdk --version 2>/dev/null || echo "N/A")

echo "Template validation results:"
echo "- Resources: $RESOURCE_COUNT"
echo "- Parameters: $PARAMETER_COUNT"
echo "- Size: $TEMPLATE_SIZE bytes"

# Template validation complete - CloudFormation will validate JSON syntax during deployment

echo -e "${GREEN}✅ CloudFormation template validation passed${NC}"

# Create release directory
echo -e "${YELLOW}Creating release package...${NC}"
mkdir -p "$RELEASE_DIR"

# Copy CloudFormation template
echo "Copying CloudFormation template..."
cp "$STACK_TEMPLATE" "$RELEASE_DIR/template.json"

# Copy Lambda assets if they exist (only for local bundling)
ASSETS_DIR="$RELEASE_DIR/assets"
asset_count=0

if [[ "$USE_PREBUILT_ASSETS" == "true" ]]; then
    echo "Skipping asset copying - using pre-built assets from public bucket"
    echo "Lambda code will be loaded from: s3://quilt-titanic-assets/lambda/merge-tables.zip"
else
    if [[ -d "cdk.out" ]]; then
        # Check if any asset directories exist first
        if ls cdk.out/asset.* >/dev/null 2>&1; then
            echo "Found Lambda assets, creating assets directory..."
            mkdir -p "$ASSETS_DIR"
            
            for asset_dir in cdk.out/asset.*; do
                if [[ -d "$asset_dir" ]]; then
                    asset_name=$(basename "$asset_dir")
                    echo "Copying Lambda asset: $asset_name"
                    if cp -r "$asset_dir" "$ASSETS_DIR/"; then
                        asset_count=$((asset_count + 1))
                    else
                        echo -e "${RED}Error: Failed to copy asset $asset_name${NC}"
                        exit 1
                    fi
                fi
            done
            echo "Copied $asset_count Lambda asset(s)"
        else
            echo "No Lambda assets found"
        fi
    fi
fi

# Copy deployment script
echo "Copying deployment script..."
cp "bin/deploy.sh" "$RELEASE_DIR/"
chmod +x "$RELEASE_DIR/deploy.sh"

# Copy example environment file
echo "Copying example environment file..."
if [[ -f "env.example" ]]; then
    cp "env.example" "$RELEASE_DIR/"
else
    echo -e "${YELLOW}Warning: env.example not found${NC}"
fi

# Create release-specific README
echo "Creating README..."
cat > "$RELEASE_DIR/README.md" << EOF
# Titanic Stack Deployment Package

$(if [[ -n "$VERSION" ]]; then echo "**Version:** $VERSION"; echo ""; fi)Standalone deployment package for the Titanic Stack - no CDK dependencies required.

## Quick Start

\`\`\`bash
# 1. Copy and edit configuration
cp env.example .env
# Edit .env with your values

# 2. Deploy
./deploy.sh
\`\`\`

## Required Configuration

Edit \`.env\` with these required values:
- \`ATHENA_DATABASE_NAME\` - Your Athena database name
- \`QUILT_READ_POLICY_ARN\` - Your Quilt read policy ARN

## Command Line Deployment

\`\`\`bash
# Deploy with parameters (no .env file needed)
./deploy.sh --athena-database-name mydb --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy

# Deploy with S3 Tables enabled
./deploy.sh --athena-database-name mydb --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy --use-s3-table true
\`\`\`

## Optional Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| \`ATHENA_DATABASE_NAME\` | (required) | Athena database name |
| \`USE_S3_TABLE\` | \`false\` | Use S3 Tables format |
| \`AWS_DEFAULT_REGION\` | \`us-east-1\` | AWS region |
| \`AWS_PROFILE\` | default | AWS profile |

## Prerequisites

- AWS CLI configured with deployment permissions
- \`zip\` utility (for Lambda packaging)

## Troubleshooting

**Template not found**: Run from the package directory  
**Missing parameters**: Set required values in \`.env\`  
**AWS permissions**: Ensure CloudFormation, S3, IAM, Glue access  

## Package Contents

- \`template.json\` - CloudFormation template ($TEMPLATE_SIZE bytes)
- \`deploy.sh\` - Deployment script
- \`env.example\` - Configuration template
$(if [[ "$USE_PREBUILT_ASSETS" == "true" ]]; then
    echo "- Lambda code loaded from: \`s3://quilt-titanic-assets/lambda/merge-tables.zip\`"
elif [[ $asset_count -gt 0 ]]; then
    echo "- \`assets/\` - Lambda function code ($asset_count function(s))"
fi)

$(if [[ -n "$VERSION" ]]; then echo "**Release:** $VERSION | "; fi)**Generated:** $(date) | **CDK:** $CDK_VERSION
EOF

# Create a deployment summary
echo "Creating deployment summary..."
cat > "$RELEASE_DIR/DEPLOYMENT_INFO.txt" << EOF
Titanic Stack Deployment Package
================================

$(if [[ -n "$VERSION" ]]; then echo "Version: $VERSION"; fi)Generated: $(date)
CDK Version: $CDK_VERSION

Template: $TEMPLATE_SIZE bytes, $RESOURCE_COUNT resources, $PARAMETER_COUNT parameters
$(if [[ "$USE_PREBUILT_ASSETS" == "true" ]]; then
    echo "Lambda Assets: Pre-built (s3://quilt-titanic-assets/lambda/merge-tables.zip)"
elif [[ $asset_count -gt 0 ]]; then
    echo "Lambda Functions: $asset_count (bundled)"
fi)

Quick Deploy:
  cp env.example .env && edit .env
  ./deploy.sh

Command Line Deploy:
  ./deploy.sh --athena-database-name YOUR_DB --quilt-read-policy-arn YOUR_POLICY_ARN
EOF

echo -e "${GREEN}Release package created successfully!${NC}"
echo ""

# Create archives
echo -e "${YELLOW}Creating release archives...${NC}"

# Extract just the release directory name for the archive
RELEASE_NAME=$(basename "$RELEASE_DIR")

# Create compressed archive in artifacts directory
if tar -czf "$ARCHIVE_DIR/${RELEASE_NAME}.tar.gz" -C "$BASE_DIST_DIR" "$RELEASE_NAME/"; then
    echo "Created: $ARCHIVE_DIR/${RELEASE_NAME}.tar.gz"
else
    echo -e "${RED}Error: Failed to create tar.gz archive${NC}"
    exit 1
fi

# Create zip archive for Windows users in artifacts directory
if command -v zip >/dev/null 2>&1; then
    if (cd "$BASE_DIST_DIR" && zip -r "../$ARCHIVE_DIR/${RELEASE_NAME}.zip" "$RELEASE_NAME/"); then
        echo "Created: $ARCHIVE_DIR/${RELEASE_NAME}.zip"
    else
        echo -e "${RED}Error: Failed to create zip archive${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  Warning: zip command not found, skipping .zip archive${NC}"
fi

echo ""
echo -e "${BLUE}Archive Details:${NC}"
ls -lh "$ARCHIVE_DIR/${RELEASE_NAME}".tar.gz 2>/dev/null || true
ls -lh "$ARCHIVE_DIR/${RELEASE_NAME}".zip 2>/dev/null || true
echo ""

echo -e "${BLUE}Package Details:${NC}"
echo "Base Directory: $BASE_DIST_DIR/"
echo "Release Package: $RELEASE_DIR/"
echo "Template: $RELEASE_DIR/template.json"
echo "Deploy Script: $RELEASE_DIR/deploy.sh"
if [[ $asset_count -gt 0 ]]; then
    echo "Lambda Assets: $asset_count function(s) in $ASSETS_DIR/"
fi
echo "Archives: $ARCHIVE_DIR/"
echo ""
echo -e "${YELLOW}To deploy:${NC}"
echo "cd $RELEASE_DIR"
echo "cp env.example .env && edit .env, then:"
echo "./deploy.sh"
echo ""
echo -e "${YELLOW}Or deploy with command line parameters:${NC}"
echo "./deploy.sh --athena-database-name YOUR_DB --quilt-read-policy-arn YOUR_POLICY_ARN"
echo ""

echo -e "${YELLOW}Archives created and ready for distribution!${NC}"
echo "Location: $ARCHIVE_DIR/"
