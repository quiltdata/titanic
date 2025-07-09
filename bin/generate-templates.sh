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

# Default values
TEMPLATE_TYPE=""
OUTPUT_DIR="$TEMPLATES_DIR"
FORCE_REBUILD="false"

# Usage information
usage() {
    cat << EOF
Usage: $0 --type <cloudformation|terraform> [OPTIONS]

Generate Titanic ML Pipeline infrastructure templates.

Required Arguments:
    --type TYPE             Template type: 'cloudformation' or 'terraform'

Optional Arguments:
    --output-dir DIR        Output directory for templates (default: $OUTPUT_DIR)
    --force-rebuild         Force rebuild of Lambda package (default: false)
    --help                  Show this help message

Examples:
    # Generate CloudFormation template
    $0 --type cloudformation

    # Generate Terraform template with custom output directory
    $0 --type terraform --output-dir ./my-templates

    # Force rebuild Lambda package
    $0 --type terraform --force-rebuild

    # Deploy with custom region
    $0 --type cloudformation --deploy --region us-west-2

Environment Variables:
    USE_S3_TABLES          Enable S3 Tables (default: false)
    GLUE_DATABASE_NAME     Source Glue database name
    S3TABLE_DATABASE_NAME  Target S3 Tables database name
    QUILT_CATALOG_DOMAIN   Quilt catalog domain
EOF
}

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --type)
                TEMPLATE_TYPE="$2"
                shift 2
                ;;
            --output-dir)
                OUTPUT_DIR="$2"
                shift 2
                ;;
            --force-rebuild)
                FORCE_REBUILD="true"
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

    # Validate required arguments
    if [[ -z "$TEMPLATE_TYPE" ]]; then
        log_error "Template type is required. Use --type cloudformation or --type terraform"
        usage
        exit 1
    fi

    if [[ "$TEMPLATE_TYPE" != "cloudformation" && "$TEMPLATE_TYPE" != "terraform" ]]; then
        log_error "Invalid template type: $TEMPLATE_TYPE. Must be 'cloudformation' or 'terraform'"
        exit 1
    fi
    
    # Create output directory
    mkdir -p "$OUTPUT_DIR"
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
    if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
        log_error "Node.js and npm are required but not installed"
        exit 1
    fi

    # Check for deployment-specific tools
    if [[ "$DEPLOY_MODE" == "true" ]]; then
        if [[ "$TEMPLATE_TYPE" == "terraform" ]]; then
            if ! command -v terraform &> /dev/null; then
                log_error "Terraform is required for deployment but not installed"
                exit 1
            fi
        fi
    fi

    log_success "Prerequisites check passed"
}

# Build Lambda function
build_lambda() {
    log_info "Building Lambda function..."

    cd "$PROJECT_ROOT"

    # Clean and install dependencies
    if [[ "$FORCE_REBUILD" == "true" ]] || [[ ! -d "node_modules" ]]; then
        log_info "Installing dependencies..."
        npm install
    fi

    # Build TypeScript
    log_info "Compiling TypeScript..."
    npm run build

    # Create distribution directory
    mkdir -p "$DIST_DIR"

    # Package Lambda function
    log_info "Packaging Lambda function..."
    cd "$DIST_DIR"
    rm -f lambda-package.zip

    # Copy compiled JavaScript and dependencies
    cp -r "$PROJECT_ROOT/lib" ./ 2>/dev/null || true
    cp "$PROJECT_ROOT/package.json" ./
    
    # Install production dependencies only
    npm install --production --silent

    # Create deployment package
    zip -r lambda-package.zip lib/ node_modules/ package.json -q

    log_success "Lambda package created: $DIST_DIR/lambda-package.zip"
}

# Generate CloudFormation template
generate_cloudformation() {
    log_info "Generating CloudFormation template..."

    mkdir -p "$TEMPLATES_DIR"

    cat > "$TEMPLATES_DIR/titanic-cloudformation.yaml" << 'EOF'
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Titanic ML Pipeline Infrastructure - One-Click Deploy'

Parameters:
  UseS3Tables:
    Type: String
    Default: 'false'
    AllowedValues: ['true', 'false']
    Description: 'Enable S3 Tables instead of Glue Tables'
  
  GlueDatabaseName:
    Type: String
    Default: 'titanic-glue-db'
    Description: 'Source Glue database name for reading data'
  
  S3TableDatabaseName:
    Type: String
    Default: 'titanic-s3table-db'
    Description: 'Target S3 Tables database name for writing'
  
  QuiltCatalogDomain:
    Type: String
    Default: 'stable.quilttest.com'
    Description: 'Quilt catalog domain'
  
  LambdaCodeBucket:
    Type: String
    Description: 'S3 bucket containing the Lambda deployment package'
  
  LambdaCodeKey:
    Type: String
    Default: 'lambda-package.zip'
    Description: 'S3 key for the Lambda deployment package'

Resources:
  # S3 Buckets
  DataBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub '${AWS::StackName}-data-${AWS::AccountId}'
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true

  ResultsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub '${AWS::StackName}-results-${AWS::AccountId}'
      LifecycleConfiguration:
        Rules:
          - Id: DeleteOldQueryResults
            Status: Enabled
            ExpirationInDays: 30
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true

  # IAM Role for Lambda
  LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub '${AWS::StackName}-lambda-role'
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: TitanicLambdaPolicy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - s3:GetObject
                  - s3:PutObject
                  - s3:DeleteObject
                  - s3:ListBucket
                Resource:
                  - !GetAtt DataBucket.Arn
                  - !Sub '${DataBucket.Arn}/*'
                  - !GetAtt ResultsBucket.Arn
                  - !Sub '${ResultsBucket.Arn}/*'
              - Effect: Allow
                Action:
                  - athena:StartQueryExecution
                  - athena:GetQueryExecution
                  - athena:GetQueryResults
                  - athena:StopQueryExecution
                  - athena:GetWorkGroup
                Resource: '*'
              - Effect: Allow
                Action:
                  - glue:GetTable
                  - glue:GetTables
                  - glue:GetDatabase
                  - glue:GetDatabases
                  - glue:CreateTable
                  - glue:UpdateTable
                  - glue:DeleteTable
                Resource: '*'
              - Effect: Allow
                Action:
                  - s3tables:GetTable
                  - s3tables:CreateTable
                  - s3tables:UpdateTable
                  - s3tables:DeleteTable
                  - s3tables:ListTables
                Resource: '*'

  # Lambda Function
  TitanicMergeFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub '${AWS::StackName}-merge-function'
      Runtime: nodejs18.x
      Handler: lib/merge-tables.handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Code:
        S3Bucket: !Ref LambdaCodeBucket
        S3Key: !Ref LambdaCodeKey
      Environment:
        Variables:
          USE_S3_TABLE: !Ref UseS3Tables
          GLUE_DATABASE_NAME: !Ref GlueDatabaseName
          S3TABLE_DATABASE_NAME: !Ref S3TableDatabaseName
          QUILT_CATALOG_DOMAIN: !Ref QuiltCatalogDomain
          GLUE_TABLES_BUCKET_ARN: !GetAtt DataBucket.Arn
          S3_TABLES_BUCKET_ARN: !GetAtt DataBucket.Arn
          RESULTS_BUCKET: !Ref ResultsBucket
      Timeout: 900
      MemorySize: 1024

  # EventBridge Rule
  PackageUpdateRule:
    Type: AWS::Events::Rule
    Properties:
      Name: !Sub '${AWS::StackName}-package-updates'
      Description: 'Trigger Titanic merge on package updates'
      EventPattern:
        source: ['quilt']
        detail-type: ['Package Updated']
      State: ENABLED
      Targets:
        - Arn: !GetAtt TitanicMergeFunction.Arn
          Id: TitanicMergeTarget

  # Permission for EventBridge to invoke Lambda
  LambdaInvokePermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref TitanicMergeFunction
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt PackageUpdateRule.Arn

  # Athena WorkGroup
  AthenaWorkGroup:
    Type: AWS::Athena::WorkGroup
    Properties:
      Name: !Sub '${AWS::StackName}-workgroup'
      Description: 'WorkGroup for Titanic ML Pipeline queries'
      WorkGroupConfiguration:
        ResultConfiguration:
          OutputLocation: !Sub 's3://${ResultsBucket}/athena-results/'
        EnforceWorkGroupConfiguration: true
        PublishCloudWatchMetrics: true

Outputs:
  LambdaFunctionArn:
    Description: 'Titanic Merge Lambda Function ARN'
    Value: !GetAtt TitanicMergeFunction.Arn
    Export:
      Name: !Sub '${AWS::StackName}-LambdaArn'
  
  DataBucketName:
    Description: 'Data bucket name'
    Value: !Ref DataBucket
    Export:
      Name: !Sub '${AWS::StackName}-DataBucket'
  
  ResultsBucketName:
    Description: 'Results bucket name'
    Value: !Ref ResultsBucket
    Export:
      Name: !Sub '${AWS::StackName}-ResultsBucket'
  
  AthenaWorkGroupName:
    Description: 'Athena WorkGroup name'
    Value: !Ref AthenaWorkGroup
    Export:
      Name: !Sub '${AWS::StackName}-WorkGroup'
EOF

    log_success "CloudFormation template generated: $TEMPLATES_DIR/titanic-cloudformation.yaml"
}

# Generate Terraform template
generate_terraform() {
    log_info "Generating Terraform templates..."

    mkdir -p "$TEMPLATES_DIR/terraform"

    # Main configuration
    cat > "$TEMPLATES_DIR/terraform/main.tf" << 'EOF'
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# S3 Buckets
resource "aws_s3_bucket" "data" {
  bucket = "${var.stack_name}-data-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket = aws_s3_bucket.data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "results" {
  bucket = "${var.stack_name}-results-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_lifecycle_configuration" "results" {
  bucket = aws_s3_bucket.results.id

  rule {
    id     = "delete_old_query_results"
    status = "Enabled"

    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket_public_access_block" "results" {
  bucket = aws_s3_bucket.results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "${var.stack_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.stack_name}-lambda-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.data.arn,
          "${aws_s3_bucket.data.arn}/*",
          aws_s3_bucket.results.arn,
          "${aws_s3_bucket.results.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution",
          "athena:GetWorkGroup"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:CreateTable",
          "glue:UpdateTable",
          "glue:DeleteTable"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3tables:GetTable",
          "s3tables:CreateTable",
          "s3tables:UpdateTable",
          "s3tables:DeleteTable",
          "s3tables:ListTables"
        ]
        Resource = "*"
      }
    ]
  })
}

# Lambda Function
resource "aws_lambda_function" "titanic_merge" {
  function_name = "${var.stack_name}-merge-function"
  role         = aws_iam_role.lambda_role.arn
  handler      = "lib/merge-tables.handler"
  runtime      = "nodejs18.x"
  timeout      = 900
  memory_size  = 1024

  s3_bucket = var.lambda_code_bucket
  s3_key    = var.lambda_code_key

  environment {
    variables = {
      USE_S3_TABLE          = var.use_s3_tables
      GLUE_DATABASE_NAME    = var.glue_database_name
      S3TABLE_DATABASE_NAME = var.s3table_database_name
      QUILT_CATALOG_DOMAIN  = var.quilt_catalog_domain
      GLUE_TABLES_BUCKET_ARN = aws_s3_bucket.data.arn
      S3_TABLES_BUCKET_ARN  = aws_s3_bucket.data.arn
      RESULTS_BUCKET        = aws_s3_bucket.results.bucket
    }
  }
}

# EventBridge Rule
resource "aws_cloudwatch_event_rule" "package_update" {
  name        = "${var.stack_name}-package-updates"
  description = "Trigger Titanic merge on package updates"

  event_pattern = jsonencode({
    source      = ["quilt"]
    detail-type = ["Package Updated"]
  })
}

resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.package_update.name
  target_id = "TitanicMergeTarget"
  arn       = aws_lambda_function.titanic_merge.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.titanic_merge.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.package_update.arn
}

# Athena WorkGroup
resource "aws_athena_workgroup" "titanic" {
  name        = "${var.stack_name}-workgroup"
  description = "WorkGroup for Titanic ML Pipeline queries"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics         = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.results.bucket}/athena-results/"
    }
  }
}
EOF

    # Variables
    cat > "$TEMPLATES_DIR/terraform/variables.tf" << 'EOF'
variable "stack_name" {
  description = "Name for the stack resources"
  type        = string
  default     = "titanic-ml-pipeline"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-2"
}

variable "use_s3_tables" {
  description = "Enable S3 Tables instead of Glue Tables"
  type        = string
  default     = "false"
  validation {
    condition     = contains(["true", "false"], var.use_s3_tables)
    error_message = "use_s3_tables must be either 'true' or 'false'."
  }
}

variable "glue_database_name" {
  description = "Source Glue database name for reading data"
  type        = string
  default     = "titanic-glue-db"
}

variable "s3table_database_name" {
  description = "Target S3 Tables database name for writing"
  type        = string
  default     = "titanic-s3table-db"
}

variable "quilt_catalog_domain" {
  description = "Quilt catalog domain"
  type        = string
  default     = "stable.quilttest.com"
}

variable "lambda_code_bucket" {
  description = "S3 bucket containing the Lambda deployment package"
  type        = string
}

variable "lambda_code_key" {
  description = "S3 key for the Lambda deployment package"
  type        = string
  default     = "lambda-package.zip"
}
EOF

    # Outputs
    cat > "$TEMPLATES_DIR/terraform/outputs.tf" << 'EOF'
output "lambda_function_arn" {
  description = "Titanic Merge Lambda Function ARN"
  value       = aws_lambda_function.titanic_merge.arn
}

output "data_bucket_name" {
  description = "Data bucket name"
  value       = aws_s3_bucket.data.bucket
}

output "results_bucket_name" {
  description = "Results bucket name"
  value       = aws_s3_bucket.results.bucket
}

output "athena_workgroup_name" {
  description = "Athena WorkGroup name"
  value       = aws_athena_workgroup.titanic.name
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.titanic_merge.function_name
}
EOF

    log_success "Terraform templates generated in: $TEMPLATES_DIR/terraform/"
}

# Upload Lambda package to S3
upload_lambda_package() {
    local bucket_name="$1"
    
    log_info "Uploading Lambda package to S3..."
    
    # Create bucket if it doesn't exist
    if ! aws s3 ls "s3://$bucket_name" &> /dev/null; then
        log_info "Creating S3 bucket: $bucket_name"
        aws s3 mb "s3://$bucket_name" --region "$AWS_REGION"
    fi
    
    # Upload package
    aws s3 cp "$DIST_DIR/lambda-package.zip" "s3://$bucket_name/lambda-package.zip"
    
    log_success "Lambda package uploaded to s3://$bucket_name/lambda-package.zip"
}

# Deploy CloudFormation stack
deploy_cloudformation() {
    log_info "Deploying CloudFormation stack: $STACK_NAME"
    
    # Generate unique bucket name for deployment artifacts
    local deployment_bucket="${STACK_NAME}-deploy-$(date +%s)-${RANDOM}"
    
    # Upload Lambda package
    upload_lambda_package "$deployment_bucket"
    
    # Deploy stack
    aws cloudformation deploy \
        --template-file "$TEMPLATES_DIR/titanic-cloudformation.yaml" \
        --stack-name "$STACK_NAME" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" \
        --parameter-overrides \
            UseS3Tables="${USE_S3_TABLES:-false}" \
            GlueDatabaseName="${GLUE_DATABASE_NAME:-titanic-glue-db}" \
            S3TableDatabaseName="${S3TABLE_DATABASE_NAME:-titanic-s3table-db}" \
            QuiltCatalogDomain="${QUILT_CATALOG_DOMAIN:-stable.quilttest.com}" \
            LambdaCodeBucket="$deployment_bucket" \
            LambdaCodeKey="lambda-package.zip"
    
    log_success "CloudFormation stack deployed successfully!"
    
    # Show outputs
    log_info "Stack outputs:"
    aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
        --output table
}

# Deploy Terraform stack
deploy_terraform() {
    log_info "Deploying Terraform stack: $STACK_NAME"
    
    cd "$TEMPLATES_DIR/terraform"
    
    # Generate unique bucket name for deployment artifacts
    local deployment_bucket="${STACK_NAME}-deploy-$(date +%s)-${RANDOM}"
    
    # Upload Lambda package
    upload_lambda_package "$deployment_bucket"
    
    # Initialize Terraform
    terraform init
    
    # Create terraform.tfvars
    cat > terraform.tfvars << EOF
stack_name              = "$STACK_NAME"
aws_region             = "$AWS_REGION"
use_s3_tables          = "${USE_S3_TABLES:-false}"
glue_database_name     = "${GLUE_DATABASE_NAME:-titanic-glue-db}"
s3table_database_name  = "${S3TABLE_DATABASE_NAME:-titanic-s3table-db}"
quilt_catalog_domain   = "${QUILT_CATALOG_DOMAIN:-stable.quilttest.com}"
lambda_code_bucket     = "$deployment_bucket"
lambda_code_key        = "lambda-package.zip"
EOF
    
    # Plan and apply
    terraform plan
    terraform apply -auto-approve
    
    log_success "Terraform stack deployed successfully!"
    
    # Show outputs
    log_info "Stack outputs:"
    terraform output
}

# Main function
main() {
    parse_args "$@"
    
    log_info "Titanic ML Pipeline Template Generator"
    log_info "Template Type: $TEMPLATE_TYPE"
    log_info "Output Directory: $OUTPUT_DIR"
    
    check_prerequisites
    build_lambda
    
    case "$TEMPLATE_TYPE" in
        "cloudformation")
            generate_cloudformation
            ;;
        "terraform")
            generate_terraform
            ;;
    esac
    
    log_success "Template generation completed successfully!"
    log_info "Templates generated in: $OUTPUT_DIR"
}

# Run main function with all arguments
main "$@"
