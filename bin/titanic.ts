#!/usr/bin/env node
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import * as fs from "fs";
import * as path from "path";
import { TitanicStack } from "../lib/titanic-stack";
import { Config } from "../lib/shared/config";

const app = new cdk.App();

// Ensure required environment variables are set
if (!process.env.ATHENA_DATABASE_NAME) {
    throw new Error("Environment variable ATHENA_DATABASE_NAME is not set");
}
if (!process.env.QUILT_READ_POLICY_ARN) {
    throw new Error("Environment variable QUILT_READ_POLICY_ARN is not set");
}

const useS3Table = process.env.USE_S3_TABLE === "true";

// Get account and region from environment or CDK context
const account = process.env.CDK_DEFAULT_ACCOUNT || app.account;
const region = process.env.CDK_DEFAULT_REGION || app.region || 'us-east-1';

// Create the stack
const _stack = new TitanicStack(app, "TitanicStack", {
    env: {
        account: account,
        region: region,
    },
    parameterDefaults: {
        athenaDatabaseName: process.env.ATHENA_DATABASE_NAME,
        quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN,
        useS3Table: useS3Table,
        // Let other bucket names be generated dynamically
    },
});

// Write deployment configuration for other scripts to use
const config = new Config({
  awsAccountId: account,
  aws_region: region,
  athenaDatabaseName: process.env.ATHENA_DATABASE_NAME!,
  quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN!,
  useS3Table: useS3Table,
});

const deploymentConfig = config.generateDeploymentConfig();
const configPath = path.join(process.cwd(), 'doc', 'deployment-config.json');
fs.writeFileSync(configPath, JSON.stringify(deploymentConfig, null, 2));
console.log(`📄 Deployment configuration written to: ${configPath}`);

// if (useS3Table), explain how to call npm run create-s3-tables to create the namespace and tables
if (useS3Table) {
    console.log("⚠️  USE_S3_TABLE is set to true. After deployment, run 'npm run create-s3-tables' to create the S3 Tables namespace and tables.");
    console.log("   Make sure AWS CLI is configured with appropriate permissions.");
}
