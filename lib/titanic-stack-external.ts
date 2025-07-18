import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { TitanicStack, TitanicStackProps } from "./titanic-stack";
import { Config } from "./shared/config";

export type TitanicStackExternalProps = Omit<TitanicStackProps, 'parameterDefaults' | 'externalDeployment'>;

export class TitanicStackExternal extends TitanicStack {
    constructor(scope: Construct, id: string, props: TitanicStackExternalProps = {}) {
        // Call super constructor without parameter defaults (external deployment)
        super(scope, id, {
            ...props,
            // No parameterDefaults - pure CloudFormation parameters
            externalDeployment: true,
        });
    }

    protected createBuckets(config: Config): { 
        glueTablesBucket: s3.Bucket; 
        s3TablesBucketName: string; 
        assetsBucketName: string; 
    } {
        // External deployment: only create Glue tables bucket for Athena results
        // Use Config method to generate CloudFormation reference for consistency
        const glueTablesBucketName = config.generateGlueTablesBucketNameRef();
        
        const glueTablesBucket = new s3.Bucket(this, "TitanicGlueTablesBucket", {
            bucketName: glueTablesBucketName,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Reference external buckets by parameter values (these should exist already)
        const s3TablesBucketName = this.parameters.s3TablesBucketName.valueAsString;
        const assetsBucketName = this.parameters.publicAssetsBucketName.valueAsString;

        return { glueTablesBucket, s3TablesBucketName, assetsBucketName };
    }

    protected createLambda(
        assetsBucketName: string, 
        lambdaEnvironment: Record<string, string>
    ): { mergeLambda: lambda.IFunction; lambdaRole: iam.IRole } {
        // Create role first for external deployment
        const lambdaRole = new iam.Role(this, "TitanicMergeTablesRole", {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
            ],
        });

        // Create Lambda using CfnFunction with parameter references
        const cfnLambda = new lambda.CfnFunction(this, "TitanicMergeTables", {
            runtime: Runtime.NODEJS_18_X.name,
            handler: "index.handler",
            timeout: 900,
            code: {
                s3Bucket: assetsBucketName, // This will be a parameter reference
                s3Key: "lambda/merge-tables.zip"
            },
            environment: {
                variables: lambdaEnvironment,
            },
            role: lambdaRole.roleArn,
        });
        
        // Wrap CfnFunction as IFunction for compatibility
        const mergeLambda = lambda.Function.fromFunctionAttributes(this, "TitanicMergeTablesRef", {
            functionArn: cfnLambda.attrArn,
            role: lambdaRole,
        });

        return { mergeLambda, lambdaRole };
    }

    protected getAssetsBucketDescription(): string {
        return "S3 bucket hosting pre-built deployment assets and Lambda code (external)";
    }

    protected getAssetsBucketUrlDescription(): string {
        return "URL for the external assets bucket with pre-built assets";
    }
}
