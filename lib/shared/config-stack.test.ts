import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ConfigStack, S3StackConfig } from './config-stack';

describe('ConfigStack', () => {
    const testAccount = '123456789012';
    const testRegion = 'us-east-1';
    const testProps = {
        athenaDatabaseName: 'test-database',
        quiltReadPolicyArn: 'arn:aws:iam::123456789012:policy/test-policy',
        useS3Table: false,
    };

    describe('Constructor and basic properties', () => {
        it('should create ConfigStack with correct properties', () => {
            const config = new ConfigStack(testAccount, testRegion, testProps);

            expect(config.awsAccountId).toBe(testAccount);
            expect(config.aws_region).toBe(testRegion);
            expect(config.athenaDatabaseName).toBe('test-database');
            expect(config.quiltReadPolicyArn).toBe('arn:aws:iam::123456789012:policy/test-policy');
            expect(config.useS3Table).toBe(false);
            expect(config.s3TableDatabaseName).toBe('quilt_titanic');
        });

        it('should create S3StackConfig with S3 Tables mode enabled', () => {
            const config = new S3StackConfig(testAccount, testRegion, {
                athenaDatabaseName: 'test-database',
                quiltReadPolicyArn: 'arn:aws:iam::123456789012:policy/test-policy',
            });

            expect(config.useS3Table).toBe(true);
            expect(config.s3TableDatabaseName).toBe('quilt_titanic');
        });
    });

    describe('CloudFormation reference methods', () => {
        let config: ConfigStack;
        let app: cdk.App;
        let stack: cdk.Stack;

        beforeEach(() => {
            config = new ConfigStack(testAccount, testRegion, testProps);
            app = new cdk.App();
            stack = new cdk.Stack(app, 'TestStack');
        });

        it('should generate Glue tables bucket name reference as CDK token', () => {
            const ref = config.generateGlueTablesBucketNameRef();
            
            // The method returns a CDK token, so we check its string representation
            expect(cdk.Token.isUnresolved(ref)).toBe(true);
            
            // Test that it resolves correctly in a stack context
            new cdk.CfnOutput(stack, 'TestRef', { value: ref as string });
            const template = Template.fromStack(stack);
            
            template.hasOutput('TestRef', {
                Value: {
                    "Fn::Join": [
                        "-",
                        [
                            "titanic-glue-tables",
                            { "Ref": "AWS::AccountId" },
                            { "Ref": "AWS::Region" }
                        ]
                    ]
                }
            });
        });

        it('should generate S3 Tables bucket name reference as CDK token', () => {
            const ref = config.generateS3TablesBucketNameRef();
            
            expect(cdk.Token.isUnresolved(ref)).toBe(true);
            
            new cdk.CfnOutput(stack, 'TestRef', { value: ref as string });
            const template = Template.fromStack(stack);
            
            template.hasOutput('TestRef', {
                Value: {
                    "Fn::Join": [
                        "-",
                        [
                            "titanic-s3-tables",
                            { "Ref": "AWS::AccountId" },
                            { "Ref": "AWS::Region" }
                        ]
                    ]
                }
            });
        });

        it('should generate assets bucket name reference as CDK token', () => {
            const ref = config.generateAssetsBucketNameRef();
            
            expect(cdk.Token.isUnresolved(ref)).toBe(true);
            
            new cdk.CfnOutput(stack, 'TestRef', { value: ref as string });
            const template = Template.fromStack(stack);
            
            template.hasOutput('TestRef', {
                Value: {
                    "Fn::Join": [
                        "-",
                        [
                            "titanic-assets",
                            { "Ref": "AWS::AccountId" },
                            { "Ref": "AWS::Region" }
                        ]
                    ]
                }
            });
        });
    });

    describe('Static bucket name generators', () => {
        it('should generate consistent Glue tables bucket names', () => {
            const name1 = ConfigStack.generateGlueTablesBucketName(testAccount, testRegion);
            const name2 = ConfigStack.generateGlueTablesBucketName(testAccount, testRegion);
            
            expect(name1).toBe(name2);
            expect(name1).toBe(`titanic-glue-tables-${testAccount}-${testRegion}`);
        });

        it('should generate consistent S3 Tables bucket names', () => {
            const name1 = ConfigStack.generateS3TablesBucketName(testAccount, testRegion);
            const name2 = ConfigStack.generateS3TablesBucketName(testAccount, testRegion);
            
            expect(name1).toBe(name2);
            expect(name1).toBe(`titanic-s3-tables-${testAccount}-${testRegion}`);
        });

        it('should generate consistent assets bucket names', () => {
            const name1 = ConfigStack.generateAssetsBucketName(testAccount, testRegion);
            const name2 = ConfigStack.generateAssetsBucketName(testAccount, testRegion);
            
            expect(name1).toBe(name2);
            expect(name1).toBe(`titanic-assets-${testAccount}-${testRegion}`);
        });

        it('should generate different bucket names for different accounts', () => {
            const account1 = '123456789012';
            const account2 = '210987654321';
            
            const name1 = ConfigStack.generateGlueTablesBucketName(account1, testRegion);
            const name2 = ConfigStack.generateGlueTablesBucketName(account2, testRegion);
            
            expect(name1).not.toBe(name2);
            expect(name1).toContain(account1);
            expect(name2).toContain(account2);
        });

        it('should generate different bucket names for different regions', () => {
            const region1 = 'us-east-1';
            const region2 = 'us-west-2';
            
            const name1 = ConfigStack.generateGlueTablesBucketName(testAccount, region1);
            const name2 = ConfigStack.generateGlueTablesBucketName(testAccount, region2);
            
            expect(name1).not.toBe(name2);
            expect(name1).toContain(region1);
            expect(name2).toContain(region2);
        });
    });

    describe('Inherited Config functionality', () => {
        let config: ConfigStack;

        beforeEach(() => {
            config = new ConfigStack(testAccount, testRegion, testProps);
        });

        it('should inherit Config methods for database operations', () => {
            expect(config.getReadDatabaseName()).toBe('test-database');
            expect(config.getWriteDatabaseName()).toBe('test-database');
        });

        it('should inherit Config methods for bucket operations', () => {
            // ConfigStack should generate bucket names internally
            const expectedGlueName = `titanic-glue-tables-${testAccount}-${testRegion}`;
            const expectedS3Name = `titanic-s3-tables-${testAccount}-${testRegion}`;
            
            expect(config.getGlueTablesBucketName()).toBe(expectedGlueName);
            expect(config.getS3TablesBucketName()).toBe(expectedS3Name);
        });

        it('should create proper table queries', () => {
            const createQuery = config.createTableQuery('test_table', 'id bigint, name string');
            expect(createQuery).toContain('CREATE TABLE test_table');
            expect(createQuery).toContain('id bigint, name string');
            expect(createQuery).toContain("format = 'iceberg'");

            const dropQuery = config.dropTableQuery('test_table');
            expect(dropQuery).toBe('DROP TABLE IF EXISTS test_table');
        });
    });

    describe('S3StackConfig specific functionality', () => {
        let s3Config: S3StackConfig;

        beforeEach(() => {
            s3Config = new S3StackConfig(testAccount, testRegion, {
                athenaDatabaseName: 'test-database',
                quiltReadPolicyArn: 'arn:aws:iam::123456789012:policy/test-policy',
            });
        });

        it('should override database methods for S3 Tables', () => {
            expect(s3Config.getReadDatabaseName()).toBe('test-database');
            expect(s3Config.getWriteDatabaseName()).toBe('quilt_titanic'); // S3 Tables database
        });

        it('should use S3 Tables bucket for target operations', () => {
            const expectedS3Name = `titanic-s3-tables-${testAccount}-${testRegion}`;
            expect(s3Config.getTargetBucket()).toBe(expectedS3Name);
        });

        it('should generate S3 Tables-specific execution context', () => {
            const context = s3Config.getExecutionContext();
            expect(context.Database).toBe('quilt_titanic');
        });
    });

    describe('Edge cases and validation', () => {
        it('should handle missing props gracefully', () => {
            expect(() => {
                new ConfigStack(testAccount, testRegion, {
                    athenaDatabaseName: '',
                    quiltReadPolicyArn: '',
                    useS3Table: false,
                });
            }).not.toThrow();
        });

        it('should handle different AWS account formats', () => {
            const shortAccount = '123456789';
            const longAccount = '123456789012345';
            
            expect(() => {
                new ConfigStack(shortAccount, testRegion, testProps);
            }).not.toThrow();
            
            expect(() => {
                new ConfigStack(longAccount, testRegion, testProps);
            }).not.toThrow();
        });

        it('should handle different region formats', () => {
            const regions = ['us-east-1', 'eu-west-1', 'ap-southeast-2'];
            
            regions.forEach(region => {
                expect(() => {
                    new ConfigStack(testAccount, region, testProps);
                }).not.toThrow();
            });
        });
    });
});
