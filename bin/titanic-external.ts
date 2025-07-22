#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TitanicStackExternal } from "../lib/titanic-stack-external";

const app = new cdk.App();

new TitanicStackExternal(app, "TitanicStack", {
    // External deployment mode for third-party deployments
    // Uses CloudFormation parameters and pre-built assets
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
