#!/bin/bash

# Titanic Lambda Assets Upload Script
# This script builds and uploads Lambda assets to the public assets bucket


# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Auto-load .env file if it exists
if [[ -f ".env" ]]; then
    echo -e "${YELLOW}Loading environment variables from .env file...${NC}"
    set -a  # automatically export all variables
    source .env
    set +a  # stop automatically exporting
    echo -e "${GREEN}✅ Environment variables loaded from .env${NC}"
fi

# Function to run CDK synthesis
run_cdk_synth() {
    echo -e "${YELLOW}Running CDK synthesis to build Lambda assets...${NC}"
    if npm run cdk:synth; then
        echo -e "${GREEN}✅ CDK synthesis completed${NC}"
    else
        echo -e "${RED}❌ CDK synthesis failed${NC}"
        exit 1
    fi
}

# Function to find the largest Lambda asset in cdk.out
find_lambda_asset() {
    local largest_asset=""
    local largest_size=0
    
    echo -e "${YELLOW}Locating Lambda asset in cdk.out...${NC}" >&2
    
    for asset_dir in $(find cdk.out -name "asset.*" -type d); do
        local index_file="$asset_dir/index.js"
        if [[ -f "$index_file" ]]; then
            # Get file size (works on both macOS and Linux)
            local size=$(stat -f%z "$index_file" 2>/dev/null || stat -c%s "$index_file" 2>/dev/null)
            echo "Found asset: $asset_dir (size: $size bytes)" >&2
            
            if [[ $size -gt $largest_size ]]; then
                largest_size=$size
                largest_asset="$asset_dir"
            fi
        fi
    done
    
    if [[ -z "$largest_asset" ]]; then
        return 1
    fi
    
    echo "$largest_asset"
    return 0
}

# Function to verify asset exists and is accessible
verify_asset_access() {
    local bucket="$1"
    local key="$2"
    
    if aws s3api head-object --bucket "$bucket" --key "$key" &> /dev/null; then
        echo -e "${GREEN}✅ Lambda assets found and accessible via AWS S3 API${NC}"
        echo "S3 Path: s3://$bucket/$key"
        
        # Get file size and last modified using AWS CLI
        local object_info=$(aws s3api head-object --bucket "$bucket" --key "$key" 2>/dev/null)
        if [[ -n "$object_info" ]]; then
            local size=$(echo "$object_info" | grep -o '"ContentLength": [0-9]*' | grep -o '[0-9]*')
            local last_modified=$(echo "$object_info" | grep -o '"LastModified": "[^"]*"' | cut -d'"' -f4)
            
            if [[ -n "$size" ]]; then
                echo "File size: $size bytes"
            fi
            
            if [[ -n "$last_modified" ]]; then
                echo "Last modified: $last_modified"
            fi
        fi
        
        echo -e "${BLUE}ℹ️  This matches how Lambda functions in other AWS accounts will access the asset${NC}"
        return 0
    else
        echo -e "${RED}❌ Lambda assets not found or not accessible via AWS S3 API${NC}"
        echo "Expected S3 path: s3://$bucket/$key"
        return 1
    fi
}

# Function to check AWS CLI and credentials
check_aws_setup() {
    # Check if AWS CLI is available
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}❌ AWS CLI not found. Please install AWS CLI and configure credentials.${NC}"
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure' or set environment variables.${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ AWS CLI configured and authenticated${NC}"
}

# Configuration
if [ ! -f "deployment-config.json" ]; then
    echo -e "${YELLOW}⚠️  deployment-config.json not found. Running CDK synthesis first...${NC}"
    run_cdk_synth
fi
ASSETS_BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('deployment-config.json', 'utf8')).buckets.assetsBucket")
if [[ -z "$ASSETS_BUCKET" ]]; then
    echo -e "${RED}❌ Failed to read assets bucket from deployment-config.json${NC}"
    exit 1
fi
LAMBDA_ZIP_PATH="lambda/merge-tables.zip"
TEMP_ZIP="lambda-merge-tables.zip"

# Help function
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Build and upload Lambda assets to the public assets bucket.
This script automatically runs CDK synthesis to build Lambda assets, then uploads them to S3.

OPTIONS:
    -h, --help                      Show this help message
    --dry-run                       Show what would be uploaded without actually uploading
    --verify-only                   Only verify that assets exist in the bucket

BUCKET CONFIGURATION:
    Bucket: $ASSETS_BUCKET
    Lambda Path: $LAMBDA_ZIP_PATH

WORKFLOW:
    1. Automatically run CDK synthesis if needed (builds Lambda assets)
    2. Extract bundled Lambda asset from cdk.out/
    3. Upload to S3 bucket
    4. Verify upload using same AWS S3 API access that cross-account deployments use

CROSS-ACCOUNT VERIFICATION:
    The verification uses 'aws s3api head-object' which matches how Lambda functions
    in other AWS accounts will access the asset. This ensures that cross-account
    CloudFormation deployments will work correctly.

EXAMPLES:
    # Build and upload assets (runs CDK synthesis automatically)
    $0

    # Dry run - show what would be uploaded
    $0 --dry-run

    # Just verify assets exist and are accessible for cross-account deployments
    $0 --verify-only

EOF
}

# Parse command line arguments
DRY_RUN=false
VERIFY_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verify-only)
            VERIFY_ONLY=true
            shift
            ;;
        *)
            echo -e "${RED}Error: Unknown option $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

echo -e "${BLUE}🚀 Titanic Lambda Assets Upload${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""

# Verify-only mode
if [[ "$VERIFY_ONLY" == "true" ]]; then
    echo -e "${YELLOW}Verifying Lambda assets using cross-account access pattern...${NC}"
    
    if verify_asset_access "$ASSETS_BUCKET" "$LAMBDA_ZIP_PATH"; then
        echo -e "${BLUE}ℹ️  Cross-account CloudFormation deployments will use: S3Bucket=$ASSETS_BUCKET, S3Key=$LAMBDA_ZIP_PATH${NC}"
        exit 0
    else
        echo -e "${RED}This means cross-account CloudFormation deployments will fail${NC}"
        exit 1
    fi
fi

check_aws_setup
echo ""

# Clean previous temp files
echo -e "${YELLOW}Cleaning previous temp files...${NC}"
rm -f "$TEMP_ZIP"

# Ensure cdk.out exists
if [[ ! -d "cdk.out" ]]; then
    echo -e "${YELLOW}⚠️  cdk.out directory not found. Running CDK synthesis...${NC}"
    run_cdk_synth
fi

# Find the Lambda asset, rebuild if not found
if ! LAMBDA_ASSET_DIR=$(find_lambda_asset); then
    echo -e "${RED}❌ No Lambda asset found in cdk.out${NC}"
    echo -e "${YELLOW}Attempting to rebuild Lambda assets...${NC}"
    run_cdk_synth || { echo -e "${RED}❌ CDK synthesis failed when rebuilding assets${NC}"; exit 1; }

    # Try again after synthesis
    if ! LAMBDA_ASSET_DIR=$(find_lambda_asset); then
        echo -e "${RED}❌ Still no Lambda asset found after synthesis${NC}"
        echo -e "${RED}There may be an issue with the CDK build process${NC}"
        exit 1
    fi
fi

LAMBDA_JS="$LAMBDA_ASSET_DIR/index.js"
LAMBDA_SIZE=$(stat -f%z "$LAMBDA_JS" 2>/dev/null || stat -c%s "$LAMBDA_JS" 2>/dev/null)
echo -e "${GREEN}✅ Lambda asset found: $LAMBDA_JS ($LAMBDA_SIZE bytes)${NC}"

# Bundle Lambda function
echo -e "${YELLOW}Bundling Lambda function...${NC}"
zip -j "$TEMP_ZIP" "$LAMBDA_JS"

if [[ ! -f "$TEMP_ZIP" ]]; then
    echo -e "${RED}❌ Failed to create Lambda bundle${NC}"
    exit 1
fi

ZIP_SIZE=$(stat -f%z "$TEMP_ZIP" 2>/dev/null || stat -c%s "$TEMP_ZIP" 2>/dev/null)
echo -e "${GREEN}✅ Lambda bundle created: $TEMP_ZIP ($ZIP_SIZE bytes)${NC}"

# Dry run mode
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}DRY RUN MODE - Would upload:${NC}"
    echo "  Source: $TEMP_ZIP"
    echo "  Target: s3://$ASSETS_BUCKET/$LAMBDA_ZIP_PATH"
    echo "  Size: $ZIP_SIZE bytes"
    echo ""
    echo -e "${BLUE}ℹ️  Run without --dry-run to perform actual upload${NC}"
    
    # Clean up temp file
    rm -f "$TEMP_ZIP"
    exit 0
fi

# Upload to S3
echo -e "${YELLOW}Uploading to S3...${NC}"
echo "Target: s3://$ASSETS_BUCKET/$LAMBDA_ZIP_PATH"

if aws s3 cp "$TEMP_ZIP" "s3://$ASSETS_BUCKET/$LAMBDA_ZIP_PATH"; then
    echo -e "${GREEN}✅ Upload successful${NC}"
else
    echo -e "${RED}❌ Upload failed${NC}"
    rm -f "$TEMP_ZIP"
    exit 1
fi

# Clean up temp file
rm -f "$TEMP_ZIP"

# Verify upload using the same method that cross-account CloudFormation deployments will use
echo -e "${YELLOW}Verifying upload using cross-account access pattern...${NC}"
if verify_asset_access "$ASSETS_BUCKET" "$LAMBDA_ZIP_PATH"; then
    echo -e "${GREEN}✅ Upload verified - asset is accessible via AWS S3 API${NC}"
else
    echo -e "${RED}❌ Upload verification failed - asset not accessible via AWS S3 API${NC}"
    echo "This means cross-account CloudFormation deployments will fail to access the Lambda code"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Asset upload completed successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "• The Lambda assets are now available for all deployments"
echo "• Run releases with: npm run deploy:release"
echo "• Deploy directly with: ./bin/deploy.sh (with required parameters)"
echo ""
