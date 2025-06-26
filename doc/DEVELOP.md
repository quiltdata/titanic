# Developer Guide - Titanic Data Lake Table Merger

This guide covers the internal architecture, development patterns, and extension points for the Titanic project.

## Documentation Structure

- **README.md** - Essential user information, deployment, and basic usage
- **doc/DEVELOP.md** (this file) - Developer architecture, patterns, and extension points
- **doc/schema.sql** - Complete SQL schema reference for both table formats
- **doc/schema.md** - Schema design decisions and motivation
- **doc/CONTEXT_MANAGEMENT_REVIEW.md** - Context flow analysis and improvements

**Deprecated**: `ARCHITECTURE.md`, `TABLE_CONFIGURATION.md`, `USE_S3_TABLE.md` have been consolidated into the above files.

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

#### Iceberg Tables (`USE_S3_TABLE=false`)
- **Implementation**: CREATE TABLE AS SELECT (CTAS) with Iceberg format
- **Benefits**: ACID transactions, schema evolution, time travel
- **Storage**: Single S3 bucket with Iceberg metadata
- **Partitioning**: Iceberg-managed with bucketing functions

#### S3 Tables (`USE_S3_TABLE=true`)
- **Implementation**: Empty table creation + separate INSERT operations
- **Benefits**: AWS-native optimization, built-in partitioning
- **Storage**: S3 Tables service + regular S3 bucket
- **Partitioning**: Manual PARTITIONED BY clauses

### Error Handling Strategy

The system implements a "continue on error" approach:

1. **S3 Access Denied**: Log error, continue with other buckets
2. **Missing Tables**: Log warning, continue processing
3. **Athena Query Failures**: Report error, continue with remaining operations
4. **Individual Table Failures**: Track per-table failures, continue with other tables

This ensures maximum data processing even when some sources are unavailable.

### Context Management

See [CONTEXT_MANAGEMENT_REVIEW.md](CONTEXT_MANAGEMENT_REVIEW.md) for detailed analysis of context flow improvements implemented in this refactor.

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
- **Unit Tests**: Individual table classes with both S3 and Iceberg modes
- **Integration Tests**: TableManager operations with statistics validation
- **Handler Tests**: End-to-end event processing with error scenarios

#### Test Patterns
```typescript
describe('Table operations', () => {
  describe.each([
    ['Iceberg', false],
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

# Development/testing
NODE_ENV=development
AWS_PROFILE=your-profile
```

### CDK Infrastructure
The infrastructure is defined in TypeScript with:
- **Lambda function** with configurable environment variables
- **SQS queue** for event triggering
- **IAM roles** with minimal required permissions
- **CloudWatch logs** for monitoring and debugging

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
1. **Check environment variables** in Lambda console
2. **Verify source views** exist in Glue Data Catalog
3. **Monitor Athena queries** in AWS console for SQL issues
4. **Review IAM permissions** if access denied errors occur
5. **Test with npm scripts** for isolated debugging

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
- **Format-specific logic**: Clear separation between S3 and Iceberg SQL
- **Parameterized queries**: Safe registry and bucket name handling
- **Consistent naming**: Predictable table and column naming conventions
- **Partitioning strategy**: Optimized for query performance

### Error Management
- **Graceful degradation**: Continue processing on non-fatal errors
- **Detailed logging**: Sufficient context for debugging
- **User feedback**: Clear error messages in responses
- **Retry logic**: Appropriate retry strategies for transient failures

This architecture enables reliable, scalable data lake table management with flexibility for future enhancements and table format evolution.
