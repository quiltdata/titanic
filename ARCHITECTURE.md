# Titanic - AWS Data Lake Table Merger

## Overview
Titanic is a modular AWS CDK application that manages Iceberg tables in an AWS Data Lake. It processes EventBridge events to merge data from source S3 tables into consolidated Iceberg tables.

## Architecture

### Core Components
- **Lambda Handler** (`merge-tables.ts`) - EventBridge event processor
- **Table Manager** (`table-manager.ts`) - Orchestrates table operations
- **Table Classes** - Specialized classes for each table type:
  - `PackageRevisionTable` - Manages package revision data
  - `PackageTagTable` - Manages package tag data
  - `PackageEntryTable` - Manages package entry data
- **Shared Utilities** - Common functionality for Athena and AWS operations

### Event Flow
1. EventBridge event received with package details
2. Handler extracts bucket and table information
3. TableManager ensures target tables exist (creates if needed)
4. Data is merged from source views to target Iceberg tables
5. Response indicates success and number of tables processed

## Table Schema

### package_revision
- **Purpose**: Stores package revision metadata
- **Partitioning**: `registry`, `bucket(8, pkg_name)`, `bucket(8, top_hash)`
- **Key Fields**: `registry`, `pkg_name`, `top_hash`, `timestamp`, `message`, `metadata`

### package_tag
- **Purpose**: Stores package tag associations
- **Partitioning**: `registry`, `tag_name`, `bucket(8, pkg_name)`
- **Key Fields**: `registry`, `pkg_name`, `tag_name`, `top_hash`

### package_entry
- **Purpose**: Stores package file entries
- **Partitioning**: `registry`, `bucket(64, physical_key)`
- **Key Fields**: `registry`, `top_hash`, `logical_key`, `physical_key`, `multihash`, `size`, `metadata`

## Code Organization

### Modular Structure
```
lib/
├── merge-tables.ts           # Main handler
├── shared/
│   ├── athena-utils.ts       # AWS Athena utilities
│   ├── types.ts              # Shared type definitions
│   └── test-utils.ts         # Common test utilities
└── tables/
    ├── base-table.ts         # Common table operations
    ├── table-manager.ts      # Table orchestration
    ├── package-revision.ts   # Package revision table
    ├── package-tag.ts        # Package tag table
    └── package-entry.ts      # Package entry table
```

### Co-located Tests
Each module has its test file in the same directory:
- `*.test.ts` files contain unit tests for the corresponding module
- Integration tests are in `merge-tables.test.ts`
- CDK stack tests are in `titanic-stack.test.ts`

## Error Handling

### Retry Logic
- Athena queries include retry with exponential backoff
- Failed queries are retried up to 3 times by default
- Configurable retry delays and maximum attempts

### Validation
- Environment variables validated on startup
- Table context validated before operations
- Basic SQL injection protection for queries

### Error Types
- `TableOperationError` - Table-specific operation failures
- Environment validation errors with detailed messages
- AWS service errors with context preservation

## Configuration

### Environment Variables
- `DATABASE_NAME` - Athena database name (required)
- `TARGET_BUCKET` - S3 bucket for table storage (required)
- `LAMBDA_TIMEOUT` - Lambda timeout in milliseconds (optional)
- `QUEUE_URL` - SQS queue URL (optional)
- `QUILT_READ_POLICY_ARN` - IAM policy for source bucket access (optional)

### CDK Stack Props
```typescript
interface TitanicStackProps {
    quiltDatabaseName: string;
    quiltReadPolicyArn: string;
    lambdaTimeout?: number;
}
```

## Best Practices Implemented

### Code Quality
- ✅ **Modular Design** - Each table type has its own class
- ✅ **Co-located Tests** - Tests are next to the code they test
- ✅ **Shared Utilities** - Common functionality extracted to shared modules
- ✅ **Type Safety** - Comprehensive TypeScript types
- ✅ **Error Handling** - Robust error handling with retries

### Performance
- ✅ **Iceberg Format** - Efficient columnar storage
- ✅ **Partitioning** - Strategic partitioning for query performance
- ✅ **Deduplication** - Prevents duplicate data insertion
- ✅ **Parallel Processing** - Tables processed concurrently when possible

### Maintainability
- ✅ **Clear Separation of Concerns** - Handler, tables, and utilities
- ✅ **Consistent Patterns** - All table classes follow same structure
- ✅ **Comprehensive Testing** - Unit and integration tests
- ✅ **Documentation** - Code comments and architecture docs

## Testing

### Running Tests
```bash
npm test                    # Run all tests
npm test -- --watch       # Run tests in watch mode
npm test merge-tables      # Run specific test file
```

### Test Coverage
- **Unit Tests** - Each table class and utility module
- **Integration Tests** - End-to-end handler functionality
- **CDK Tests** - Infrastructure configuration validation

### Test Structure
- Mocked AWS services for isolated testing
- Common test utilities to reduce duplication
- Parameterized tests for similar functionality

## Deployment

### Prerequisites
- AWS CLI configured
- Node.js 18+ installed
- CDK CLI installed (`npm install -g aws-cdk`)

### Commands
```bash
npm install                # Install dependencies
npm run build             # Compile TypeScript
cdk synth                 # Generate CloudFormation
cdk deploy               # Deploy to AWS
```

## Monitoring and Observability

### CloudWatch Logs
- Lambda execution logs with detailed operation traces
- Athena query execution tracking
- Error logs with full context

### Metrics
- Number of tables processed per invocation
- Query execution duration
- Success/failure rates

## Future Enhancements

### Potential Improvements
- [ ] Schema evolution support for table migrations
- [ ] Batch processing for multiple events
- [ ] Dead letter queue for failed events
- [ ] CloudWatch dashboards for monitoring
- [ ] Cross-region replication support

### Extensibility
The modular design allows for easy addition of:
- New table types by extending base patterns
- Additional data sources beyond S3
- Custom partitioning strategies
- Enhanced validation rules
