#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TitanicStack } from "../lib/titanic-stack";

const app = new cdk.App();
new TitanicStack(app, "TitanicStack", {
    quiltDatabaseName: process.env.QUILT_DATABASE_NAME || "userathenadatabase",
    quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN || "",
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
