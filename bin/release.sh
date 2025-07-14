#!/bin/bash

# Titanic Stack Release Package Generator
# This script generates a standalone deployment package from CDK code

set -e

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

# Help function
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Generate a standalone deployment package for the Titanic Stack.
This creates a self-contained package with CloudFormation template, Lambda assets, and deployment script.

OPTIONS:
    -h, --help                      Show this help message
    -v, --version VERSION           Version tag for the release (e.g., v1.0.0)

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

# Run CDK synth to generate CloudFormation template with parameters
echo -e "${YELLOW}Synthesizing CloudFormation template with parameters...${NC}"
npm run cdk:params

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
REQUIRED_PARAMS=("GlueDatabaseName" "QuiltReadPolicyArn" "UseS3Table" "LambdaTimeout")
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

echo "Template validation results:"
echo "- Resources: $RESOURCE_COUNT"
echo "- Parameters: $PARAMETER_COUNT"
echo "- Size: $TEMPLATE_SIZE bytes"

# Validate JSON structure
if ! python3 -m json.tool "$STACK_TEMPLATE" > /dev/null 2>&1; then
    echo -e "${RED}Error: CloudFormation template is not valid JSON${NC}"
    exit 1
fi

echo -e "${GREEN}✅ CloudFormation template validation passed${NC}"

# Create release directory
echo -e "${YELLOW}Creating release package...${NC}"
mkdir -p "$RELEASE_DIR"

# Copy CloudFormation template
echo "Copying CloudFormation template..."
cp "$STACK_TEMPLATE" "$RELEASE_DIR/template.json"

# Copy Lambda assets if they exist
ASSETS_DIR="$RELEASE_DIR/assets"
if [[ -d "cdk.out" ]]; then
    # Find and copy Lambda asset directories
    asset_count=0
    for asset_dir in cdk.out/asset.*; do
        if [[ -d "$asset_dir" ]]; then
            asset_name=$(basename "$asset_dir")
            echo "Copying Lambda asset: $asset_name"
            mkdir -p "$ASSETS_DIR"
            cp -r "$asset_dir" "$ASSETS_DIR/"
            ((asset_count++))
        fi
    done
    
    if [[ $asset_count -gt 0 ]]; then
        echo "Copied $asset_count Lambda asset(s)"
    else
        echo "No Lambda assets found"
    fi
fi

# Copy deployment script
echo "Copying deployment script..."
cp "bin/deploy.sh" "$RELEASE_DIR/"
chmod +x "$RELEASE_DIR/deploy.sh"

# Copy example environment file
echo "Copying example environment file..."
if [[ -f "deploy.env.example" ]]; then
    cp "deploy.env.example" "$RELEASE_DIR/"
elif [[ -f "example.env" ]]; then
    cp "example.env" "$RELEASE_DIR/deploy.env.example"
fi

# Create release-specific README
echo "Creating README..."
cat > "$RELEASE_DIR/README.md" << EOF
# Titanic Stack Standalone Deployment Package

$(if [[ -n "$VERSION" ]]; then echo "**Version:** $VERSION"; echo ""; fi)This package contains everything needed to deploy the Titanic Stack without CDK dependencies.

## Contents

- \`template.json\` - CloudFormation template
- \`assets/\` - Lambda function code (if any)
- \`deploy.sh\` - Deployment script
- \`deploy.env.example\` - Example environment variables file
- \`README.md\` - This file

## Prerequisites

- AWS CLI configured with appropriate permissions
- \`zip\` utility (for Lambda function packaging)

## Quick Start

\`\`\`bash
# Method 1: Use .env file (recommended)
# Copy and edit the example file
cp deploy.env.example .env
# Edit .env with your values, then deploy:
./deploy.sh

# Method 2: Use command line parameters
./deploy.sh \\
  --glue-database-name your-database-name \\
  --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy

# Method 3: Deploy with all options
./deploy.sh \\
  --glue-database-name your-database-name \\
  --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy \\
  --use-s3-table true \\
  --lambda-timeout 300 \\
  --stack-name MyTitanicStack \\
  --region us-west-2

# Method 4: Use environment variables manually
export QUILT_DATABASE_NAME=your-database-name
export QUILT_READ_POLICY_ARN=arn:aws:iam::123456789012:policy/QuiltReadPolicy
./deploy.sh
\`\`\`

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| \`--glue-database-name\` | Yes | - | Name of the Glue database |
| \`--quilt-read-policy-arn\` | Yes | - | ARN of the Quilt read policy |
| \`--use-s3-table\` | No | \`false\` | Use S3 Tables format |
| \`--lambda-timeout\` | No | \`900\` | Lambda timeout in seconds |
| \`--stack-name\` | No | \`TitanicStack\` | CloudFormation stack name |
| \`--region\` | No | \`us-east-1\` | AWS region |
| \`--profile\` | No | default | AWS profile |

## Environment Variables

The deployment script automatically loads variables from:
1. \`.env\` file (if present)
2. \`deploy.env\` file (if present)

You can also set parameters using environment variables manually:

- \`QUILT_DATABASE_NAME\` - Glue database name
- \`QUILT_READ_POLICY_ARN\` - Quilt read policy ARN
- \`USE_S3_TABLE\` - Use S3 Tables format (true/false)
- \`LAMBDA_TIMEOUT\` - Lambda timeout in seconds
- \`AWS_DEFAULT_REGION\` - AWS region
- \`AWS_PROFILE\` - AWS profile

**Recommended approach:** Copy \`deploy.env.example\` to \`.env\` and edit the values.

## What the deployment does

1. **Validates parameters** - Ensures all required parameters are provided
2. **Creates S3 bucket** - For Lambda assets (if needed)
3. **Uploads Lambda code** - Packages and uploads function code
4. **Updates template** - Replaces asset references with S3 locations
5. **Deploys stack** - Uses CloudFormation directly
6. **Shows outputs** - Displays stack outputs and resource information

## Troubleshooting

### Template not found
\`\`\`
Error: CloudFormation template not found: template.json
\`\`\`
Ensure you're running the script from the release package directory.

### Missing parameters
\`\`\`
Error: Glue database name is required
\`\`\`
Provide the required parameters via command line or environment variables.

### AWS permissions
Ensure your AWS credentials have permissions for:
- CloudFormation (create/update stacks)
- S3 (create buckets, upload objects)
- IAM (create roles, policies)
- Glue (create databases, tables)
- Lambda (create functions, if applicable)

### Region-specific issues
Some resources may have region-specific requirements. Ensure you're deploying to a supported region.

## Generated Information

$(if [[ -n "$VERSION" ]]; then echo "- **Release Version:** $VERSION"; fi)- **Generated:** $(date)
- **CDK Version:** $(npx cdk --version 2>/dev/null || echo "N/A")
- **Template Size:** $(du -h "$RELEASE_DIR/template.json" 2>/dev/null | cut -f1 || echo "N/A")
$(if [[ -d "$ASSETS_DIR" ]]; then echo "- **Lambda Assets:** $(find "$ASSETS_DIR" -name "asset.*" -type d | wc -l | tr -d ' ') function(s)"; fi)

## Support

For issues with this deployment package, refer to the main project documentation or contact the development team.
EOF

# Create a deployment summary
echo "Creating deployment summary..."
cat > "$RELEASE_DIR/DEPLOYMENT_INFO.txt" << EOF
Titanic Stack Deployment Package
================================

Generated: $(date)
$(if [[ -n "$VERSION" ]]; then echo "Version: $VERSION"; fi)CDK Version: $(npx cdk --version 2>/dev/null || echo "N/A")

Files:
- template.json ($(du -h "$RELEASE_DIR/template.json" 2>/dev/null | cut -f1 || echo "N/A"))
- deploy.sh (deployment script)
- deploy.env.example (environment variables template)
- README.md (documentation)
$(if [[ -d "$ASSETS_DIR" ]]; then echo "- assets/ (Lambda function code)"; fi)

CloudFormation Template Info:
- Stack Name: TitanicStack
- Resources: $(grep -c '"Type"' "$RELEASE_DIR/template.json" 2>/dev/null || echo "N/A")
- Parameters: $(grep -c '"Parameters"' "$RELEASE_DIR/template.json" 2>/dev/null || echo "N/A")

$(if [[ -d "$ASSETS_DIR" ]]; then
echo "Lambda Assets:"
find "$ASSETS_DIR" -name "asset.*" -type d | while read asset; do
    echo "- $(basename "$asset")"
done
fi)

Quick Deploy Command:
cp deploy.env.example .env && edit .env, then: ./deploy.sh
Or: ./deploy.sh --glue-database-name YOUR_DB --quilt-read-policy-arn YOUR_POLICY_ARN
EOF

echo -e "${GREEN}Release package created successfully!${NC}"
echo ""

# Create archives
echo -e "${YELLOW}Creating release archives...${NC}"

# Extract just the release directory name for the archive
RELEASE_NAME=$(basename "$RELEASE_DIR")

# Create compressed archive in artifacts directory
tar -czf "$ARCHIVE_DIR/${RELEASE_NAME}.tar.gz" -C "$BASE_DIST_DIR" "$RELEASE_NAME/"
echo "Created: $ARCHIVE_DIR/${RELEASE_NAME}.tar.gz"

# Create zip archive for Windows users in artifacts directory
(cd "$BASE_DIST_DIR" && zip -r "../$ARCHIVE_DIR/${RELEASE_NAME}.zip" "$RELEASE_NAME/")
echo "Created: $ARCHIVE_DIR/${RELEASE_NAME}.zip"

echo ""
echo -e "${BLUE}Archive Details:${NC}"
ls -lh "$ARCHIVE_DIR/${RELEASE_NAME}".{tar.gz,zip}
echo ""

echo -e "${BLUE}Package Details:${NC}"
echo "Base Directory: $BASE_DIST_DIR/"
echo "Release Package: $RELEASE_DIR/"
echo "Template: $RELEASE_DIR/template.json"
echo "Deploy Script: $RELEASE_DIR/deploy.sh"
if [[ -d "$ASSETS_DIR" ]]; then
    asset_count=$(find "$ASSETS_DIR" -name "asset.*" -type d | wc -l | tr -d ' ')
    echo "Lambda Assets: $asset_count function(s) in $ASSETS_DIR/"
fi
echo "Archives: $ARCHIVE_DIR/"
echo ""
echo -e "${YELLOW}To deploy:${NC}"
echo "cd $RELEASE_DIR"
echo "cp deploy.env.example .env && edit .env, then:"
echo "./deploy.sh"
echo ""
echo -e "${YELLOW}Or deploy with command line parameters:${NC}"
echo "./deploy.sh --glue-database-name YOUR_DB --quilt-read-policy-arn YOUR_POLICY_ARN"
echo ""

echo -e "${YELLOW}Archives created and ready for distribution!${NC}"
echo "Location: $ARCHIVE_DIR/"
