# Developer Guide - Titanic Data Lake Table Merger
This guide covers the complete development workflow from local development to releasing.

## 1. Local Development

**Setup**:
```bash
git clone https://github.com/quiltdata/titanic
cd titanic
cp env.example .env
# Edit .env with your configuration
npm install
```

**Testing and Development**:
```bash
npm run test               # Run tests without coverage
npm run test:coverage      # Run tests with coverage report
npm run lint               # Run ESLint and fix issues
npm run test:watch         # Run tests in watch mode
```

## 2. Local Deployment

**Deploy to AWS for testing**:
```bash
npm run cdk                # Full deploy (test + deploy + event + logs)
npm run deploy:event       # Send manual merge event
npm run deploy:logs        # Monitor Lambda logs
npm run deploy:outputs     # Show stack outputs
```

## 3. Uploading Assets

**Build and upload Lambda assets** (required before releases):
```bash
npm run deploy:upload -- --dry-run       # Show what would be uploaded (preview)
npm run deploy:upload                    # Build and upload assets to public bucket (includes CDK synthesis)
npm run deploy:upload --  --verify-only  # Check if assets exist in bucket
```

## 4. Testing Release

**Generate and test release packages**:
```bash
npm run deploy:release  # Generate standalone package
cd dist/release/

# Test CloudFormation deployment
cp env.example .env
# Edit .env with your values
./deploy.sh
```

## 5. Tagging a (Pre)Release

**Production Release**:
```bash
git checkout main
npm run deploy:tag
```

**Pre-Release for Testing**:
```bash
git checkout feature-branch
npm run deploy:tag:prerelease
```

Release artifacts are available on [GitHub](https://github.com/quiltdata/titanic/releases)
and include a README and a self-contained deployment script, along with required assets.

## 6. Architecture Overview

The Titanic project is a serverless AWS CDK application that compiles Quilt's per-bucket package tables into a central Iceberg catalog.
It also exports the resulting CloudFormation template into a self-contained deployment, with assets available in a public bucket.

The key concepts and classes are:

### A. Merge Tables Lambda

A Lambda function triggered by package-revision events on EventBrdige that merges per-bucket package tables into a unified Iceberg table. It handles reading, merging, and writing table data, and emits logs and metrics for monitoring.

- [`handler`](../lib/merge-tables.ts) - Main Lambda entry point function that orchestrates the entire merge process
- [`AthenaUtils`](../lib/shared/athena-utils.ts) - Core utility class for executing Athena queries and managing database operations
- [`Config`](../lib/shared/config.ts) - Configuration management class that handles both Glue and S3 Tables modes

### B. Table Management

Classes and utilities for reading, merging, and writing package tables. This includes logic for handling schema evolution, deduplication, and efficient updates to the Iceberg catalog.

- [`TableManager`](../lib/tables/table-manager.ts) - Central orchestrator for table operations (create, insert, drop)
- [`BaseTable`](../lib/tables/base-table.ts) - Abstract base class providing common table functionality
- [`PackageRevisionTable`](../lib/tables/package-revision.ts) - Match package names to timestamp, top_hash, and package metadata
- [`PackageTagTable`](../lib/tables/package-tag.ts) - Manages package tags (like `latest`)
- [`PackageEntryTable`](../lib/tables/package-entry.ts) - Tracks individual files within packages, including a multihash for the object contents and object metadata

### C. CDK Stack

The AWS CDK stack defines all cloud resources, including the Lambda function, IAM roles, S3 buckets, and event sources. It synthesizes the infrastructure as code and exports deployment templates and asset manifests.

- [`TitanicStack`](../lib/titanic-stack.ts) - Main CDK stack class that defines all AWS resources
- [`titanic`](../bin/titanic.ts) - Main CDK stack class that defines all AWS resources. Also writes out deployment-config for use by other scripts
- [`titanic-external`](../bin/titanic-external.ts) - Modifies CDK stack for external deployment, including overridable parameters and use of public bucket assets

### D. External Deployment

The external deployment process enables packaging and distributing the Titanic application as a standalone deployment package for use outside the main repository context.

#### Asset Building and Upload Process

```bash
npm run cdk
npm run deploy:upload
npm run deploy:verify-assets
```

- The default (local) stack creates a publicly readable assets bucket
- [`upload-assets.sh`](../bin/upload-assets.sh) runs CDK synthesis to compile TypeScript Lambda code into bundled JavaScript
- Uploads the resulting ZIP file to that public S3 bucket
- Verifies cross-account accessibility for external CloudFormation deployments
- Doing this step manually avoids the need for AWS credentials in the GitHub action

#### Release Package Generation

```bash
npm run deploy:release
```

- [`release.sh`](../bin/release.sh) generates complete standalone deployment package in `dist`
- Uses [`titanic-external.ts`](../bin/titanic-external.ts) to create CloudFormation template with configurable parameters
- Includes CloudFormation template, deployment scripts, configuration examples, and documentation
- Creates compressed archives for GitHub releases distribution

#### End-User Deployment
- [`deploy.sh`](../bin/deploy.sh) validates user configuration and deploys CloudFormation stack
- Sends initialization event to populate catalog tables
- Supports configuration via environment variables or command-line parameters
- Requires no knowledge of underlying CDK infrastructure

#### Release Tagging and GitHub Actions
- Git tags trigger automated GitHub Actions workflow for release builds
- Production releases use `npm run deploy:tag` on main branch to create and push version tags
- Pre-releases use `npm run deploy:tag:prerelease` on feature branches for testing
- GitHub Actions automatically synthesizes templates and generates release packages
- Released artifacts include compressed archives with CloudFormation templates and deployment scripts
- All releases are published to [GitHub Releases](https://github.com/quiltdata/titanic/releases) with automated versioning