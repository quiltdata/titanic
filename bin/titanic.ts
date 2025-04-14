#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TitanicStack } from '../lib/titanic-stack';

const app = new cdk.App();
new TitanicStack(app, 'TitanicStack', {
  quiltDatabaseName: 'titanic',
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
