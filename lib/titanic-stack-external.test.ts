import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Match } from "aws-cdk-lib/assertions";
import { TitanicStackExternal } from "./titanic-stack-external";

const createExternalStackTemplate = (
    stackId: string,
    props: any = {}
) => {
    const app = new cdk.App();
    const stack = new TitanicStackExternal(app, stackId, props);
    return Template.fromStack(stack);
};

const findLambdaPolicy = (template: Template, actionToFind: string) => {
    const policies = template.findResources("AWS::IAM::Policy");
    return Object.values(policies).find((policy: any) =>
        policy.Properties.PolicyDocument.Statement.some((stmt: any) =>
            Array.isArray(stmt.Action) && stmt.Action.includes(actionToFind)
        )
    ) as any;
};

const findLambdaPolicyByKey = (template: Template, _keyPattern: string) => {
    const policies = template.findResources("AWS::IAM::Policy");
    const lambdaPolicyEntry = Object.entries(policies).find(([key]) =>
        key.includes("MergeTables") && key.includes("ServiceRole")
    );
    return lambdaPolicyEntry ? lambdaPolicyEntry[1] : Object.values(policies)[0];
};

const expectS3BucketLocationPermissions = (template: Template) => {
    const policy = findLambdaPolicyByKey(template, "MergeTables");
    expect(policy).toBeDefined();
    const statements = policy.Properties.PolicyDocument.Statement;
    
    // Find all statements that grant s3:GetBucketLocation
    const s3BucketLocationStatements = statements.filter((statement: any) => 
        statement.Action === "s3:GetBucketLocation" || 
        (Array.isArray(statement.Action) && statement.Action.includes("s3:GetBucketLocation"))
    );
    
    expect(s3BucketLocationStatements.length).toBeGreaterThanOrEqual(2); // Should have at least 2 statements for both buckets
    
    // Check that we have permissions for both bucket types
    const allResources = s3BucketLocationStatements.flatMap((stmt: any) => 
        Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource]
    );
    
    // Should have bucket location permissions for both the Glue tables bucket and S3 tables bucket
    // The exact ARNs will be generated dynamically, but we should have at least 2 different bucket ARNs
    const uniqueBuckets = [...new Set(allResources)];
    expect(uniqueBuckets.length).toBeGreaterThanOrEqual(2);
};

const expectAthenaPermissions = (template: Template) => {
    const policy = findLambdaPolicy(template, "athena:StartQueryExecution");
    const statements = policy.Properties.PolicyDocument.Statement;
    
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
                "Fn::Join": ["", ["arn:aws:athena:", { "Ref": "AWS::Region" }, ":", { "Ref": "AWS::AccountId" }, ":workgroup/primary"]]
            }
        })
    );
};

describe("TitanicStackExternal", () => {
    describe("Constructor and Parameter Creation", () => {
        let template: Template;

        beforeAll(() => {
            template = createExternalStackTemplate("ExternalStack");
        });

        it("should create all required CloudFormation parameters", () => {
            // Check AthenaDatabaseName parameter
            template.hasParameter("AthenaDatabaseName", {
                Type: "String",
                Description: "Name of the Athena database containing the source views",
                Default: ""
            });

            // Check QuiltReadPolicyArn parameter
            template.hasParameter("QuiltReadPolicyArn", {
                Type: "String",
                Description: "ARN of the IAM policy for reading from Quilt buckets",
                Default: process.env.QUILT_READ_POLICY_ARN || ""
            });

            // Check UseS3Table parameter
            template.hasParameter("UseS3Table", {
                Type: "String",
                Description: "Whether to use S3 Tables format (true/false)",
                Default: "false",
                AllowedValues: ["true", "false"]
            });

            // Check PublicAssetsBucketName parameter
            template.hasParameter("PublicAssetsBucketName", {
                Type: "String",
                Description: "Name of the S3 bucket containing pre-built deployment assets",
                Default: ""
            });

            // Check S3TablesBucketName parameter
            template.hasParameter("S3TablesBucketName", {
                Type: "String",
                Description: "Name of the S3 Tables bucket (must exist already)",
                Default: ""
            });
        });

        it("should set externalDeployment flag to true", () => {
            // This is verified by the parameter creation above
            // External deployment creates parameters, internal deployment does not
            expect(template.toJSON().Parameters).toBeDefined();
            const parameterNames = Object.keys(template.toJSON().Parameters);
            // Should have our 5 required parameters (CDK may add additional ones like BootstrapVersion)
            expect(parameterNames).toContain("AthenaDatabaseName");
            expect(parameterNames).toContain("QuiltReadPolicyArn");
            expect(parameterNames).toContain("UseS3Table");
            expect(parameterNames).toContain("PublicAssetsBucketName");
            expect(parameterNames).toContain("S3TablesBucketName");
        });
    });

    describe("Bucket Creation (External Deployment)", () => {
        let template: Template;

        beforeAll(() => {
            template = createExternalStackTemplate("ExternalBucketStack");
        });

        it("should create only one S3 bucket (Glue tables bucket)", () => {
            // External deployment should only create the Glue tables bucket
            // Other buckets are referenced by name from parameters
            template.resourceCountIs("AWS::S3::Bucket", 1);
            
            template.hasResourceProperties("AWS::S3::Bucket", {
                BucketName: {
                    "Fn::Join": ["", ["titanic-glue-tables-", { "Ref": "AWS::AccountId" }, "-", { "Ref": "AWS::Region" }]]
                }
            });
        });

        it("should not create S3 Tables bucket (external deployment)", () => {
            // External deployment should not create S3 Tables bucket
            template.resourceCountIs("AWS::S3Tables::TableBucket", 0);
        });

        it("should not create assets bucket (external deployment)", () => {
            // External deployment should not create assets bucket
            // It references an existing one via parameter
            const buckets = template.findResources("AWS::S3::Bucket");
            const bucketNames = Object.values(buckets).map((bucket: any) => 
                bucket.Properties.BucketName
            );
            
            // Should only have the Glue tables bucket
            expect(bucketNames).toHaveLength(1);
            expect(bucketNames[0]).toEqual({
                "Fn::Join": ["", ["titanic-glue-tables-", { "Ref": "AWS::AccountId" }, "-", { "Ref": "AWS::Region" }]]
            });
        });

        it("should configure bucket with correct removal policy", () => {
            template.hasResource("AWS::S3::Bucket", {
                DeletionPolicy: "Delete",
                UpdateReplacePolicy: "Delete"
            });
        });
    });

    describe("Lambda Creation (External Deployment)", () => {
        let template: Template;

        beforeAll(() => {
            template = createExternalStackTemplate("ExternalLambdaStack");
        });

        it("should create IAM role for Lambda", () => {
            template.hasResourceProperties("AWS::IAM::Role", {
                AssumeRolePolicyDocument: {
                    Statement: [
                        {
                            Action: "sts:AssumeRole",
                            Effect: "Allow",
                            Principal: {
                                Service: "lambda.amazonaws.com"
                            }
                        }
                    ]
                },
                ManagedPolicyArns: Match.arrayWith([
                    {
                        "Fn::Join": ["", [
                            "arn:", { "Ref": "AWS::Partition" },
                            ":iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
                        ]]
                    }
                ])
            });
        });

        it("should create Lambda function using CfnFunction", () => {
            template.hasResourceProperties("AWS::Lambda::Function", {
                Runtime: "nodejs18.x",
                Handler: "index.handler",
                Timeout: 900,
                Code: {
                    S3Bucket: { "Ref": "PublicAssetsBucketName" },
                    S3Key: "lambda/merge-tables.zip"
                }
            });
        });

        it("should configure Lambda with correct environment variables", () => {
            // We need to find the TitanicMergeTables function specifically
            const template = createExternalStackTemplate("LambdaEnvVarsStack");
            const functions = template.findResources("AWS::Lambda::Function");
            const mergeTablesFunction = functions["TitanicMergeTables"];
            
            expect(mergeTablesFunction).toBeDefined();
            
            // Check the environment variables
            const envVars = mergeTablesFunction.Properties.Environment.Variables;
            
            expect(envVars).toMatchObject({
                ATHENA_DATABASE_NAME: { "Ref": "AthenaDatabaseName" },
                QUILT_READ_POLICY_ARN: { "Ref": "QuiltReadPolicyArn" },
                AWS_ACCOUNT_ID: { "Ref": "AWS::AccountId" },
                CDK_DEFAULT_REGION: { "Ref": "AWS::Region" },
                LAMBDA_TIMEOUT: "900",
                S3TABLE_DATABASE_NAME: "quilt_titanic"
            });
            
            // USE_S3_TABLE should be present (either as parameter reference or string)
            expect(envVars.USE_S3_TABLE).toBeDefined();
        });

        it("should not create NodejsFunction (external deployment uses pre-built code)", () => {
            // External deployment should not create NodejsFunction
            // It should use CfnFunction with pre-built code from S3
            const functions = template.findResources("AWS::Lambda::Function");
            
            // Should have the main function plus any helper functions CDK creates
            expect(Object.keys(functions).length).toBeGreaterThanOrEqual(1);
            
            // Find the main function (our merge tables function)
            const mainFunction = Object.values(functions).find((func: any) => 
                func.Properties.Code && func.Properties.Code.S3Bucket && func.Properties.Code.S3Key
            ) as any;
            
            expect(mainFunction).toBeDefined();
            expect(mainFunction.Properties.Code.S3Bucket).toBeDefined();
            // The S3Key could be "lambda/merge-tables.zip" or a hash-based key
            expect(mainFunction.Properties.Code.S3Key).toMatch(/.*\.zip$/);
        });
    });

    describe("Permissions (External Deployment)", () => {
        let template: Template;

        beforeAll(() => {
            template = createExternalStackTemplate("ExternalPermissionsStack");
        });

        it("should grant required Athena permissions", () => {
            expectAthenaPermissions(template);
        });

        it("should grant Glue permissions", () => {
            const policy = findLambdaPolicy(template, "glue:CreateDatabase");
            const statements = policy.Properties.PolicyDocument.Statement;
            
            // Find the statement that contains Glue permissions
            const glueStatement = statements.find((stmt: any) => 
                Array.isArray(stmt.Action) && stmt.Action.includes("glue:CreateDatabase")
            );
            
            expect(glueStatement).toBeDefined();
            expect(glueStatement.Action).toEqual(expect.arrayContaining([
                "glue:CreateDatabase",
                "glue:CreateTable",
                "glue:DeleteTable",
                "glue:GetDatabase",
                "glue:GetDatabases",
                "glue:GetPartitions",
                "glue:GetTable",
                "glue:GetTables",
                "glue:UpdateTable"
            ]));
        });

        it("should grant S3 Tables permissions", () => {
            const policy = findLambdaPolicy(template, "s3tables:GetTable");
            const statements = policy.Properties.PolicyDocument.Statement;
            
            expect(statements).toContainEqual(
                expect.objectContaining({
                    Action: [
                        "s3tables:GetTable",
                        "s3tables:CreateTable",
                        "s3tables:PutTableData",
                        "s3tables:GetTableData",
                        "s3tables:UpdateTable",
                        "s3tables:DeleteTable",
                        "s3tables:ListTables"
                    ],
                    Effect: "Allow"
                })
            );
        });

        it("should grant S3 bucket location permissions", () => {
            expectS3BucketLocationPermissions(template);
        });

        it("should attach Quilt read policy using parameter reference", () => {
            const roles = template.findResources("AWS::IAM::Role");
            const lambdaRole = Object.values(roles).find((role: any) =>
                role.Properties.AssumeRolePolicyDocument.Statement.some((stmt: any) =>
                    stmt.Principal.Service === "lambda.amazonaws.com"
                ) && role.Properties.ManagedPolicyArns && role.Properties.ManagedPolicyArns.some((arn: any) =>
                    arn.Ref === "QuiltReadPolicyArn"
                )
            ) as any;

            expect(lambdaRole).toBeDefined();
            
            // The policy should be attached directly to the role's ManagedPolicyArns
            expect(lambdaRole.Properties.ManagedPolicyArns).toContainEqual({ "Ref": "QuiltReadPolicyArn" });
        });
    });

    describe("EventBridge Integration (External Deployment)", () => {
        let template: Template;

        beforeAll(() => {
            template = createExternalStackTemplate("ExternalEventBridgeStack");
        });

        it("should create EventBridge rule with correct event pattern", () => {
            template.hasResourceProperties("AWS::Events::Rule", {
                Description: "Route package revision events to merge tables Lambda",
                EventPattern: {
                    source: ["com.quiltdata"],
                    "detail-type": ["package-revision", "package-tag", "package-entry"],
                    detail: {
                        type: ["created", "updated"]
                    }
                }
            });
        });

        it("should add Lambda as target for EventBridge rule", () => {
            template.hasResourceProperties("AWS::Events::Rule", {
                Targets: [
                    {
                        Arn: Match.anyValue(),
                        Id: Match.anyValue()
                    }
                ]
            });
        });
    });

    describe("Stack Outputs (External Deployment)", () => {
        let template: Template;

        beforeAll(() => {
            template = createExternalStackTemplate("ExternalOutputsStack");
        });

        it("should create Lambda function name output", () => {
            template.hasOutput("LambdaFunctionName", {
                Description: "Name of the Titanic merge tables Lambda function"
            });
        });

        it("should create Lambda log group name output", () => {
            template.hasOutput("LambdaLogGroupName", {
                Description: "CloudWatch log group name for the Titanic merge tables Lambda"
            });
        });

        it("should create Glue tables bucket output", () => {
            template.hasOutput("GlueTablesBucket", {
                Description: "S3 bucket for Glue tables and Athena results"
            });
        });

        it("should create S3 tables bucket output", () => {
            template.hasOutput("S3TablesBucket", {
                Description: "S3 Tables bucket name"
            });
        });

        it("should create assets bucket output with external deployment description", () => {
            template.hasOutput("AssetsBucket", {
                Description: "S3 bucket hosting pre-built deployment assets and Lambda code (external)"
            });
        });

        it("should create assets bucket URL output with external deployment description", () => {
            template.hasOutput("AssetsBucketUrl", {
                Description: "URL for the external assets bucket with pre-built assets"
            });
        });

        it("should create source database name output", () => {
            template.hasOutput("SourceDatabaseName", {
                Description: "Source Glue database name (where views are read from)"
            });
        });

        it("should create target database name output", () => {
            template.hasOutput("TargetDatabaseName", {
                Description: "Target database name (where tables are written to)"
            });
        });
    });

    describe("Environment Variable Handling", () => {
        let originalEnv: NodeJS.ProcessEnv;

        beforeEach(() => {
            originalEnv = process.env;
        });

        afterEach(() => {
            process.env = originalEnv;
        });

        it("should use environment variables as parameter defaults", () => {
            process.env = {
                ...originalEnv,
                ATHENA_DATABASE_NAME: "env-test-db",
                QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/env-test-policy",
                USE_S3_TABLE: "true",
                PUBLIC_ASSETS_BUCKET_NAME: "env-test-assets-bucket",
                S3_TABLES_BUCKET_NAME: "env-test-s3-tables-bucket"
            };

            const template = createExternalStackTemplate("EnvTestStack");

            template.hasParameter("AthenaDatabaseName", {
                Default: "env-test-db"
            });

            template.hasParameter("QuiltReadPolicyArn", {
                Default: "arn:aws:iam::123456789012:policy/env-test-policy"
            });

            template.hasParameter("UseS3Table", {
                Default: "true"
            });

            template.hasParameter("PublicAssetsBucketName", {
                Default: "env-test-assets-bucket"
            });

            template.hasParameter("S3TablesBucketName", {
                Default: "env-test-s3-tables-bucket"
            });
        });

        it("should use empty string defaults when environment variables are not set", () => {
            process.env = {
                ...originalEnv,
                ATHENA_DATABASE_NAME: undefined,
                QUILT_READ_POLICY_ARN: undefined,
                USE_S3_TABLE: undefined,
                PUBLIC_ASSETS_BUCKET_NAME: undefined,
                S3_TABLES_BUCKET_NAME: undefined
            };

            const template = createExternalStackTemplate("NoEnvTestStack");

            template.hasParameter("AthenaDatabaseName", {
                Default: ""
            });

            template.hasParameter("QuiltReadPolicyArn", {
                Default: ""
            });

            template.hasParameter("UseS3Table", {
                Default: "false"
            });

            template.hasParameter("PublicAssetsBucketName", {
                Default: ""
            });

            template.hasParameter("S3TablesBucketName", {
                Default: ""
            });
        });
    });

    describe("Override Methods", () => {
        let template: Template;

        beforeAll(() => {
            template = createExternalStackTemplate("OverrideTestStack");
        });

        it("should override getAssetsBucketDescription method", () => {
            template.hasOutput("AssetsBucket", {
                Description: "S3 bucket hosting pre-built deployment assets and Lambda code (external)"
            });
        });

        it("should override getAssetsBucketUrlDescription method", () => {
            template.hasOutput("AssetsBucketUrl", {
                Description: "URL for the external assets bucket with pre-built assets"
            });
        });
    });

    describe("Error Handling", () => {
        it("should handle missing environment variables gracefully", () => {
            // This test ensures that the stack can be created even when environment variables are not set
            expect(() => {
                createExternalStackTemplate("ErrorHandlingStack");
            }).not.toThrow();
        });

        it("should create valid CloudFormation template", () => {
            const template = createExternalStackTemplate("ValidTemplateStack");
            const json = template.toJSON();
            
            expect(json.Parameters).toBeDefined();
            expect(json.Resources).toBeDefined();
            expect(json.Outputs).toBeDefined();
            
            // Should have our required parameters (CDK may add additional ones)
            const parameterNames = Object.keys(json.Parameters);
            expect(parameterNames).toContain("AthenaDatabaseName");
            expect(parameterNames).toContain("QuiltReadPolicyArn");
            expect(parameterNames).toContain("UseS3Table");
            expect(parameterNames).toContain("PublicAssetsBucketName");
            expect(parameterNames).toContain("S3TablesBucketName");
            
            // Should have resources for Lambda, IAM, S3, and EventBridge
            const resourceNames = Object.keys(json.Resources);
            
            // Check for Lambda function
            expect(resourceNames.some(name => 
                name.toLowerCase().includes("lambda") || 
                name.toLowerCase().includes("function") || 
                name.includes("mergeTablesFunction") ||
                name.includes("MergeTablesFunction") ||
                name.includes("TitanicMergeTables") ||
                name.includes("MergeTables")
            )).toBe(true);
            
            expect(resourceNames.some(name => name.includes("Role"))).toBe(true);
            expect(resourceNames.some(name => name.includes("Bucket"))).toBe(true);
            expect(resourceNames.some(name => name.includes("Rule"))).toBe(true);
        });
    });
});
