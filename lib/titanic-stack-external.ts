import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { TitanicStack, TitanicStackProps } from "./titanic-stack";
import { Config } from "./shared/config";

export type TitanicStackExternalProps = Omit<TitanicStackProps, 'athenaDatabaseName' | 'quiltReadPolicyArn' | 'useS3Table' | 'externalDeployment'>;

interface TitanicStackExternalParameters {
    athenaDatabaseName: cdk.CfnParameter;
    quiltReadPolicyArn: cdk.CfnParameter;
    useS3Table: cdk.CfnParameter;
    publicAssetsBucketName: cdk.CfnParameter;
    s3TablesBucketName: cdk.CfnParameter;
}

export class TitanicStackExternal extends TitanicStack {
    private parameters: TitanicStackExternalParameters;

    constructor(scope: Construct, id: string, props: TitanicStackExternalProps = {}) {
        // Call super constructor with external deployment flag
        super(scope, id, {
            ...props,
            externalDeployment: true,
        });
        
        // Parameters are created during parent construction, so we can access them now
        this.parameters = this.getParametersFromStack();
    }

    private getParametersFromStack(): TitanicStackExternalParameters {
        // Find the parameters that were created during parent construction
        return {
            athenaDatabaseName: this.node.tryFindChild("AthenaDatabaseName") as cdk.CfnParameter,
            quiltReadPolicyArn: this.node.tryFindChild("QuiltReadPolicyArn") as cdk.CfnParameter,
            useS3Table: this.node.tryFindChild("UseS3Table") as cdk.CfnParameter,
            publicAssetsBucketName: this.node.tryFindChild("PublicAssetsBucketName") as cdk.CfnParameter,
            s3TablesBucketName: this.node.tryFindChild("S3TablesBucketName") as cdk.CfnParameter,
        };
    }

    protected createBuckets(config: Config): { 
        glueTablesBucket: s3.Bucket; 
        s3TablesBucketName: string; 
        assetsBucketName: string; 
    } {
        // External deployment: only create Glue tables bucket for Athena results
        const glueTablesBucket = new s3.Bucket(this, "TitanicGlueTablesBucket", {
            bucketName: config.generateGlueTablesBucketName(),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Reference external buckets by name (these should exist already)
        // Use node.tryFindChild to get parameters if they exist, otherwise use defaults
        const s3TablesBucketParam = this.node.tryFindChild("S3TablesBucketName") as cdk.CfnParameter;
        const assetsBucketParam = this.node.tryFindChild("PublicAssetsBucketName") as cdk.CfnParameter;
        
        const s3TablesBucketName = s3TablesBucketParam?.valueAsString || config.generateS3TablesBucketName();
        const assetsBucketName = assetsBucketParam?.valueAsString || config.generateAssetsBucketName();

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
