import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { TitanicStack, TitanicStackProps } from "./titanic-stack";

export type TitanicStackExternalProps = Omit<TitanicStackProps, 'parameterDefaults' | 'externalDeployment'>;

export class TitanicStackExternal extends TitanicStack {
    constructor(scope: Construct, id: string, props: TitanicStackExternalProps = {}) {
        // Call super constructor with CliCredentialsStackSynthesizer to eliminate bootstrap dependencies
        super(scope, id, {
            ...props,
            // No parameterDefaults - pure CloudFormation parameters
            externalDeployment: true,
            // Use CliCredentialsStackSynthesizer for standalone templates
            synthesizer: new cdk.CliCredentialsStackSynthesizer({
                bucketPrefix: 'lambda/',
            }),
        });
    }

    protected createOrReferenceAssetsBucket(): string {
        // External deployment: use public assets bucket root parameter with region suffix
        return this.config.getPublicAssetsBucketRoot() ? 
               this.config.generateAssetsBucketNameFromRootRef() as string :
               this.config.generateAssetsBucketNameRef() as string;
    }

    protected createDeadLetterQueue(): sqs.Queue {
        // External deployment: create DLQ using CloudFormation with fixed naming
        return new sqs.Queue(this, "TitanicEventDLQ", {
            queueName: `titanic-event-dlq-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
            // Retain messages for 14 days (max for SQS)
            retentionPeriod: cdk.Duration.days(14),
            // Enable server-side encryption
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            // Set visibility timeout longer than Lambda timeout to prevent duplicate processing
            visibilityTimeout: cdk.Duration.seconds(960), // 16 minutes (Lambda timeout + buffer)
        });
    }

    protected createLambdaFunction(
        assetsBucketName: string, 
        lambdaEnvironment: Record<string, string>,
        lambdaRole: iam.IRole
    ): lambda.IFunction {
        // Use the public assets bucket parameter for Lambda code location
        const publicAssetsBucketName = this.config.getPublicAssetsBucketRoot() ? 
                                      this.config.generateAssetsBucketNameFromRootRef() as string :
                                      assetsBucketName;

        // Create Lambda using CfnFunction with parameter references
        const cfnLambda = new lambda.CfnFunction(this, "TitanicMergeTables", {
            runtime: Runtime.NODEJS_18_X.name,
            handler: "index.handler",
            timeout: 900,
            code: {
                s3Bucket: publicAssetsBucketName,
                s3Key: "lambda/merge-tables.zip"
            },
            environment: {
                variables: lambdaEnvironment,
            },
            role: lambdaRole.roleArn,
        });
        // Grant EventBridge permission to invoke this function
        const ruleArn = cdk.Fn.join('', [
            'arn:aws:events:', cdk.Aws.REGION, ':', cdk.Aws.ACCOUNT_ID, ':rule/',
            this.config.generateEventRuleNameRef() as string
        ]);
        
        new lambda.CfnPermission(this, 'EventInvokePermission', {
            action: 'lambda:InvokeFunction',
            functionName: cfnLambda.ref,
            principal: 'events.amazonaws.com',
            sourceArn: ruleArn,
        });
        
        // Wrap CfnFunction as IFunction for compatibility
        return lambda.Function.fromFunctionAttributes(this, "TitanicMergeTablesRef", {
            functionArn: cfnLambda.attrArn,
            role: lambdaRole,
        });
    }

    protected getAssetsBucketDescription(): string {
        return "S3 bucket hosting pre-built deployment assets and Lambda code (external)";
    }

    protected getAssetsBucketUrlDescription(): string {
        return "URL for the external assets bucket with pre-built assets";
    }
}
