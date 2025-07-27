# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run test` - Run tests without coverage
- `npm run test:coverage` - Run tests with coverage report  
- `npm run test:watch` - Run tests in watch mode
- `npm run test:fails` - Run only failing tests
- `npm run test:debug` - Run tests with debug info (no coverage, sequential)
- `npm run lint` - Run ESLint and fix issues

### Single Test Execution
Use Jest directly: `npx jest path/to/test.test.ts` or `npx jest --testNamePattern="specific test name"`

### Build and Deployment
- `npm run cdk` - Full deploy pipeline (test + deploy + event + logs)
- `npm run cdk:synth` - Generate CloudFormation template for local stack
- `npm run cdk:external` - Generate CloudFormation template for external deployment
- `npm run deploy:event` - Send manual merge event to trigger Lambda
- `npm run deploy:logs` - Monitor Lambda logs (use `recent N` or `errors` args)
- `npm run deploy:outputs` - Show CloudFormation stack outputs

### Asset Management
- `npm run deploy:upload` - Build and upload Lambda assets to public S3 bucket
- `npm run deploy:release` - Generate standalone deployment package in dist/
- `npm run deploy:verify-assets` - Check if assets exist in public bucket

### S3 Tables Management
- `npm run s3tables:create` - Create all S3 Tables resources
- `npm run s3tables:namespace` - Create S3 Tables namespace only
- `npm run s3tables:tables` - Create S3 Tables tables only

## Architecture

Titanic is a serverless AWS data lake table merger that consolidates Quilt package metadata from multiple S3 buckets into unified Iceberg tables queryable through Athena.

### Core Components

**Lambda Function** (`lib/merge-tables.ts`): Event-driven processor that merges per-bucket package tables into centralized Iceberg catalog. Triggered by EventBridge package-revision events.

**Table Management System**:
- `TableManager` (`lib/tables/table-manager.ts`) - Central orchestrator for all table operations
- `BaseTable` (`lib/tables/base-table.ts`) - Abstract base providing common functionality
- `PackageRevisionTable` - Maps package names to timestamps, top_hash, and metadata
- `PackageTagTable` - Manages named versions (like `latest`)
- `PackageEntryTable` - Tracks individual files within packages with content hashes

**CDK Infrastructure**:
- `TitanicStack` (`lib/titanic-stack.ts`) - Main stack defining all AWS resources
- `bin/titanic.ts` - Local development stack with deployment config generation
- `bin/titanic-external.ts` - External deployment stack with configurable parameters

**Configuration**: Supports both Glue and S3 Tables modes via `Config` class (`lib/shared/config.ts`). Mode controlled by `USE_S3_TABLE` environment variable.

### Deployment Modes

**Local Development**: Uses CDK for direct AWS deployment with full control over resources.

**External Distribution**: Generates standalone CloudFormation templates with pre-built Lambda assets hosted in public S3 bucket. Includes complete deployment package with scripts and documentation.

### Table Schema

Creates three normalized Iceberg tables:
- **Package Revisions**: Specific package versions with metadata
- **Package Tags**: Named versions pointing to revisions  
- **Package Entries**: Individual files within packages with content hashes

See `doc/schema.md` for detailed schema design.

## Configuration

Environment variables loaded from `.env` file (copy from `env.example`):
- `QUILT_READ_POLICY_ARN` - IAM policy for cross-bucket access
- `ATHENA_DATABASE_NAME` - Target database name
- `USE_S3_TABLE` - Enable S3 Tables mode (vs Glue tables)
- AWS region and account settings

## Code Quality

**Always run linting before committing**: Use `npm run lint` to check and fix ESLint issues. The project uses TypeScript ESLint with strict rules.

**Address all diagnostic warnings**: Pay attention to TypeScript compiler warnings and ESLint diagnostics in your editor. Resolve all issues before considering code complete.

**ESLint Configuration**: 
- Strict TypeScript rules with some relaxations for test files
- Unused variables allowed if prefixed with underscore (`_`)
- Special rules for `create-s3-tables.ts` utility script

## Git and Commits

**Always ask to create a commit** after implementing a significant change, and (if there are uncommitted changes) before doing something new.

**When creating commits** (if requested):
- Use descriptive commit messages that explain the "why" not just the "what"
- Run `npm run test` before committing to ensure all tests pass
- Include `🤖 Generated with [Claude Code](https://claude.ai/code)` footer
- Follow the existing commit message style (check `git log` for examples)

## Testing

Jest configuration in `jest.config.js` with TypeScript support. Test files use `*.test.ts` pattern. Coverage reports generated in `coverage/` directory.

Special ESLint rules for test files allow more lenient typing and unused variables with underscore prefix.