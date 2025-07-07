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
        process.env = { ...originalEnv };
        // Clear module cache to ensure fresh imports for each test
        jest.resetModules();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it("should always use default database name regardless of QUILT_DATABASE_NAME environment variable", () => {
        delete process.env.QUILT_DATABASE_NAME;
        process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123456789012:policy/test-policy";

        // Import and execute the bin file
        require("../bin/titanic");

        // Verify TitanicStack was called with the default database name
        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                quiltDatabaseName: "quilt_titanic",
                quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
            })
        );
    });

    it("should always use default database name even when QUILT_DATABASE_NAME is set", () => {
        process.env.QUILT_DATABASE_NAME = "custom_database_name";
        process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123456789012:policy/test-policy";

        // Import and execute the bin file
        require("../bin/titanic");

        // Verify TitanicStack was called with the default database name (not the environment variable)
        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                quiltDatabaseName: "quilt_titanic",
                quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
            })
        );
    });

    it("should pass through environment variables for CDK account and region", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";
        process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123456789012:policy/test-policy";

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
        it("should handle missing QUILT_READ_POLICY_ARN with empty string", () => {
            delete process.env.QUILT_READ_POLICY_ARN;

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    quiltReadPolicyArn: "",
                })
            );
        });

        it("should handle undefined CDK environment variables", () => {
            delete process.env.CDK_DEFAULT_ACCOUNT;
            delete process.env.CDK_DEFAULT_REGION;
            process.env.QUILT_READ_POLICY_ARN = "test-arn";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    env: {
                        account: undefined,
                        region: undefined,
                    },
                })
            );
        });

        it("should handle empty string environment variables", () => {
            process.env.QUILT_READ_POLICY_ARN = "";
            process.env.CDK_DEFAULT_ACCOUNT = "";
            process.env.CDK_DEFAULT_REGION = "";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    quiltReadPolicyArn: "",
                    env: {
                        account: "",
                        region: "",
                    },
                })
            );
        });

        it("should preserve whitespace in environment variables", () => {
            process.env.QUILT_READ_POLICY_ARN = "  arn:aws:iam::123:policy/test  ";
            process.env.CDK_DEFAULT_ACCOUNT = " 123456789012 ";
            process.env.CDK_DEFAULT_REGION = "\tus-east-1\n";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    quiltReadPolicyArn: "  arn:aws:iam::123:policy/test  ",
                    env: {
                        account: " 123456789012 ",
                        region: "\tus-east-1\n",
                    },
                })
            );
        });

        it("should handle special characters in environment variables", () => {
            process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123:policy/Test-Policy_With.Special@Chars";
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    quiltReadPolicyArn: "arn:aws:iam::123:policy/Test-Policy_With.Special@Chars",
                })
            );
        });

        it("should handle very long environment variable values", () => {
            const longArn = "arn:aws:iam::123456789012:policy/" + "a".repeat(500);
            const longAccount = "1".repeat(20);
            const longRegion = "us-".repeat(20) + "east-1";

            process.env.QUILT_READ_POLICY_ARN = longArn;
            process.env.CDK_DEFAULT_ACCOUNT = longAccount;
            process.env.CDK_DEFAULT_REGION = longRegion;

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
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
            const errorMessage = "Stack initialization failed";
            mockTitanicStack.mockImplementation(() => {
                throw new Error(errorMessage);
            });

            expect(() => {
                require("../bin/titanic");
            }).toThrow(errorMessage);
        });

        it("should propagate validation errors from TitanicStack", () => {
            const validationError = "must set QUILT_DATABASE_NAME environment variable";
            mockTitanicStack.mockImplementation(() => {
                throw new Error(validationError);
            });

            expect(() => {
                require("../bin/titanic");
            }).toThrow(validationError);
        });

        it("should handle CDK App creation errors", () => {
            // Mock CDK App to throw an error
            const originalApp = cdk.App;
            const appError = "CDK App initialization failed";
            
            (cdk as any).App = jest.fn().mockImplementation(() => {
                throw new Error(appError);
            });

            expect(() => {
                require("../bin/titanic");
            }).toThrow(appError);

            // Restore original
            (cdk as any).App = originalApp;
        });
    });

    describe("stack configuration validation", () => {
        it("should create stack with correct default values", () => {
            process.env.QUILT_READ_POLICY_ARN = "test-policy-arn";
            process.env.CDK_DEFAULT_ACCOUNT = "999888777666";
            process.env.CDK_DEFAULT_REGION = "eu-west-2";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledTimes(1);
            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    quiltDatabaseName: "quilt_titanic",
                    quiltReadPolicyArn: "test-policy-arn",
                    env: {
                        account: "999888777666",
                        region: "eu-west-2",
                    },
                }
            );
        });

        it("should always use fixed database name regardless of other environment variables", () => {
            process.env.QUILT_DATABASE_NAME = "should_be_ignored";
            process.env.DATABASE_NAME = "also_ignored";
            process.env.DB_NAME = "ignored_too";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.objectContaining({
                    quiltDatabaseName: "quilt_titanic",
                })
            );
        });

        it("should create exactly one CDK App instance", () => {
            const appSpy = jest.spyOn(cdk, 'App');
            
            require("../bin/titanic");

            expect(appSpy).toHaveBeenCalledTimes(1);
            expect(appSpy).toHaveBeenCalledWith();
            
            appSpy.mockRestore();
        });

        it("should create exactly one TitanicStack instance", () => {
            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledTimes(1);
        });
    });

    describe("realistic AWS environment scenarios", () => {
        it("should handle typical AWS development environment", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";
            process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::123456789012:policy/QuiltDevReadAccess";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    quiltDatabaseName: "quilt_titanic",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/QuiltDevReadAccess",
                    env: {
                        account: "123456789012",
                        region: "us-east-1",
                    },
                })
            );
        });

        it("should handle typical AWS production environment", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "999888777666";
            process.env.CDK_DEFAULT_REGION = "us-west-2";
            process.env.QUILT_READ_POLICY_ARN = "arn:aws:iam::999888777666:policy/QuiltProdReadAccess";

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    quiltDatabaseName: "quilt_titanic",
                    quiltReadPolicyArn: "arn:aws:iam::999888777666:policy/QuiltProdReadAccess",
                    env: {
                        account: "999888777666",
                        region: "us-west-2",
                    },
                })
            );
        });

        it("should handle minimal environment with only required variables", () => {
            // Only set what's absolutely required for basic operation
            delete process.env.CDK_DEFAULT_ACCOUNT;
            delete process.env.CDK_DEFAULT_REGION;
            delete process.env.QUILT_READ_POLICY_ARN;

            require("../bin/titanic");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    quiltDatabaseName: "quilt_titanic",
                    quiltReadPolicyArn: "",
                    env: {
                        account: undefined,
                        region: undefined,
                    },
                })
            );
        });
    });
});
