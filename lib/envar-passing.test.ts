import { Config, S3Config } from "./shared/config";

/**
 * Tests for environment variable contract between CDK stack and Lambda
 * 
 * The CDK stack passes environment variables to the Lambda function.
 * We need to be explicit about:
 * a) Pass bucket names from stack to Lambda (simpler and cleaner)
 * b) Config methods that generate ARNs when needed from names + region + account
 * c) Each method gets exactly what it needs (name vs ARN)
 */
describe("Environment Variable Contract Tests", () => {
    describe("Stack-to-Lambda environment variable contract", () => {
        it("should pass bucket names with clear naming", () => {
            // Document what the stack SHOULD pass to Lambda (bucket names for all buckets)
            const expectedEnvVars = {
                // Bucket names (simpler and cleaner)
                GLUE_TABLES_BUCKET_NAME: "titanic-glue-tables-123456789012-us-east-2",
                S3_TABLES_BUCKET_NAME: "titanic-s3-tables-123456789012-us-east-2",
                
                // AWS context for ARN generation
                AWS_ACCOUNT_ID: "123456789012",
                CDK_DEFAULT_REGION: "us-east-2",
                
                // Database names
                ATHENA_DATABASE_NAME: "source-database",
                S3TABLE_DATABASE_NAME: "quilt_titanic",
                
                // Configuration flags
                USE_S3_TABLE: "false" // or "true"
            };

            // All bucket env vars should end with _NAME for clarity
            expect(expectedEnvVars.GLUE_TABLES_BUCKET_NAME).not.toContain("arn:");
            expect(expectedEnvVars.S3_TABLES_BUCKET_NAME).not.toContain("arn:");
        });
    });

    describe("Config class bucket name handling and ARN generation", () => {
        it("should generate ARNs correctly from bucket names", () => {
            const config = new Config({
                glueTablesBucketName: "titanic-glue-tables-123456789012-us-east-2",
                s3TablesBucketName: "titanic-s3-tables-123456789012-us-east-2",
                aws_region: "us-east-2",
                awsAccountId: "123456789012"
            });
            
            // Should store bucket names directly
            expect(config.glueTablesBucketName).toBe("titanic-glue-tables-123456789012-us-east-2");
            expect(config.s3TablesBucketName).toBe("titanic-s3-tables-123456789012-us-east-2");
            
            // Should generate ARNs when requested
            expect(config.getGlueTablesBucketArn()).toBe("arn:aws:s3:::titanic-glue-tables-123456789012-us-east-2");
            expect(config.getS3TablesBucketArn()).toBe("arn:aws:s3tables:us-east-2:123456789012:bucket/titanic-s3-tables-123456789012-us-east-2");
            
            // Should provide bucket names when requested
            expect(config.getGlueTablesBucketName()).toBe("titanic-glue-tables-123456789012-us-east-2");
            expect(config.getS3TablesBucketName()).toBe("titanic-s3-tables-123456789012-us-east-2");
        });

        it("should handle Glue config with bucket name inputs", () => {
            const config = new Config({
                glueTablesBucketName: "titanic-glue-tables-123456789012-us-east-2",
                s3TablesBucketName: "titanic-s3-tables-123456789012-us-east-2",
                aws_region: "us-east-2",
                awsAccountId: "123456789012"
            });

            // Should use bucket names for operations
            expect(config.getTargetBucket()).toBe("titanic-glue-tables-123456789012-us-east-2");
            expect(config.getResultsBucket()).toBe("titanic-glue-tables-123456789012-us-east-2");
            
            // Should provide ARNs when needed
            expect(config.getGlueTablesBucketArn()).toBe("arn:aws:s3:::titanic-glue-tables-123456789012-us-east-2");
            expect(config.getS3TablesBucketArn()).toBe("arn:aws:s3tables:us-east-2:123456789012:bucket/titanic-s3-tables-123456789012-us-east-2");
            
            // Should provide bucket names
            expect(config.getGlueTablesBucketName()).toBe("titanic-glue-tables-123456789012-us-east-2");
            expect(config.getS3TablesBucketName()).toBe("titanic-s3-tables-123456789012-us-east-2");
            
            // Execution context should not have Catalog for Glue
            const context = config.getExecutionContext();
            expect(context).toEqual({ Database: config.getReadDatabaseName() });
        });

        it("should handle S3Config with bucket name inputs", () => {
            const config = new S3Config({
                glueTablesBucketName: "titanic-glue-tables-123456789012-us-east-2",
                s3TablesBucketName: "titanic-s3-tables-123456789012-us-east-2",
                aws_region: "us-east-2",
                awsAccountId: "123456789012",
                s3TableDatabaseName: "quilt_titanic"
            });

            // S3Config should use S3 Tables bucket name for tables, Glue bucket name for results
            expect(config.getTargetBucket()).toBe("titanic-s3-tables-123456789012-us-east-2");
            expect(config.getResultsBucket()).toBe("titanic-glue-tables-123456789012-us-east-2");
            
            // Should format catalog name correctly for Athena S3 Tables
            expect(config.getS3TableCatalogName()).toBe("s3tablescatalog/titanic-s3-tables-123456789012-us-east-2");
            
            // Should provide correct execution context for Athena
            const context = config.getExecutionContext();
            expect(context.Catalog).toBe("s3tablescatalog/titanic-s3-tables-123456789012-us-east-2");
            expect(context.Database).toBe("quilt_titanic");
        });
    });

    describe("Environment variable usage in merge-tables handler", () => {
        it("should expect bucket name environment variables", () => {
            // These are the environment variables merge-tables.ts should read
            const bucketEnvVars = [
                "GLUE_TABLES_BUCKET_NAME",
                "S3_TABLES_BUCKET_NAME"
            ];
            
            const contextEnvVars = [
                "AWS_ACCOUNT_ID",
                "CDK_DEFAULT_REGION"
            ];
            
            const databaseEnvVars = [
                "ATHENA_DATABASE_NAME",
                "S3TABLE_DATABASE_NAME"
            ];
            
            const configEnvVars = [
                "USE_S3_TABLE"
            ];

            // All bucket environment variables should contain NAME
            bucketEnvVars.forEach(envVar => {
                expect(envVar).toContain("NAME");
                expect(envVar).not.toContain("ARN");
            });
            
            // Context vars should identify their purpose
            contextEnvVars.forEach(envVar => {
                expect(envVar).toMatch(/AWS_(ACCOUNT_ID|REGION)|CDK_DEFAULT_REGION/);
            });
            
            // Database and config vars should not contain ARN
            [...databaseEnvVars, ...configEnvVars].forEach(envVar => {
                expect(envVar).not.toContain("ARN");
            });
        });
    });

    describe("CDK stack environment variable output", () => {
        it("should pass bucket names with clear variable names", () => {
            // The stack should set these environment variables on the Lambda
            const stackOutputs = {
                GLUE_TABLES_BUCKET_NAME: "bucket-name",
                S3_TABLES_BUCKET_NAME: "bucket-name",
                AWS_ACCOUNT_ID: "123456789012",
                CDK_DEFAULT_REGION: "us-east-1"
            };

            // Verify the name formats are correct
            Object.entries(stackOutputs).forEach(([key, value]) => {
                if (key.includes("BUCKET")) {
                    expect(key).toContain("NAME");
                    expect(value).not.toContain("arn:aws:");
                }
            });
        });
    });

    describe("Method usage patterns", () => {
        it("should use appropriate methods for different operations", () => {
            const config = new S3Config({
                glueTablesBucketName: "glue-bucket",
                s3TablesBucketName: "s3tables-bucket",
                aws_region: "us-east-2",
                awsAccountId: "123456789012"
            });

            // For Athena query locations (needs bucket names)
            expect(config.getResultsBucket()).toBe("glue-bucket");
            expect(config.getTargetBucket()).toBe("s3tables-bucket");
            
            // For Athena execution context (needs catalog format for S3 Tables)
            const context = config.getExecutionContext();
            expect(context.Catalog).toBe("s3tablescatalog/s3tables-bucket");
            
            // For IAM permissions or other AWS APIs (might need ARNs)
            expect(config.getGlueTablesBucketArn()).toBe("arn:aws:s3:::glue-bucket");
            expect(config.getS3TablesBucketArn()).toBe("arn:aws:s3tables:us-east-2:123456789012:bucket/s3tables-bucket");
        });
    });
});
