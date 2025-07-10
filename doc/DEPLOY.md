# Titanic ML Pipeline - Deployment Guide

This project provides multiple deployment options with automated CI/CD through GitHub Actions:

1. **GitHub Release Artifacts** - Download pre-built packages (easiest)
2. **Manual Build & Deploy** - Build and deploy from source
3. **Traditional CDK** - For developers

## 🚀 Option 1: GitHub Release Artifacts (Recommended)

### Automated CI/CD

**No Setup Required:** GitHub Actions automatically:
- ✅ Builds and validates artifacts on every push
- ✅ Stores everything in GitHub Actions and releases
- ✅ Validates CloudFormation and Terraform syntax
- ✅ No AWS credentials required for CI/CD

### Download Pre-Built Artifacts

**Latest Release:**
```bash
# Get latest release
LATEST=$(curl -s https://api.github.com/repos/yourusername/titanic/releases/latest | jq -r .tag_name)

# Download CloudFormation package
wget "https://github.com/yourusername/titanic/releases/download/${LATEST}/titanic-cloudformation-${LATEST}.zip"
unzip titanic-cloudformation-${LATEST}.zip
cd cloudformation-${LATEST}/
./deploy.sh --use-s3-tables --stack-name my-pipeline

# Or download Terraform package
wget "https://github.com/yourusername/titanic/releases/download/${LATEST}/titanic-terraform-${LATEST}.zip"
unzip titanic-terraform-${LATEST}.zip
cd terraform-${LATEST}/
./deploy.sh --auto-approve --use-s3-tables
```

**Specific Version:**
```bash
VERSION="v1.0.0"
wget "https://github.com/yourusername/titanic/releases/download/${VERSION}/titanic-cloudformation-${VERSION}.zip"
```

### GitHub Actions Workflow Behavior

| Trigger | Version Format | Example | Retention |
|---------|---------------|---------|-----------|
| Push to main | `build-YYYYMMDD-HHMMSS-SHA` | `build-20250109-143022-a1b2c3d` | 30 days |
| Push to deploy | `test-YYYYMMDD-HHMMSS-SHA` | `test-20250109-143022-a1b2c3d` | 30 days |
| Pull Request | `pr-NUMBER-YYYYMMDD-HHMMSS-SHA` | `pr-42-20250109-143022-a1b2c3d` | 7 days |
| Release | Release tag | `v1.0.0` | 90 days |
| Manual | Custom or timestamp | `beta-1` or `build-...` | 30 days |

**GitHub Actions Features:**
- **On Push to Main:** Builds artifacts with timestamp version, uploads to GitHub Actions artifacts
- **On Push to Deploy Branch:** Builds test artifacts with `test-` prefix for testing the pipeline
- **On Pull Request:** Validates structure and templates, checks syntax, no AWS credentials required
- **On Release:** Builds artifacts with release tag version, attaches to GitHub release
- **Manual Dispatch:** Custom version naming with artifact validation

## 🛠️ Option 2: Manual Build & Deploy from Source

### Prerequisites

1. **AWS CLI configured**: `aws configure`
2. **Node.js & npm installed** (for building the Lambda function)
3. **For Terraform deployment**: Install [Terraform](https://terraform.io/downloads)

### Build Standalone Packages

```bash
# Build both CloudFormation and Terraform artifacts
./bin/package-artifacts.sh --version v1.0.0

# Build only CloudFormation
./bin/package-artifacts.sh --no-terraform --version v1.0.0
```

### One-Line Deployment

```bash
# CloudFormation deployment
./bin/deploy.sh --type cloudformation --deploy

# Terraform deployment
./bin/deploy.sh --type terraform --deploy
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

## Environment Variables

Configure the pipeline behavior with these environment variables:

```bash
export USE_S3_TABLES=true                    # Enable S3 Tables (default: false)
export GLUE_DATABASE_NAME=my-source-db       # Source database name
export S3TABLE_DATABASE_NAME=my-target-db    # Target database name  
export QUILT_CATALOG_DOMAIN=my.quilt.domain  # Quilt catalog domain
```

## 🔧 CloudFormation Parameter Overrides

### Available Parameters

The CloudFormation template accepts the following parameters with sensible defaults:

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| `UseS3Tables` | `false` | Enable S3 Tables instead of Glue Tables |
| `GlueDatabaseName` | `titanic-glue-db` | Source Glue database name for reading data |
| `S3TableDatabaseName` | `titanic-s3table-db` | Target S3 Tables database name for writing |
| `QuiltCatalogDomain` | `stable.quilttest.com` | Quilt catalog domain |
| `LambdaCodeBucket` | `titanic-lambda-deployments` | S3 bucket containing the Lambda deployment package |
| `LambdaCodeKey` | `lambda-package.zip` | S3 key for the Lambda deployment package |

### Override Examples

**Using AWS CLI:**
```bash
aws cloudformation create-stack \
  --stack-name my-titanic-pipeline \
  --template-body file://template.yaml \
  --parameters \
    ParameterKey=UseS3Tables,ParameterValue=true \
    ParameterKey=GlueDatabaseName,ParameterValue=my-source-db \
    ParameterKey=LambdaCodeBucket,ParameterValue=my-deployment-bucket \
  --capabilities CAPABILITY_IAM
```

**Using Parameter Files:**
Create a `parameters.json` file:
```json
[
  {
    "ParameterKey": "UseS3Tables",
    "ParameterValue": "true"
  },
  {
    "ParameterKey": "GlueDatabaseName", 
    "ParameterValue": "production-glue-db"
  },
  {
    "ParameterKey": "QuiltCatalogDomain",
    "ParameterValue": "prod.mycompany.com"
  },
  {
    "ParameterKey": "LambdaCodeBucket",
    "ParameterValue": "my-lambda-deployments"
  }
]
```

Then deploy:
```bash
aws cloudformation create-stack \
  --stack-name my-titanic-pipeline \
  --template-body file://template.yaml \
  --parameters file://parameters.json \
  --capabilities CAPABILITY_IAM
```

**Using Environment Variables (via deploy.sh):**
```bash
export USE_S3_TABLES=true
export GLUE_DATABASE_NAME=production-db
export QUILT_CATALOG_DOMAIN=prod.mycompany.com
export LAMBDA_CODE_BUCKET=my-deployment-bucket

./deploy.sh --stack-name my-production-pipeline
```

### Quick Start with Defaults

For testing or demo purposes, you can deploy with all defaults:

```bash
# 1. Upload the Lambda package to the default bucket
aws s3 cp lambda-package.zip s3://titanic-lambda-deployments/

# 2. Deploy with defaults
aws cloudformation create-stack \
  --stack-name test-titanic-pipeline \
  --template-body file://template.yaml \
  --capabilities CAPABILITY_IAM
```

**Important:** You must upload the Lambda package (`lambda-package.zip`) to your S3 bucket before deployment. The template cannot create Lambda functions without the deployment package.

### Environment-Specific Configurations

**Development Environment:**
```bash
aws cloudformation create-stack \
  --stack-name titanic-dev \
  --template-body file://template.yaml \
  --parameters \
    ParameterKey=GlueDatabaseName,ParameterValue=dev-glue-db \
    ParameterKey=QuiltCatalogDomain,ParameterValue=dev.quilt.company.com \
  --capabilities CAPABILITY_IAM
```

**Production Environment:**
```bash
aws cloudformation create-stack \
  --stack-name titanic-prod \
  --template-body file://template.yaml \
  --parameters \
    ParameterKey=UseS3Tables,ParameterValue=true \
    ParameterKey=GlueDatabaseName,ParameterValue=prod-glue-db \
    ParameterKey=S3TableDatabaseName,ParameterValue=prod-s3table-db \
    ParameterKey=QuiltCatalogDomain,ParameterValue=prod.quilt.company.com \
    ParameterKey=LambdaCodeBucket,ParameterValue=prod-lambda-deployments \
  --capabilities CAPABILITY_IAM
```

## Developer Workflows

### Testing the Pipeline

**Test on Deploy Branch:**
```bash
# Push to deploy branch to test artifact generation
git checkout -b deploy
git push origin deploy

# Creates test artifacts with validation
```

**Manual Workflows:**
```bash
# Go to Actions tab → Build and Validate Deployment Artifacts → Run workflow
# Builds and validates artifacts with custom version
```

**Manual Deployment Testing:**
```bash
# Download artifacts from GitHub Actions or releases
unzip titanic-cloudformation-v1.0.0.zip
cd cloudformation-v1.0.0
./deploy.sh  # Requires AWS credentials in your environment
```

### Scripts Reference

#### `bin/generate-templates.sh`
Core template generation script:
```bash
# Generate CloudFormation templates
./bin/generate-templates.sh --type cloudformation

# Generate Terraform templates  
./bin/generate-templates.sh --type terraform --output-dir ./my-templates
```

#### `bin/package-artifacts.sh`
Artifact packaging script (calls generate-templates.sh):
```bash
# Package all deployment artifacts
./bin/package-artifacts.sh --version v1.0.0

# Package only CloudFormation artifacts
./bin/package-artifacts.sh --no-terraform
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

artifacts/                         # Generated by package-artifacts.sh
├── titanic-cloudformation-v1.0.0.zip
├── titanic-terraform-v1.0.0.zip
├── cloudformation-v1.0.0/
└── terraform-v1.0.0/
```

## Monitoring and Troubleshooting

### Check GitHub Actions Status

```bash
# Get latest workflow runs
gh run list --workflow=build.yml

# Check specific run
gh run view <run-id>
```

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

5. **Build Failures in GitHub Actions**
   - Check Node.js version compatibility
   - Verify all dependencies are in `package.json`
   - Ensure TypeScript compiles successfully

### Cleanup

```bash
# CloudFormation
aws cloudformation delete-stack --stack-name titanic-ml-pipeline

# Terraform
cd templates/terraform
terraform destroy
```

### Artifact Cleanup

GitHub Actions automatically:
- Keeps last 10 build artifacts in GitHub Actions
- Release artifacts are retained for 90 days
- Main branch artifacts are retained for 30 days  
- PR artifacts are retained for 7 days

## Benefits of This Approach

### GitHub-First Distribution
- ✅ **Zero AWS setup for CI/CD** - Everything builds and validates in GitHub
- ✅ **Version controlled artifacts** - Immutable deployment packages
- ✅ **Download and deploy** - No source code needed for end users
- ✅ **Automatic validation** - CloudFormation and Terraform syntax checking

### Multiple Deployment Options
- ✅ **No CDK knowledge required**
- ✅ **Multiple IaC tool support** 
- ✅ **One-click deployment options**
- ✅ **Pre-compiled and tested templates**

### Standard Tools
- ✅ **Standard AWS deployment tools**
- ✅ **Proper error handling and validation**
- ✅ **Environment configuration support**

## Security Notes

- AWS credentials are only needed for manual deployment testing
- Consider using IAM roles instead of access keys for deployment
- All artifacts are stored in GitHub with appropriate retention policies
- Use private repositories for internal distribution

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

## Integration with CDK

The GitHub Actions complement your existing CDK workflow:

```bash
# Development (Template Generation)
./bin/generate-templates.sh --type cloudformation

# CI/CD (Artifact Packaging)  
./bin/package-artifacts.sh --version v1.0.0

# Staging/Production (Deployment)
./deploy.sh --stack-name my-stack
```

This provides clear separation of concerns:
- **generate-templates.sh** - Core template generation logic
- **package-artifacts.sh** - CI/CD artifact packaging (calls generate-templates.sh)  
- **deploy.sh** - Manual deployment (included in packaged artifacts)
