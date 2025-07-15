#!/bin/bash

# Titanic Stack CloudFormation Deployment Script
# This script deploys pre-generated CloudFormation templates for the Titanic stack

set -e

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

# Initialize parameter values (CLI args will override these later)
# Use environment variables if set, otherwise use defaults
GLUE_DATABASE_NAME="${GLUE_DATABASE_NAME:-${QUILT_DATABASE_NAME:-}}"
QUILT_READ_POLICY_ARN="${QUILT_READ_POLICY_ARN:-}"
USE_S3_TABLE="${USE_S3_TABLE:-false}"

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
    --glue-database-name NAME       Glue database name (required)
    --quilt-read-policy-arn ARN     Quilt read policy ARN (required)
    --use-s3-table BOOL             Use S3 Tables format (true/false, default: false)

EXAMPLES:
    # Deploy with required parameters
    $0 --glue-database-name mydb --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy

    # Deploy with custom template file
    $0 --template-file my-template.json \\
       --glue-database-name mydb \\
       --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy

    # Deploy with all parameters
    $0 --glue-database-name mydb \\
       --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy \\
       --use-s3-table true

    # Use .env file (automatically loaded if present)
    cp env.example .env
    # Edit .env with your values, then:
    $0

    # Use environment variables manually
    QUILT_DATABASE_NAME=mydb QUILT_READ_POLICY_ARN=arn:aws:iam::123456789012:policy/QuiltReadPolicy $0

ENVIRONMENT VARIABLES:
    The script automatically loads variables from .env file (if present)
    
    Variables can also be set manually:
    - QUILT_DATABASE_NAME - Glue database name
    - QUILT_READ_POLICY_ARN - Quilt read policy ARN
    - USE_S3_TABLE - Use S3 Tables format (true/false)
    - AWS_DEFAULT_REGION - AWS region
    - AWS_PROFILE - AWS profile

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
        --glue-database-name)
            GLUE_DATABASE_NAME="$2"
            shift 2
            ;;
        --quilt-read-policy-arn)
            QUILT_READ_POLICY_ARN="$2"
            shift 2
            ;;
        --use-s3-table)
            USE_S3_TABLE="$2"
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
if [[ -z "$GLUE_DATABASE_NAME" ]]; then
    echo -e "${RED}Error: Glue database name is required. Use --glue-database-name or set QUILT_DATABASE_NAME environment variable.${NC}"
    exit 1
fi

if [[ -z "$QUILT_READ_POLICY_ARN" ]]; then
    echo -e "${RED}Error: Quilt read policy ARN is required. Use --quilt-read-policy-arn or set QUILT_READ_POLICY_ARN environment variable.${NC}"
    exit 1
fi

# Validate USE_S3_TABLE value
if [[ "$USE_S3_TABLE" != "true" && "$USE_S3_TABLE" != "false" ]]; then
    echo -e "${RED}Error: use-s3-table must be 'true' or 'false', got: $USE_S3_TABLE${NC}"
    exit 1
fi

# Check if template exists
if [[ ! -f "$TEMPLATE_FILE" ]]; then
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
echo "Stack Name: $STACK_NAME"
echo "Region: $REGION"
echo "Profile: ${PROFILE:-default}"
echo "Template File: $TEMPLATE_FILE"
echo "Glue Database Name: $GLUE_DATABASE_NAME"
echo "Quilt Read Policy ARN: $QUILT_READ_POLICY_ARN"
echo "Use S3 Table: $USE_S3_TABLE"
echo ""

echo -e "${YELLOW}Please verify the configuration above.${NC}"
read -p "Proceed with deployment? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${RED}Deployment cancelled by user.${NC}"
    exit 0
fi

# Deploy the stack
DEPLOY_OUTPUT=$(aws cloudformation deploy \
    --template-file "$TEMPLATE_FILE" \
    --stack-name "$STACK_NAME" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
        GlueDatabaseName="$GLUE_DATABASE_NAME" \
        QuiltReadPolicyArn="$QUILT_READ_POLICY_ARN" \
        UseS3Table="$USE_S3_TABLE" \
    $AWS_OPTS 2>&1)

DEPLOY_STATUS=$?
echo "$DEPLOY_OUTPUT"

if [[ $DEPLOY_STATUS -ne 0 ]]; then
    echo -e "${RED}❌ Stack deployment failed.${NC}"
    echo -e "${YELLOW}Fetching recent stack events...${NC}"
    aws cloudformation describe-stack-events --stack-name "$STACK_NAME" $AWS_OPTS \
        --query 'StackEvents[].[Timestamp, LogicalResourceId, ResourceStatus, ResourceStatusReason]' \
        --output table
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

# Clean up temporary files
if [[ -f "template-packaged.yaml" ]]; then
    rm -f "template-packaged.yaml"
fi
