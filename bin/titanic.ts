#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TitanicStack } from "../lib/titanic-stack";

const app = new cdk.App();

// Determine database name - allow override with QUILT_DATABASE_NAME environment variable
const databaseName = process.env.QUILT_DATABASE_NAME || "quilt_titanic";

new TitanicStack(app, "TitanicStack", {
    quiltDatabaseName: databaseName,
    quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN || "",
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
 