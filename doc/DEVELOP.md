# Developer Guide - Titanic Data Lake Table Merger

This guide covers the internal architecture, development patterns, and extension points for the Titanic project.

## Documentation Structure

- **README.md** - Essential user information, deployment, and basic usage
- **doc/DEVELOP.md** (this file) - Developer architecture, patterns, and extension points
- **doc/schema.sql** - Complete SQL schema reference for both table formats
- **doc/SCHEMA.md** - Schema design decisions and motivation


## Usage

### Prerequisites

- Node.js 18.x or later
- AWS CLI configured
- AWS CDK CLI (`npm install -g aws-cdk`)


### Environment Configuration

Before deploying or running the project, configure the required environment variables. Copy the provided `example.env` file as a template:

```bash
cp example.env .env
```

Edit the `.env` file to include your specific configuration:

```env
# AWS Configuration
AWS_DEFAULT_REGION=us-east-2
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
CDK_DEFAULT_ACCOUNT=your-account-id
CDK_DEFAULT_REGION=$AWS_DEFAULT_REGION

# Project Configuration
QUILT_CATALOG_DOMAIN=your-stacks-catalog-dns
QUILT_DATABASE_NAME=your-stacks-glue-database-name
QUILT_READ_POLICY_ARN=arn:aws:iam::$CDK_DEFAULT_ACCOUNT:policy/STACK-BucketReadPolicy-XXXX
```

### Quick Start

1.  Load the environment variables:

```bash
source .env
```

2. If you haven't already, you must bootstrap CDK for each region you use it in:

```bash
cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
```

3. Install dependencies:

```bash
npm install
```


4. Deploy:

This will run tests and deploy the stack to your AWS account:

```bash
npm run deploy:local
```

For a complete deployment with event triggering and log monitoring:

```bash
npm run deploy:full
```

This will:
a. run the tests
b. create the CloudFormation template
c. push it to your AWS account
d. send an event to merge tables from every bucket in your stack
e. show recent logs

> **Note**: For standalone deployment packages or infrastructure templates, see the [Development Scripts](#development-scripts) section below.

## Development Scripts

The project includes several npm scripts organized by function:

### Template Generation Scripts

Generate standalone infrastructure templates for CloudFormation and Terraform deployments:

```bash
# Generate CloudFormation template only
npm run template:cloudformation

# Generate Terraform templates only  
npm run template:terraform

# Generate both CloudFormation and Terraform templates
npm run deploy:templates
```

These scripts use `./bin/generate-templates.sh` and create:
- `templates/titanic-cloudformation.yaml` - Complete CloudFormation template
- `templates/terraform/` - Complete Terraform module (main.tf, variables.tf, outputs.tf)

### Artifact Packaging Scripts

Create standalone deployment packages for distribution:

```bash
# Package all artifacts (CloudFormation + Terraform + Lambda ZIP)
npm run package:artifacts

# Package only CloudFormation artifacts
npm run package:cf

# Package only Terraform artifacts  
npm run package:tf

# Package with custom version
npm run deploy:package -- v1.2.3
```

### Artifact Validation Scripts

Validate generated deployment packages:

```bash
# Validate latest artifacts (auto-detect version)
npm run validate:artifacts

# Validate specific version
./bin/validate-artifacts.sh --version v1.2.3

# Validate only CloudFormation artifacts
./bin/validate-artifacts.sh --version v1.2.3 --no-terraform --no-zip

# Combined build and validate
npm run build:release -- v1.2.3
```

These scripts use `./bin/package-artifacts.sh` and create:
- `artifacts/cloudformation-{version}/` - CloudFormation deployment package
- `artifacts/terraform-{version}/` - Terraform deployment package
- `artifacts/titanic-{type}-{version}.zip` - ZIP archives for distribution
- `artifacts/deployment-summary-{version}.md` - Deployment guide

Each package includes:
- Infrastructure templates
- Lambda function code (`lambda-package.zip`)
- Deployment script (`deploy.sh`) with CLI arguments
- README with usage instructions

### Script Options and Examples

The underlying shell scripts support various options:

**Template Generation:**
```bash
# Custom output directory
./bin/generate-templates.sh --type terraform --output-dir ./my-templates

# Force rebuild Lambda package
./bin/generate-templates.sh --type cloudformation --force-rebuild
```

**Artifact Packaging:**
```bash
# Skip ZIP creation (folders only)
./bin/package-artifacts.sh --no-zip

# Custom version identifier
./bin/package-artifacts.sh --version "release-2024-01"

# Build only specific type
./bin/package-artifacts.sh --no-terraform  # CloudFormation only
./bin/package-artifacts.sh --no-cloudformation  # Terraform only
```

**Artifact Validation:**
```bash
# Validate specific version
./bin/validate-artifacts.sh --version v1.0.0

# Validate only CloudFormation artifacts
./bin/validate-artifacts.sh --version v1.0.0 --no-terraform --no-zip

# Auto-detect and validate latest artifacts
./bin/validate-artifacts.sh --auto-detect
```

### Use Cases

**For Development:**
- Use `npm run templates:all` to generate templates for testing
- Use `npm run package:artifacts` to create deployment packages for QA

**For Distribution:**
- Use versioned packaging: `npm run deploy:package -- v1.0.0`
- Share the generated ZIP files with end users who need standalone deployment

**For CI/CD:**
- Integrate `npm run deploy:package -- v1.0.0` into build pipelines
- Use `./bin/validate-artifacts.sh --version v1.0.0` for validation
- Archive the `artifacts/` directory as build artifacts

### Simplified CI/CD Workflow

The GitHub Actions workflow has been streamlined using these npm scripts:

```yaml
# Before (complex shell commands)
- name: Build artifacts
  run: |
    chmod +x bin/package-artifacts.sh
    ./bin/package-artifacts.sh --version "${{ steps.version.outputs.version }}"

- name: Validate CloudFormation artifacts  
  run: |
    VERSION="${{ steps.version.outputs.version }}"
    CF_DIR="artifacts/cloudformation-${VERSION}"
    test -f "${CF_DIR}/template.yaml" || { echo "Missing template.yaml"; exit 1; }
    # ... many more validation steps

# After (simple npm scripts)
- name: Build deployment artifacts
  run: npm run deploy:package -- "${{ steps.version.outputs.version }}"

- name: Validate deployment artifacts
  run: ./bin/validate-artifacts.sh --version "${{ steps.version.outputs.version }}"
```

This approach provides:
- **Consistent execution** across different environments
- **Simplified maintenance** with logic in dedicated scripts
- **Better error handling** and user feedback
- **Reusable commands** for local development

## Architecture

### Core Components

The system is built with a modular architecture supporting dual table formats:

#### Lambda Handler (`merge-tables.ts`)
- **Purpose**: EventBridge event processor and orchestrator
- **Key Features**: 
  - First-run table dropping using sentinel files
  - Event parsing for bucket-specific and "all buckets" modes
  - Error resilience with detailed reporting
  - Statistics collection and reporting

#### Table Manager (`table-manager.ts`)
- **Purpose**: Orchestrates table operations with format abstraction
- **Key Methods**:
  - `ensureTablesExist()`: Returns detailed creation statistics
  - `executeInserts()`: Returns detailed insertion statistics
- **Dual Mode Support**: Runtime table format selection via `USE_S3_TABLE`

#### Table Classes
Each table type has a dedicated class with format-specific implementations:

- `PackageRevisionTable` - Package revision metadata
- `PackageTagTable` - Package tag associations  
- `PackageEntryTable` - Package file entries

**Common Interface**:
```typescript
interface TableInterface {
  createTableSQL(useS3Table: boolean): string;
  insertSQL(registry: string): string;
}
```

### Table Format Modes

The system supports two distinct table storage formats that can be selected at deployment time:

- S3 Tables mode stores the catalog metadata directly in a specialized S3 Tables bucket
- Glue mode uses the AWS Glue Data Catalog to define the tables

We always create one target bucket for each mode.  
S3 Tables mode always writes Athena query results to the standard bucket.
We pass in the existing (source) database, which is also where we create Glue tables.

On first run we drop both tables (if they exist),
then create the tables.
We always read from the existing views in the Glue Catalog,
but may write the S3 Tables Catalog if USE_S3_TABLE is set.

#### Glue Tables (`USE_S3_TABLE=false`)
- **Implementation**: CREATE TABLE AS SELECT (CTAS) with Glue catalog
- **Benefits**: ACID transactions, schema evolution, time travel
- **Storage**: Single S3 bucket with Glue metadata
- **Partitioning**: Glue-managed with bucketing functions

#### S3 Tables (`USE_S3_TABLE=true`)
- **Implementation**: Empty table creation + separate INSERT operations using AWS S3 Tables managed catalog
- **Benefits**: AWS-native optimization, built-in partitioning
- **Storage**: Dual-bucket architecture:
  - S3 Tables bucket (ARN format) for table data
  - Regular S3 bucket for Athena query results
- **Partitioning**: Manual PARTITIONED BY clauses
- **Athena Queries**: Uses `s3tablescatalog/{bucket-name}` catalog specification

### Error Handling Strategy

The system implements a "continue on error" approach:

1. **S3 Access Denied**: Log error, continue with other buckets
2. **Missing Tables**: Log warning, continue processing
3. **Athena Query Failures**: Report error, continue with remaining operations
4. **Individual Table Failures**: Track per-table failures, continue with other tables

This ensures maximum data processing even when some sources are unavailable.

## Development Patterns

### Adding New Table Types

1. **Create table class** implementing the standard interface:
```typescript
export class NewTable {
  createTableSQL(useS3Table: boolean): string {
    if (useS3Table) {
      return `CREATE TABLE ${this.tableName} (...) PARTITIONED BY (...)`;
    } else {
      return `CREATE TABLE ${this.tableName} WITH (...) AS SELECT ...`;
    }
  }
  
  insertSQL(registry: string): string {
    return `INSERT INTO ${this.tableName} SELECT ...`;
  }
}
```

2. **Register in TableManager**:
```typescript
this.tables = [
  new PackageRevisionTable(database),
  new PackageTagTable(database),
  new PackageEntryTable(database),
  new NewTable(database), // Add here
];
```

3. **Add tests** following existing patterns in `table-manager.test.ts`

### Testing Strategy

The test suite covers both table formats comprehensively:

#### Test Structure
- **Unit Tests**: Individual table classes with both S3 and Glue modes
- **Integration Tests**: TableManager operations with statistics validation
- **Handler Tests**: End-to-end event processing with error scenarios

#### Test Patterns
```typescript
describe('Table operations', () => {
  describe.each([
    ['Glue', false],
    ['S3 Tables', true]
  ])('%s mode', (modeName, useS3Table) => {
    // Test both formats with same assertions
  });
});
```

#### Key Test Areas
- Table creation SQL generation for both formats
- Statistics collection and validation
- Error handling and resilience
- Sentinel file behavior
- Event parsing edge cases

### Extension Points

#### Custom Table Formats
To add support for additional table formats:

1. Extend the `useS3Table` parameter to support more options
2. Update table classes to handle new format in `createTableSQL()`
3. Add format-specific logic in TableManager

#### Custom Event Sources
To support additional event sources beyond EventBridge:

1. Create new handler functions in `merge-tables.ts`
2. Add event parsing logic for new format
3. Ensure bucket extraction works with new event structure

#### Custom Error Handling
To customize error handling behavior:

1. Update `processAllBuckets()` in merge-tables.ts
2. Modify error logging and statistics collection
3. Adjust continuation logic based on error types

## Code Quality

### TypeScript Patterns
- **Strict typing**: All functions have explicit return types
- **Error types**: Custom error classes for different failure modes
- **Async/await**: Consistent async pattern throughout
- **Interface segregation**: Clean separation between table concerns

### Testing Requirements
- **Dual mode coverage**: All table operations tested in both formats
- **Error scenarios**: Comprehensive error handling validation
- **Statistics validation**: Detailed assertion of operation metrics
- **Mock isolation**: Clean mocking without test interference

### Performance Considerations
- **Parallel operations**: Table creation and insertion can run concurrently
- **Error isolation**: Failures in one table don't block others
- **Resource cleanup**: Proper AWS resource management
- **Query optimization**: Efficient SQL generation for both formats

## Deployment

### Environment Variables
Key configuration for developers:

```bash
# Table format selection
USE_S3_TABLE=false  # Core functionality toggle

# AWS configuration
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-2
QUILT_DATABASE_NAME=your_database

# S3 Tables specific (when USE_S3_TABLE=true)
ATHENA_RESULTS_BUCKET=athena-results-bucket  # Separate bucket for query results

# Development/testing
NODE_ENV=development
AWS_PROFILE=your-profile
```

### CDK Infrastructure
The infrastructure is defined in TypeScript with:
- **Lambda function** with configurable environment variables
- **EventBridge rule** for event triggering
- **IAM roles** with minimal required permissions
- **CloudWatch logs** for monitoring and debugging
- **Dual S3 buckets** (S3 Tables mode): S3 Tables bucket + Athena results bucket
- **Single S3 bucket** (Glue mode): Combined storage for tables and results

### Deployment Steps
1. **Configure environment**: Set all required variables
2. **Bootstrap CDK**: `cdk bootstrap` (first time only)
3. **Deploy stack**: `npm run cdk`
4. **Verify deployment**: Check Lambda and SQS resources
5. **Test functionality**: Use npm scripts to trigger events

## Monitoring and Debugging

### CloudWatch Logs
Lambda logs include:
- **Operation statistics**: Tables created, rows inserted, errors encountered
- **Error details**: Specific failure reasons with context
- **Performance metrics**: Query execution times and resource usage
- **Table mode indicators**: Which format is being used

### Debugging Tips
1. **Check environment variables** in Lambda console (especially `ATHENA_RESULTS_BUCKET` for S3 Tables)
2. **Verify source views** exist in Glue Data Catalog
3. **Monitor Athena queries** in AWS console for SQL issues
4. **Review IAM permissions** if access denied errors occur
5. **Test with npm scripts** for isolated debugging
6. **Validate S3 Tables ARN format** if using S3 Tables mode
7. **Check dual-bucket setup** for S3 Tables deployments

### Performance Monitoring
- **Query execution time**: Monitor Athena query performance
- **Lambda duration**: Track function execution time
- **Error rates**: Monitor failure patterns by bucket/table
- **Resource utilization**: Check Lambda memory and timeout usage

## Best Practices

### Code Organization
- **Single responsibility**: Each class handles one table type
- **Configuration injection**: Environment variables passed down through constructors
- **Error boundaries**: Clear error handling at each level
- **Testable design**: Easy mocking and isolated testing

### SQL Generation
- **Format-specific logic**: Clear separation between S3 and Glue SQL
- **Parameterized queries**: Safe registry and bucket name handling
- **Consistent naming**: Predictable table and column naming conventions
- **Partitioning strategy**: Optimized for query performance

### Error Management
- **Graceful degradation**: Continue processing on non-fatal errors
- **Detailed logging**: Sufficient context for debugging
- **User feedback**: Clear error messages in responses
- **Retry logic**: Appropriate retry strategies for transient failures

### Athena Query Execution

The system executes Athena queries differently based on table format:

#### S3 Tables Query Structure
```typescript
{
  QueryString: "DROP TABLE IF EXISTS ...",
  QueryExecutionContext: {
    Catalog: "s3tablescatalog/bucket-name",  // Extracted from S3 Tables ARN
    Database: "database_name"
  },
  ResultConfiguration: {
    OutputLocation: "s3://athena-results-bucket/athena-results/"  // Separate bucket
  }
}
```

#### Glue Query Structure
```typescript
{
  QueryString: "DROP TABLE IF EXISTS ...",
  QueryExecutionContext: {
    Database: "database_name"  // No catalog specification needed
  },
  ResultConfiguration: {
    OutputLocation: "s3://target-bucket/athena-results/"  // Same bucket as Glue tables
  }
}
```

#### ARN Handling for S3 Tables
- S3 Tables buckets use ARN format: `arn:aws:s3tables:region:account:bucket/bucket-name`
- The system extracts the bucket name from the ARN for catalog specification
- Query results are stored in a separate regular S3 bucket (`ATHENA_RESULTS_BUCKET`)

## Standalone Deployment Packaging

### Overview

The project includes automated packaging scripts that create standalone deployment artifacts for distribution to end users who don't need the full development environment.

### Generated Artifacts

#### CloudFormation Package (`artifacts/cloudformation-{version}/`)
- `titanic-cloudformation.yaml` - Complete CloudFormation template
- `lambda-package.zip` - Lambda function deployment package  
- `deploy.sh` - Interactive deployment script with parameter validation
- `README.md` - User-friendly deployment instructions

#### Terraform Package (`artifacts/terraform-{version}/`)
- `main.tf` - Main infrastructure configuration
- `variables.tf` - Input variables with defaults and validation
- `outputs.tf` - Stack outputs (ARNs, bucket names, etc.)
- `lambda-package.zip` - Lambda function deployment package
- `deploy.sh` - Interactive deployment script with plan/apply/destroy
- `README.md` - User-friendly deployment instructions

#### Distribution Archives
- `titanic-cloudformation-{version}.zip` - CloudFormation package archive
- `titanic-terraform-{version}.zip` - Terraform package archive
- `deployment-summary-{version}.md` - Overview document for users

### Packaging Process

The packaging system works in stages:

1. **Build Phase**: Compiles TypeScript and creates Lambda deployment package
2. **Template Generation**: Uses `generate-templates.sh` to create infrastructure templates
3. **Artifact Assembly**: Copies templates, Lambda package, and creates deployment scripts
4. **Documentation**: Generates user-friendly README files and deployment guides
5. **Archive Creation**: Creates ZIP files for easy distribution

### Deployment Scripts Features

The generated deployment scripts provide:
- **Parameter validation** with helpful error messages
- **AWS CLI availability checks** and credential validation
- **Interactive parameter input** with sensible defaults
- **Colored output** for better user experience
- **Stack output display** after successful deployment
- **Cleanup instructions** and troubleshooting tips

#### CloudFormation Deploy Script Options
```bash
./deploy.sh --stack-name my-titanic \
           --region us-west-2 \
           --use-s3-tables \
           --glue-db my-glue-db \
           --s3table-db my-s3table-db
```

#### Terraform Deploy Script Options
```bash
./deploy.sh --stack-name my-titanic \
           --region us-west-2 \
           --use-s3-tables \
           --auto-approve

# Destroy infrastructure
./deploy.sh destroy --auto-approve
```

### Distribution Workflow

For creating release packages:

1. **Version the release**:
   ```bash
   npm run deploy:package -- v2.1.0
   ```

2. **Verify artifacts**:
   ```bash
   ls -la artifacts/
   # Should show both ZIP files and deployment summary
   ```

3. **Test deployment** (recommended):
   ```bash
   cd artifacts/cloudformation-v2.1.0/
   ./deploy.sh --stack-name test-deploy
   ```

4. **Distribute ZIP files** to end users via:
   - GitHub releases
   - S3 bucket downloads
   - Internal artifact repositories
   - Documentation websites

### End User Experience

Users receive:
- **Single ZIP file** containing everything needed
- **No development dependencies** required (no Node.js, TypeScript, etc.)
- **Clear documentation** with examples and troubleshooting
- **Interactive deployment** with guided parameter input
- **AWS CLI only requirement** (CloudFormation) or **Terraform CLI** (Terraform)

Example user workflow:
```bash
# Download and extract
wget https://releases.example.com/titanic-cloudformation-v2.1.0.zip
unzip titanic-cloudformation-v2.1.0.zip
cd cloudformation-v2.1.0/

# Deploy with defaults
./deploy.sh

# Or deploy with custom parameters
./deploy.sh --stack-name production-titanic --use-s3-tables
```

This packaging approach enables:
- **Wide distribution** without requiring development setup
- **Version control** of deployment artifacts
- **Consistent deployments** across different environments
- **Reduced support burden** through automated scripts and clear documentation
