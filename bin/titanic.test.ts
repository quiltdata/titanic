import * as cdk from "aws-cdk-lib";

// Mock the TitanicStack to capture the props passed to it
const mockTitanicStack = jest.fn();
jest.mock("../lib/titanic-stack", () => ({
    TitanicStack: mockTitanicStack
}));

describe("bin/titanic", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mock implementation to default behavior
        mockTitanicStack.mockImplementation(() => {});
        
        // Save essential environment variables
        const essentialVars: Record<string, string | undefined> = {
            PATH: originalEnv.PATH,
            NODE_PATH: originalEnv.NODE_PATH,
            HOME: originalEnv.HOME,
            NODE_ENV: originalEnv.NODE_ENV,
        };
        
        // Start with a completely clean environment, then add back essentials
        process.env = {} as any;
        Object.keys(essentialVars).forEach(key => {
            if (essentialVars[key]) {
                process.env[key] = essentialVars[key];
            }
        });
        
        // Clear module cache to ensure fresh imports for each test
        jest.resetModules();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it("should pass correct props including athenaDatabaseName and useS3Table from environment variables", () => {
        process.env.ATHENA_DATABASE_NAME = "test-database";
        process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123456789012:policy/test-policy";
        process.env.USE_S3_TABLE = "true";

        // Import and execute the bin file
        require("../bin/titanic");

        // Verify TitanicStack was called with the correct props
        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                athenaDatabaseName: "test-database",
                quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
                useS3Table: true,
            })
        );
    });

    it("should pass athenaDatabaseName from ATHENA_DATABASE_NAME environment variable", () => {
        process.env.ATHENA_DATABASE_NAME = "custom_database_name";
        process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123456789012:policy/test-policy";
        process.env.USE_S3_TABLE = "false";

        // Import and execute the bin file
        require("../bin/titanic");

        // Verify TitanicStack was called with the database name from environment variable
        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                athenaDatabaseName: "custom_database_name",
                quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
                useS3Table: false,
            })
        );
    });

    it("should pass through environment variables for CDK account and region", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";
        process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123456789012:policy/test-policy";
        process.env.ATHENA_DATABASE_NAME = "custom_database_name";

        // Import and execute the bin file
        require("../bin/titanic");

        // Verify TitanicStack was called with the environment configuration
        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            })
        );
    });

    describe("environment variable handling", () => {
        it("should handle USE_S3_TABLE environment variable correctly", () => {
            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = "test-arn";
            delete process.env.USE_S3_TABLE; // Should default to false

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    useS3Table: false,
                })
            );
        });

        it("should preserve whitespace in environment variables", () => {
            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = "  arn:aws:iam::123:policy/test  ";
            process.env.CDK_DEFAULT_ACCOUNT = " 123456789012 ";
            process.env.CDK_DEFAULT_REGION = "\tus-east-1\n";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    athenaDatabaseName: "test-database",
                    quiltReadPolicyArn: "  arn:aws:iam::123:policy/test  ",
                    env: {
                        account: " 123456789012 ",
                        region: "\tus-east-1\n",
                    },
                })
            );
        });

        it("should handle special characters in environment variables", () => {
            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123:policy/Test-Policy_With.Special@Chars";
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    athenaDatabaseName: "test-database",
                    quiltReadPolicyArn: "arn:aws:iam::123:policy/Test-Policy_With.Special@Chars",
                })
            );
        });

        it("should handle very long environment variable values", () => {
            const longArn = "arn:aws:iam::123456789012:policy/" + "a".repeat(500);
            const longAccount = "1".repeat(20);
            const longRegion = "us-".repeat(20) + "east-1";

            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = longArn;
            process.env.CDK_DEFAULT_ACCOUNT = longAccount;
            process.env.CDK_DEFAULT_REGION = longRegion;

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    athenaDatabaseName: "test-database",
                    quiltReadPolicyArn: longArn,
                    env: {
                        account: longAccount,
                        region: longRegion,
                    },
                })
            );
        });
    });

    describe("error handling", () => {
        it("should propagate TitanicStack constructor errors", () => {
            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = "test-arn";

            const errorMessage = "Stack initialization failed";
            mockTitanicStack.mockImplementation(() => {
                throw new Error(errorMessage);
            });

            expect(() => {
                require("../bin/titanic");
            }).toThrow(errorMessage);
        });

        it("should propagate validation errors from TitanicStack", () => {
            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = "test-arn";

            const validationError = "must set ATHENA_DATABASE_NAME environment variable";
            mockTitanicStack.mockImplementation(() => {
                throw new Error(validationError);
            });

            expect(() => {
                require("../bin/titanic");
            }).toThrow(validationError);
        });

        it("should handle CDK App creation errors", () => {
            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = "test-arn";

            // Mock CDK App to throw an error
            const appError = "CDK App initialization failed";
            const mockApp = jest.fn().mockImplementation(() => {
                throw new Error(appError);
            });

            // Mock the entire CDK module
            jest.doMock("aws-cdk-lib", () => ({
                App: mockApp,
            }));

            expect(() => {
                require("../bin/titanic");
            }).toThrow(appError);

            // Clean up
            jest.dontMock("aws-cdk-lib");
        });
    });

    describe("stack configuration validation", () => {
        it("should create stack with correct default values", () => {
            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = "test-policy-arn";
            process.env.CDK_DEFAULT_ACCOUNT = "999888777666";
            process.env.CDK_DEFAULT_REGION = "eu-west-2";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledTimes(1);
            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    athenaDatabaseName: "test-database",
                    quiltReadPolicyArn: "test-policy-arn",
                    useS3Table: false,
                    env: {
                        account: "999888777666",
                        region: "eu-west-2",
                    },
                }
            );
        });

        it("should use athenaDatabaseName from ATHENA_DATABASE_NAME environment variable", () => {
            process.env.ATHENA_DATABASE_NAME = "my_custom_database";
            process.env.QUILT_READ_POLICY_ARN = "test-policy-arn";
            process.env.DATABASE_NAME = "also_ignored";
            process.env.DB_NAME = "ignored_too";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.objectContaining({
                    athenaDatabaseName: "my_custom_database",
                })
            );
        });

        it("should create exactly one TitanicStack instance", () => {
            process.env.ATHENA_DATABASE_NAME = "test-database";
            process.env.QUILT_READ_POLICY_ARN = "test-policy-arn";
            
            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledTimes(1);
        });
    });
});
