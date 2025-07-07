#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TitanicStack } from "../lib/titanic-stack";

const app = new cdk.App();

// Always pass the default database name - the stack will override if needed
const databaseName = "quilt_titanic";

new TitanicStack(app, "TitanicStack", {
    quiltDatabaseName: databaseName,
    quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN || "",
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
 