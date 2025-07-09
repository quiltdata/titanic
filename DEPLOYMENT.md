# Titanic ML Pipeline - Universal Deployment

This project includes a universal deployment script that can generate and deploy infrastructure using either **CloudFormation** or **Terraform** - making it easy for any admin to install without requiring CDK knowledge.

## Quick Start

### Prerequisites

1. **AWS CLI configured**: `aws configure`
2. **Node.js & npm installed** (for building the Lambda function)
3. **For Terraform deployment**: Install [Terraform](https://terraform.io/downloads)

### One-Line CloudFormation Deployment

```bash
./bin/deploy.sh --type cloudformation --deploy
```

### One-Line Terraform Deployment

```bash
./bin/deploy.sh --type terraform --deploy
```

## Deployment Options

### Generate Templates Only

```bash
# Generate CloudFormation template
./bin/deploy.sh --type cloudformation

# Generate Terraform templates
./bin/deploy.sh --type terraform
```

### Deploy with Custom Configuration

```bash
# CloudFormation with custom stack name and region
./bin/deploy.sh --type cloudformation --deploy \
  --stack-name my-titanic-pipeline \
  --region us-west-2

# Terraform with custom configuration
USE_S3_TABLES=true \
GLUE_DATABASE_NAME=my-glue-db \
./bin/deploy.sh --type terraform --deploy --stack-name my-pipeline
```

### Force Rebuild Lambda Package

```bash
./bin/deploy.sh --type cloudformation --deploy --force-rebuild
```

## Environment Variables

Configure the pipeline behavior with these environment variables:

```bash
export USE_S3_TABLES=true                    # Enable S3 Tables (default: false)
export GLUE_DATABASE_NAME=my-source-db       # Source database name
export S3TABLE_DATABASE_NAME=my-target-db    # Target database name  
export QUILT_CATALOG_DOMAIN=my.quilt.domain  # Quilt catalog domain
```

## What Gets Deployed

### Infrastructure Components

- **Lambda Function**: Processes Quilt package updates and merges tables
- **S3 Buckets**: Data storage and Athena query results
- **IAM Roles**: Proper permissions for Lambda execution
- **EventBridge Rule**: Triggers Lambda on package updates
- **Athena WorkGroup**: Query execution environment

### Supported Modes

- **Glue Tables Mode** (`USE_S3_TABLES=false`): Traditional Glue Catalog tables
- **S3 Tables Mode** (`USE_S3_TABLES=true`): New S3 Tables feature (preview)

## For End Users (No CDK Required)

### CloudFormation Users

1. Download the generated template: `templates/titanic-cloudformation.yaml`
2. Deploy via AWS Console or CLI:
   ```bash
   aws cloudformation create-stack \
     --stack-name titanic-ml \
     --template-body file://templates/titanic-cloudformation.yaml \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameters ParameterKey=UseS3Tables,ParameterValue=false
   ```

### Terraform Users

1. Copy the `templates/terraform/` directory
2. Deploy:
   ```bash
   cd templates/terraform
   terraform init
   terraform apply
   ```

## Advanced Usage

### Script Options

```bash
Usage: ./bin/deploy.sh --type <cloudformation|terraform> [OPTIONS]

Required Arguments:
    --type TYPE             Template type: 'cloudformation' or 'terraform'

Optional Arguments:
    --deploy               Deploy after generating template
    --stack-name NAME      Stack name for deployment
    --region REGION        AWS region
    --force-rebuild        Force rebuild of Lambda package
    --help                 Show help message
```

### Generated Files

```
templates/
├── titanic-cloudformation.yaml    # CloudFormation template
└── terraform/                     # Terraform module
    ├── main.tf                    # Main resources
    ├── variables.tf               # Input variables
    └── outputs.tf                 # Output values

dist/
└── lambda-package.zip             # Compiled Lambda deployment package
```

## Troubleshooting

### Common Issues

1. **AWS credentials not configured**
   ```bash
   aws configure
   ```

2. **Missing dependencies**
   ```bash
   npm install
   ```

3. **Permission errors**
   ```bash
   chmod +x bin/deploy.sh
   ```

4. **S3 bucket naming conflicts**: Script auto-generates unique bucket names

### Cleanup

```bash
# CloudFormation
aws cloudformation delete-stack --stack-name titanic-ml-pipeline

# Terraform
cd templates/terraform
terraform destroy
```

## Benefits Over CDK

- ✅ **No CDK knowledge required**
- ✅ **No Node.js/TypeScript setup for end users**
- ✅ **Standard AWS deployment tools**
- ✅ **Pre-compiled and tested templates**
- ✅ **One-click deployment options**
- ✅ **Multiple IaC tool support**

## Architecture

```
EventBridge (Quilt Updates) 
    ↓
Lambda Function (merge-tables.ts)
    ↓
Athena + Glue/S3Tables
    ↓
S3 Buckets (Results)
```

The Lambda function automatically:
1. Detects package updates via EventBridge
2. Selects relevant buckets and views
3. Executes merge operations via Athena
4. Stores results in S3

Perfect for data teams who need reliable, automated table merging without infrastructure complexity!
