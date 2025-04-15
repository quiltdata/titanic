import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { TitanicStack } from "../lib/titanic-stack";

describe("TitanicStack", () => {
    const app = new cdk.App();
    const stack = new TitanicStack(app, "MyTestStack", {
        quiltDatabaseName: "test-database",
        quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
    });
    const template = Template.fromStack(stack);

    test("creates SQS queue with correct settings", () => {
        template.hasResourceProperties("AWS::SQS::Queue", {
            VisibilityTimeout: 900,
            MessageRetentionPeriod: 1209600, // 14 days in seconds
        });
    });

    test("creates Lambda function with SQS trigger", () => {
        template.hasResourceProperties("AWS::Lambda::Function", {
            Environment: {
                Variables: {
                    DATABASE_NAME: "test-database",
                    LAMBDA_TIMEOUT: "5000",
                    QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/test-policy",
                },
            },
        });

        template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
            BatchSize: 1,
            EventSourceArn: {
                "Fn::GetAtt": [
                    Object.keys(template.findResources("AWS::SQS::Queue"))[0],
                    "Arn",
                ],
            },
        });
    });

    test("creates Lambda with required Athena permissions", () => {
        const policies = template.findResources("AWS::IAM::Policy");
        const policy = Object.values(policies)[0];
        const statements = policy.Properties.PolicyDocument.Statement;
        
        // Check Athena permissions
        expect(statements).toContainEqual(
            expect.objectContaining({
                Action: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetWorkGroup",
                    "athena:BatchGetQueryExecution"
                ],
                Effect: "Allow",
                Resource: {
                    "Fn::Join": ["", ["arn:aws:athena:", {"Ref": "AWS::Region"}, ":", {"Ref": "AWS::AccountId"}, ":workgroup/primary"]]
                }
            })
        );

        // Check S3 bucket location permission
        expect(statements).toContainEqual(
            expect.objectContaining({
                Action: "s3:GetBucketLocation",
                Effect: "Allow"
            })
        );
    });
});
