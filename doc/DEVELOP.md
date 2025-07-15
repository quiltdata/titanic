# Developer Guide - Titanic Data Lake Table Merger

This guide covers architecture, development workflow, testing, and deployment for developers.


## Development Workflow

### Setup

```bash
git clone https://github.com/quiltdata/titanic
cd titanic
cp env.example .env
# Edit .env with your configuration
npm install
```

### Building and Testing

```bash
npm run build              # Compile TypeScript
npm run test               # Run tests without coverage
npm run test:coverage      # Run tests with coverage report
npm run lint               # Run ESLint and fix issues
npm run test:watch         # Run tests in watch mode
```

### Local Development

```bash
npm run cdk                # Full deploy (test + deploy + event + logs)
npm run deploy:event       # Send manual merge event
npm run deploy:logs        # Monitor Lambda logs
npm run deploy:outputs     # Show stack outputs
```

### Release Management

```bash
npm run deploy:release -- --version v1.0.0  # Generate standalone package
npm run destroy            # Full cleanup and stack destruction
```

## Deployment Methods

### Method 1: CDK Deployment 

```bash
cp env.example .env
# Edit .env with required values
npm run cdk

# OR deploy with parameters
npx cdk deploy \
  --parameters AthenaDatabaseName=mydb \
  --parameters QuiltReadPolicyArn=arn:aws:iam::123456789012:policy/QuiltReadPolicy \
  --parameters UseS3Table=false
```

### Method 2: CloudFormation from Generated Template

```bash
# Generate release package
npm run deploy:release -- --version v1.0.0
cd dist/release-v1.0.0/

# Deploy with environment file
cp env.example .env
# Edit .env with your values
./deploy.sh

# OR deploy with parameters
./deploy.sh --athena-database-name mydb --quilt-read-policy-arn arn:aws:iam::123456789012:policy/QuiltReadPolicy
```

## Environment Variables

### Required for Deployment
```bash
ATHENA_DATABASE_NAME=your_database_name           #  Stack Athena database with per-bucket package/object views
QUILT_READ_POLICY_ARN=arn:aws:iam::123:policy/X  # Stack read-only policy (so we can add access to new buckets)
```

### Optional Configuration
```bash
USE_S3_TABLE=false          # Table format selection
AWS_DEFAULT_REGION=us-east-1
AWS_PROFILE=default
```

### Lambda Environment Variables (set by CDK stack)
```bash
GLUE_TABLES_BUCKET_ARN      # S3 bucket for Glue tables
S3_TABLES_BUCKET_ARN        # S3 Tables bucket
ATHENA_DATABASE_NAME          # Source database (and target, for Glue tables)
S3_TABLE_DATABASE_NAME      # S3 Tables database
```
## Architecture Overview

### Core Components

**Lambda Handler** (`merge-tables.ts`)
- EventBridge event processor and orchestrator
- First-run table dropping using sentinel files
- Error resilience with detailed reporting

**Table Manager** (`table-manager.ts`)
- Orchestrates table operations with format abstraction
- Runtime table format selection via `USE_S3_TABLE`
- Returns detailed creation/insertion statistics

**Table Classes**
- `PackageRevisionTable` - Package revision metadata
- `PackageTagTable` - Package tag associations  
- `PackageEntryTable` - Package file entries

### Table Format Support

**Glue Tables** (`USE_S3_TABLE=false` - Default)
- ACID transactions, schema evolution, time travel
- Single S3 bucket with Glue metadata
- CREATE TABLE AS SELECT (CTAS) operations

**S3 Tables** (`USE_S3_TABLE=true` - Experimental)
- AWS-native optimization, built-in partitioning
- Dual-bucket architecture (S3 Tables + Athena results)
- Empty table creation + separate INSERT operations

## Testing Strategy

### Test Structure
- **Unit Tests**: Individual table classes with both S3 and Glue modes
- **Integration Tests**: TableManager operations with statistics validation
- **Handler Tests**: End-to-end event processing with error scenarios

### Running Tests
```bash
npm test                    # Quick test run
npm run test:coverage       # Full coverage report
npm run test:fails          # Run only failed tests
npm run test:debug          # Debug mode with detailed output
```

### Test Patterns
```typescript
describe.each([
  ['Glue', false],
  ['S3 Tables', true]
])('%s mode', (modeName, useS3Table) => {
  // Test both formats with same assertions
});
```

## Error Handling

The system uses a "continue on error" approach:
- **S3 Access Denied**: Log error, continue with other buckets
- **Missing Tables**: Log warning, continue processing
- **Athena Failures**: Report error, continue with remaining operations

## Release Process

### GitHub Releases Strategy
- **Production releases**: `main` branch pushes or `v*` tags
- **Pre-releases**: `release` branch pushes (with `-rc.{run_number}`)
- **Validation only**: Pull requests (no releases)

### Creating Releases

**Production Release:**
```bash
git checkout main
git merge feature-branch
git push origin main
# OR create version tag:
git tag v1.2.0 && git push origin v1.2.0
```

**Pre-Release for Testing:**
```bash
git checkout release
git merge feature-branch
git push origin release
```

### Release Artifacts
Each release includes:
- CloudFormation template (`template.json`)
- Deployment script (`deploy.sh`)
- Lambda function assets (in `assets/`)
- Configuration template (`env.example`)
- Compressed archives (`.tar.gz` and `.zip`)

## Architecture Patterns

### Adding New Table Types

1. **Create table class**:
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

### Athena Query Execution

**S3 Tables Query Structure:**
```typescript
{
  QueryString: "SQL...",
  QueryExecutionContext: {
    Catalog: "s3tablescatalog/bucket-name",
    Database: "database_name"
  },
  ResultConfiguration: {
    OutputLocation: "s3://athena-results-bucket/athena-results/"
  }
}
```

**Glue Query Structure:**
```typescript
{
  QueryString: "SQL...",
  QueryExecutionContext: {
    Database: "database_name"
  },
  ResultConfiguration: {
    OutputLocation: "s3://target-bucket/athena-results/"
  }
}
```

## Performance & Monitoring

### Diagnostic Commands
```bash
# Check deployment
npm run deploy:outputs
aws cloudformation describe-stacks --stack-name TitanicStack

# Monitor resources  
aws s3 ls | grep titanic
aws glue get-tables --database-name $ATHENA_DATABASE_NAME

# Logs and debugging
npm run deploy:logs recent 30
npm run deploy:logs errors
npm run deploy:logs tail
```

### Common Development Issues

**"Cannot find bucket"**: CDK stack deployment failed
- Solution: Check `npm run deploy:outputs`, redeploy with `npm run cdk`

**"Permission denied"**: IAM/credentials issue
- Solution: Verify `QUILT_READ_POLICY_ARN`, check `aws sts get-caller-identity`

**Test failures**: Environment variable mismatch
- Solution: Ensure test environment matches deployment configuration

## Best Practices

- **Dual-mode testing**: Always test both Glue and S3 Tables formats
- **Error isolation**: Continue processing when individual operations fail
- **Resource cleanup**: Use `npm run destroy` for complete cleanup
- **Version management**: Use semantic versioning for releases
- **Documentation**: Update both README.md and this file for changes
