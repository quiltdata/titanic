import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { TitanicStack, TitanicStackProps } from "./titanic-stack";

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

    protected createOrReferenceAssetsBucket(): string {
        // External deployment: use public assets bucket parameter
        return this.config.getPublicAssetsBucketName() || 
               this.config.generateAssetsBucketNameRef() as string;
    }

    protected createLambdaFunction(
        assetsBucketName: string, 
        lambdaEnvironment: Record<string, string>,
        lambdaRole: iam.IRole
    ): lambda.IFunction {
        // Use the public assets bucket parameter for Lambda code location
        const publicAssetsBucketName = this.config.getPublicAssetsBucketName() || assetsBucketName;

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
