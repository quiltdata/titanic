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
RELEASE_DIR="release"
VERSION=""
CLEAN=false
BUILD_ONLY=false

# Help function
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Generate a standalone deployment package for the Titanic Stack.
This creates a self-contained package with CloudFormation template, Lambda assets, and deployment script.

OPTIONS:
    -h, --help                      Show this help message
    -o, --output-dir DIR            Output directory for release package (default: release)
    -v, --version VERSION           Version tag for the release (e.g., v1.0.0)
    -c, --clean                     Clean output directory before generating
    -b, --build-only                Only build, don't create release package
    --no-synth                      Skip CDK synth (use existing cdk.out)

EXAMPLES:
    # Generate release package
    $0

    # Generate with version tag
    $0 --version v1.2.0

    # Clean build
    $0 --clean --output-dir release-v1.2.0

    # Build only (no package creation)
    $0 --build-only

WORKFLOW:
    1. Builds the TypeScript project
    2. Runs CDK synth with parameters to generate CloudFormation template
    3. Extracts Lambda assets from cdk.out
    4. Creates standalone deployment package with:
       - template.json (CloudFormation template with parameters)
       - assets/ (Lambda function code)
       - deploy.sh (deployment script)
       - README.md (deployment instructions)

EOF
}

# Parse command line arguments
SKIP_SYNTH=false
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -o|--output-dir)
            RELEASE_DIR="$2"
            shift 2
            ;;
        -v|--version)
            VERSION="$2"
            shift 2
            ;;
        -c|--clean)
            CLEAN=true
            shift
            ;;
        -b|--build-only)
            BUILD_ONLY=true
            shift
            ;;
        --no-synth)
            SKIP_SYNTH=true
            shift
            ;;
        *)
            echo -e "${RED}Error: Unknown option $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Add version to release directory if specified
if [[ -n "$VERSION" ]]; then
    RELEASE_DIR="${RELEASE_DIR}-${VERSION}"
fi

# Clean output directory if requested
if [[ "$CLEAN" == "true" && -d "$RELEASE_DIR" ]]; then
    echo -e "${YELLOW}Cleaning existing release directory: $RELEASE_DIR${NC}"
    rm -rf "$RELEASE_DIR"
fi

# Ensure we're in the project root
if [[ ! -f "package.json" || ! -f "cdk.json" ]]; then
    echo -e "${RED}Error: Must be run from the project root directory${NC}"
    exit 1
fi

echo -e "${BLUE}=== Titanic Stack Release Package Generator ===${NC}"
echo "Release Directory: $RELEASE_DIR"
if [[ -n "$VERSION" ]]; then
    echo "Version: $VERSION"
fi
echo ""

# Build the project
if [[ "$SKIP_SYNTH" != "true" ]]; then
    echo -e "${YELLOW}Running TypeScript validation and CDK synthesis...${NC}"
    
    # Run CDK synth to generate CloudFormation template with parameters
    echo -e "${YELLOW}Synthesizing CloudFormation template with parameters...${NC}"
    npm run cdk:params
else
    echo -e "${YELLOW}Skipping CDK synth (using existing cdk.out)...${NC}"
fi

# Verify cdk.out exists and has the expected files
if [[ ! -d "cdk.out" ]]; then
    echo -e "${RED}Error: cdk.out directory not found. Run without --no-synth${NC}"
    exit 1
fi

STACK_TEMPLATE="cdk.out/TitanicStack.template.json"
if [[ ! -f "$STACK_TEMPLATE" ]]; then
    echo -e "${RED}Error: CloudFormation template not found at $STACK_TEMPLATE${NC}"
    exit 1
fi

# Exit early if build-only
if [[ "$BUILD_ONLY" == "true" ]]; then
    echo -e "${GREEN}Build completed successfully!${NC}"
    echo "CloudFormation template: $STACK_TEMPLATE"
    exit 0
fi

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

# Create release-specific README
echo "Creating README..."
cat > "$RELEASE_DIR/README.md" << EOF
# Titanic Stack Standalone Deployment Package

$(if [[ -n "$VERSION" ]]; then echo "**Version:** $VERSION"; echo ""; fi)This package contains everything needed to deploy the Titanic Stack without CDK dependencies.

## Contents

- \`template.json\` - CloudFormation template
- \`assets/\` - Lambda function code (if any)
- \`deploy.sh\` - Deployment script
- \`README.md\` - This file

## Prerequisites

- AWS CLI configured with appropriate permissions
- \`zip\` utility (for Lambda function packaging)

## Quick Start

\`\`\`bash
# Deploy with required parameters
./deploy.sh \\
  --glue-database-name your-database-name \\
  --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy

# Deploy with all options
./deploy.sh \\
  --glue-database-name your-database-name \\
  --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy \\
  --use-s3-table true \\
  --lambda-timeout 300 \\
  --stack-name MyTitanicStack \\
  --region us-west-2

# Use environment variables
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

You can also set parameters using environment variables:

- \`QUILT_DATABASE_NAME\` - Glue database name
- \`QUILT_READ_POLICY_ARN\` - Quilt read policy ARN
- \`AWS_DEFAULT_REGION\` - AWS region

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
./deploy.sh --glue-database-name YOUR_DB --quilt-read-policy-arn YOUR_POLICY_ARN
EOF

echo -e "${GREEN}Release package created successfully!${NC}"
echo ""
echo -e "${BLUE}Package Details:${NC}"
echo "Location: $RELEASE_DIR/"
echo "Template: $RELEASE_DIR/template.json"
echo "Deploy Script: $RELEASE_DIR/deploy.sh"
if [[ -d "$ASSETS_DIR" ]]; then
    asset_count=$(find "$ASSETS_DIR" -name "asset.*" -type d | wc -l | tr -d ' ')
    echo "Lambda Assets: $asset_count function(s) in $ASSETS_DIR/"
fi
echo ""
echo -e "${YELLOW}To deploy:${NC}"
echo "cd $RELEASE_DIR"
echo "./deploy.sh --glue-database-name YOUR_DB --quilt-read-policy-arn YOUR_POLICY_ARN"
echo ""
echo -e "${YELLOW}To create a distributable archive:${NC}"
echo "tar -czf ${RELEASE_DIR}.tar.gz $RELEASE_DIR/"
