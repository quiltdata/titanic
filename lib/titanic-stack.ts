import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from 'dotenv';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3tables from "@aws-cdk/aws-s3tables-alpha";
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as path from "path";

dotenv.config();

export interface TitanicStackProps extends cdk.StackProps {
    quiltDatabaseName: string;
    lambdaTimeout?: number;
    quiltReadPolicyArn: string;
}

export class TitanicStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TitanicStackProps) {
        super(scope, id, props);

        // Check if we should use S3 Tables
        const useS3Table = process.env.USE_S3_TABLE === "true";
        
        // Source database (where views are) - always from QUILT_DATABASE_NAME
        const glueDatabaseName = process.env.QUILT_DATABASE_NAME || (() => { throw new Error("must set QUILT_DATABASE_NAME environment variable"); })();
        
        // Target database (where we write tables) - depends on USE_S3_TABLE
        const targetDatabaseName = !useS3Table
            ? glueDatabaseName  // For Glue, read and write to same database
            : props.quiltDatabaseName;  // For S3 Tables, write to quilt_titanic

        // Only create the database for S3 Tables case - for Glue, the database already exists
        if (useS3Table) {
            // Create the database using a custom resource that handles existing databases
            new cr.AwsCustomResource(this, "QuiltTitanicDatabase", {
                onCreate: {
                    service: "Glue",
                    action: "createDatabase",
                    parameters: {
                        CatalogId: this.account,
                        DatabaseInput: {
                            Name: targetDatabaseName,
                            Description: "Database for Quilt Titanic S3 Tables",
                        },
                    },
                    physicalResourceId: cr.PhysicalResourceId.of(`glue-database-${targetDatabaseName}`),
                    ignoreErrorCodesMatching: "AlreadyExistsException",
                },                onUpdate: {
                    service: "Glue",
                    action: "updateDatabase",
                    parameters: {
                        CatalogId: this.account,
                        Name: targetDatabaseName,
                        DatabaseInput: {
                            Name: targetDatabaseName,
                            Description: "Database for Quilt Titanic S3 Tables",
                        },
                    },
                    physicalResourceId: cr.PhysicalResourceId.of(`glue-database-${targetDatabaseName}`),
                    ignoreErrorCodesMatching: "EntityNotFoundException",
                },
                policy: cr.AwsCustomResourcePolicy.fromStatements([
                    new iam.PolicyStatement({
                        actions: [
                            "glue:CreateDatabase",
                            "glue:UpdateDatabase", 
                            "glue:GetDatabase"
                        ],
                        resources: [
                            `arn:aws:glue:${this.region}:${this.account}:catalog`,
                            `arn:aws:glue:${this.region}:${this.account}:database/${targetDatabaseName}`,
                        ],
                    }),
                ]),
            });
        }

        // Always create both buckets for maximum flexibility
        
        // Regular S3 bucket for Athena results and Glue tables
        const titanicBucket = new s3.Bucket(this, "TitanicBucket", {
            bucketName: `titanic-${this.account}-${this.region}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // S3 Tables bucket for S3 Tables format
        const tableBucket = new s3tables.TableBucket(this, "TitanicTableBucket", {
            tableBucketName: `titanic-tables-${this.account}-${this.region}`,
        });

        // Create merge tables Lambda
        const mergeLambda = new lambda.NodejsFunction(this, "MergeTables", {
            entry: path.join(__dirname, "merge-tables.ts"),
            handler: "handler",
            runtime: Runtime.NODEJS_18_X,
            timeout: cdk.Duration.seconds(900),
            bundling: {
                externalModules: [
                    "@aws-sdk/client-glue",
                    "@aws-sdk/client-athena",
                ],
            },
            environment: {
                // Source database to read from (always the same, where views are)
                SOURCE_DATABASE_NAME: glueDatabaseName,
                
                // Target database to write to (changes based on USE_S3_TABLE)
                TARGET_DATABASE_NAME: targetDatabaseName,
                
                // Target buckets - Lambda chooses based on USE_S3_TABLE
                TITANIC_BUCKET: titanicBucket.bucketName,
                TITANIC_TABLES_BUCKET: tableBucket.tableBucketName,
                
                // Always use regular bucket for Athena results
                ATHENA_RESULTS_BUCKET: titanicBucket.bucketName,
                
                // Configuration
                LAMBDA_TIMEOUT: (props.lambdaTimeout || 15000).toString(),
                QUILT_READ_POLICY_ARN: props.quiltReadPolicyArn,
                USE_S3_TABLE: useS3Table.toString(),
            },
        });

        // Create EventBridge rule to route package events to Lambda
        const packageEventRule = new events.Rule(this, "PackageEventRule", {
            description: "Route package revision events to merge tables Lambda",
            eventPattern: {
                source: ["com.quiltdata"],
                detailType: ["package-revision", "package-tag", "package-entry"],
                detail: {
                    type: ["created", "updated"],
                }
            },
        });

        // Add Lambda as target for EventBridge rule
        packageEventRule.addTarget(new targets.LambdaFunction(mergeLambda));

        // Grant Lambda permissions
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["glue:GetTables", "glue:GetTable", "glue:GetPartitions", "glue:GetDatabase", "glue:CreateTable", "glue:DeleteTable", "glue:UpdateTable"],
                resources: [
                    `arn:aws:glue:${this.region}:${this.account}:catalog`,
                    `arn:aws:glue:${this.region}:${this.account}:database/${glueDatabaseName}`,
                    `arn:aws:glue:${this.region}:${this.account}:table/${glueDatabaseName}/*`,
                    `arn:aws:glue:${this.region}:${this.account}:database/${targetDatabaseName}`,
                    `arn:aws:glue:${this.region}:${this.account}:table/${targetDatabaseName}/*`,
                ],
            }),
        );

        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetWorkGroup",
                    "athena:BatchGetQueryExecution"
                ],
                resources: [
                    `arn:aws:athena:${this.region}:${this.account}:workgroup/primary`,
                ],
            }),
        );

        // Always grant permissions to both buckets since Lambda decides which to use
        
        // Regular S3 bucket permissions (always used for Athena results, also for Glue tables)
        titanicBucket.grantReadWrite(mergeLambda);
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [titanicBucket.bucketArn],
            }),
        );

        // S3 Tables bucket permissions (used when USE_S3_TABLE=true)
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    "s3:GetBucketLocation",
                    "s3tables:GetTable",
                    "s3tables:CreateTable",
                    "s3tables:PutTableData",
                    "s3tables:GetTableData",
                    "s3tables:UpdateTable",
                    "s3tables:DeleteTable",
                    "s3tables:ListTables",
                ],
                resources: [
                    tableBucket.tableBucketArn,
                    `${tableBucket.tableBucketArn}/*`,
                ],
            }),
        );

        // Grant read access to source buckets via the provided policy
        mergeLambda.role?.addManagedPolicy(
            iam.ManagedPolicy.fromManagedPolicyArn(
                this,
                "QuiltReadPolicy",
                props.quiltReadPolicyArn
            )
        );


    }
}
