#!/bin/bash

# Titanic Stack CloudFormation Deployment Script
# This script deploys pre-generated CloudFormation templates for the Titanic stack
# set -e removed to allow manual error handling

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Auto-load .env file if it exists
if [[ -f ".env" ]]; then
    echo -e "${YELLOW}Loading environment variables from .env file...${NC}"
    set -a  # automatically export all variables
    source .env
    set +a  # stop automatically exporting
    echo -e "${GREEN}✅ Environment variables loaded from .env${NC}"
fi

# Default values
STACK_NAME="TitanicStack"
REGION="${AWS_DEFAULT_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
PROFILE=""
TEMPLATE_FILE="template.json"
EVENT_FILE="initial-event.json"
DEPLOYMENT_CONFIG_FILE="deployment-config.json"

# Initialize parameter values (CLI args will override these later)
# Use environment variables if set, otherwise use defaults
ATHENA_DATABASE_NAME="${ATHENA_DATABASE_NAME:-}"
QUILT_READ_POLICY_ARN="${QUILT_READ_POLICY_ARN:-}"
PUBLIC_ASSETS_BUCKET_ROOT="${PUBLIC_ASSETS_BUCKET_ROOT:-}"
USE_S3_TABLE="false"

# Load deployment config if it exists
if [[ -f "$DEPLOYMENT_CONFIG_FILE" ]]; then
    echo -e "${YELLOW}Loading deployment configuration from $DEPLOYMENT_CONFIG_FILE...${NC}"
    
    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required to parse deployment config file but is not installed.${NC}"
        exit 1
    fi
    
    # Extract bucket names from deployment config
    PUBLIC_ASSETS_BUCKET_ROOT=$(jq -r '.buckets.assetsBucketRoot // empty' "$DEPLOYMENT_CONFIG_FILE")
    JQ_STATUS=$?
    if [[ $JQ_STATUS -ne 0 ]]; then
        echo -e "${RED}Error: Failed to parse deployment config file with jq.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Deployment configuration loaded${NC}"
fi

# Help function
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy the Titanic CloudFormation stack using a pre-generated template.
This script expects a CloudFormation template file and deploys it directly.

OPTIONS:
    -h, --help                      Show this help message
    -s, --stack-name NAME           CloudFormation stack name (default: TitanicStack)
    -r, --region REGION             AWS region (default: \$AWS_DEFAULT_REGION or us-east-1)
    -p, --profile PROFILE           AWS profile to use
    -t, --template-file FILE        CloudFormation template file (default: template.json)
    --athena-database-name NAME     Athena database name (required)
    --quilt-read-policy-arn ARN     Quilt read policy ARN (required)
    --public-assets-bucket-root NAME Public assets bucket root name (for external deployments)

See README.md for more information.

ENVIRONMENT VARIABLES:
    The script automatically loads variables from .env file (if present)
    and deployment-config.json file (if present)
    
    Variables can also be set manually:
    - ATHENA_DATABASE_NAME - Athena database name
    - QUILT_READ_POLICY_ARN - Quilt read policy ARN
    - PUBLIC_ASSETS_BUCKET_ROOT - Public assets bucket root name
    - AWS_DEFAULT_REGION - AWS region

DEPLOYMENT CONFIG:
    The script automatically loads deployment configuration from
    deployment-config.json if present. This file typically contains
    bucket names and other deployment-specific values generated
    during the build process.

NOTE:
    This script requires a pre-generated CloudFormation template. 
    Use release.sh to generate templates from CDK code.

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -s|--stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -p|--profile)
            PROFILE="$2"
            shift 2
            ;;
        -t|--template-file)
            TEMPLATE_FILE="$2"
            shift 2
            ;;
        --athena-database-name)
            ATHENA_DATABASE_NAME="$2"
            shift 2
            ;;
        --quilt-read-policy-arn)
            QUILT_READ_POLICY_ARN="$2"
            shift 2
            ;;
        --public-assets-bucket-root)
            PUBLIC_ASSETS_BUCKET_ROOT="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Error: Unknown option $1${NC}"
            show_help
            exit 1
            ;;
    esac
done


# Validate required parameters
if [[ -z "$ATHENA_DATABASE_NAME" ]]; then
    echo -e "${RED}Error: Athena database name is required. Use --athena-database-name or set ATHENA_DATABASE_NAME environment variable.${NC}"
    exit 1
fi

if [[ -z "$QUILT_READ_POLICY_ARN" ]]; then
    echo -e "${RED}Error: Quilt read policy ARN is required. Use --quilt-read-policy-arn or set QUILT_READ_POLICY_ARN environment variable.${NC}"
    exit 1
fi

if [[ -z "$PUBLIC_ASSETS_BUCKET_ROOT" ]]; then
        echo -e "${RED}Error: Public Assets Bucket Root is required. Use --public-assets-bucket-root or set PUBLIC_ASSETS_BUCKET_ROOT environment variable.${NC}"
    exit 1
fi

# Verify this is an external deployment template by looking for PublicAssetsBucketRoot parameter
if [[ -f "$TEMPLATE_FILE" ]]; then
    if grep -q "PublicAssetsBucketRoot" "$TEMPLATE_FILE"; then
        GREP_STATUS=$?
        if [[ $GREP_STATUS -ne 0 ]]; then
            echo -e "${RED}Error: Failed to search template file.${NC}"
            exit 1
        fi
        echo -e "${YELLOW}Verified external deployment template${NC}"
    fi
else
    echo -e "${RED}Error: CloudFormation template not found: $TEMPLATE_FILE${NC}"
    echo -e "${YELLOW}Hint: Use release.sh to generate CloudFormation templates from CDK code.${NC}"
    exit 1
fi

# Build AWS CLI options
AWS_OPTS="--region $REGION"
if [[ -n "$PROFILE" ]]; then
    AWS_OPTS="$AWS_OPTS --profile $PROFILE"
fi

# Display configuration
echo -e "${GREEN}Titanic Stack CloudFormation Deployment Configuration:${NC}"
echo -e "${YELLOW}Using AWS region: $REGION${NC}"
aws sts get-caller-identity $AWS_OPTS
STS_STATUS=$?
if [[ $STS_STATUS -ne 0 ]]; then
    echo -e "${RED}Error: AWS STS get-caller-identity failed.${NC}"
    exit 1
fi
echo "Stack Name: $STACK_NAME"
echo "Region: $REGION"
echo "Profile: ${PROFILE:-default}"
echo "Template File: $TEMPLATE_FILE"
echo "Athena Database Name: $ATHENA_DATABASE_NAME"
echo "Quilt Read Policy ARN: $QUILT_READ_POLICY_ARN"
echo "Public Assets Bucket Root: ${PUBLIC_ASSETS_BUCKET_ROOT:-<not set>}"
echo "Public Assets Bucket Name: ${PUBLIC_ASSETS_BUCKET_ROOT}-${REGION}"
echo "AWS CLI Options: $AWS_OPTS"
echo ""

read -p "Deploy using the configuration above? (y/N):" CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${RED}Deployment cancelled by user.${NC}"
    exit 0
fi

echo -e "\n${GREEN}Starting deployment....${NC}"

# Build parameter overrides
PARAMETER_OVERRIDES="AthenaDatabaseName=$ATHENA_DATABASE_NAME QuiltReadPolicyArn=$QUILT_READ_POLICY_ARN UseS3Table=$USE_S3_TABLE"

# Add optional parameters if they are set
if [[ -n "$PUBLIC_ASSETS_BUCKET_ROOT" ]]; then
    PARAMETER_OVERRIDES="$PARAMETER_OVERRIDES PublicAssetsBucketRoot=$PUBLIC_ASSETS_BUCKET_ROOT"
fi

# Deploy the stack
aws cloudformation deploy \
    --template-file "$TEMPLATE_FILE" \
    --stack-name "$STACK_NAME" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides $PARAMETER_OVERRIDES \
    $AWS_OPTS

DEPLOY_STATUS=$?

if [[ $DEPLOY_STATUS -ne 0 ]]; then
    echo -e "${RED}❌ Stack deployment failed.${NC}"
    echo -e "${YELLOW}Fetching recent stack events...${NC}"
    aws cloudformation describe-stack-events --stack-name "$STACK_NAME" $AWS_OPTS \
        --query 'StackEvents[].[Timestamp, LogicalResourceId, ResourceStatus, ResourceStatusReason]' \
        --output table
    EVENTS_STATUS=$?
    if [[ $EVENTS_STATUS -ne 0 ]]; then
        echo -e "${RED}Error: Failed to fetch stack events.${NC}"
    fi
    exit 1
fi

echo -e "${GREEN}Deployment completed successfully!${NC}"

# Show stack outputs
echo -e "${YELLOW}Stack outputs:${NC}"
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue,Description]' \
    --output table \
    $AWS_OPTS
DESCRIBE_STATUS=$?
if [[ $DESCRIBE_STATUS -ne 0 ]]; then
    echo -e "${RED}Error: Failed to describe stack outputs.${NC}"
    exit 1
fi

# Send initialization event
echo -e "${YELLOW}Sending initialization event to populate tables...${NC}"
if [[ -f "$EVENT_FILE" ]]; then
    echo "Sending event to EventBridge..."
    aws sts get-caller-identity $AWS_OPTS
    EVENT_ENTRY=$(cat "$EVENT_FILE" | jq -c '.[]')
    aws events put-events --entries "$EVENT_ENTRY" $AWS_OPTS
    EVENT_STATUS=$?
    if [[ $EVENT_STATUS -ne 0 ]]; then
        echo -e "${RED}Error: Failed to send initialization event to EventBridge.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Initialization event sent successfully!${NC}"
else
    echo -e "${YELLOW}Warning: Failed to find event file: $EVENT_FILE${NC}"
fi

# Clean up temporary files
if [[ -f "template-packaged.yaml" ]]; then
    rm -f "template-packaged.yaml"
fi
