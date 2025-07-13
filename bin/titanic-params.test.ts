import * as cdk from "aws-cdk-lib";

// Mock the TitanicStack to capture the props passed to it
const mockTitanicStack = jest.fn();
jest.mock("../lib/titanic-stack", () => ({
    TitanicStack: mockTitanicStack
}));

describe("bin/titanic-params", () => {
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

    it("should create TitanicStack with CloudFormation parameters mode enabled", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";

        // Import and execute the bin file
        require("../bin/titanic-params");

        // Verify TitanicStack was called with CloudFormation parameters mode
        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                useCloudFormationParameters: true,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            })
        );
    });

    it("should pass through CDK environment variables", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "999888777666";
        process.env.CDK_DEFAULT_REGION = "eu-west-2";

        require("../bin/titanic-params");

        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                env: {
                    account: "999888777666",
                    region: "eu-west-2",
                },
            })
        );
    });

    it("should handle undefined CDK environment variables", () => {
        delete process.env.CDK_DEFAULT_ACCOUNT;
        delete process.env.CDK_DEFAULT_REGION;

        require("../bin/titanic-params");

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

    it("should not require QUILT_DATABASE_NAME environment variable", () => {
        delete process.env.QUILT_DATABASE_NAME;
        delete process.env.QUILT_READ_POLICY_ARN;
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";

        expect(() => {
            require("../bin/titanic-params");
        }).not.toThrow();

        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                useCloudFormationParameters: true,
            })
        );
    });

    it("should only pass useCloudFormationParameters and env properties", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";
        process.env.QUILT_DATABASE_NAME = "some-database";
        process.env.QUILT_READ_POLICY_ARN = "some-arn";
        process.env.USE_S3_TABLE = "true";

        require("../bin/titanic-params");

        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            {
                useCloudFormationParameters: true,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            }
        );

        // Verify no other properties are passed
        const calledWith = mockTitanicStack.mock.calls[0][2];
        expect(calledWith).not.toHaveProperty("glueDatabaseName");
        expect(calledWith).not.toHaveProperty("quiltReadPolicyArn");
        expect(calledWith).not.toHaveProperty("useS3Table");
    });

    describe("environment variable handling", () => {
        it("should handle empty string environment variables", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "";
            process.env.CDK_DEFAULT_REGION = "";

            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    env: {
                        account: "",
                        region: "",
                    },
                })
            );
        });

        it("should preserve whitespace in environment variables", () => {
            process.env.CDK_DEFAULT_ACCOUNT = " 123456789012 ";
            process.env.CDK_DEFAULT_REGION = "\tus-east-1\n";

            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
                    env: {
                        account: " 123456789012 ",
                        region: "\tus-east-1\n",
                    },
                })
            );
        });

        it("should handle long environment variable values", () => {
            const longAccount = "1".repeat(20);
            const longRegion = "us-".repeat(20) + "east-1";

            process.env.CDK_DEFAULT_ACCOUNT = longAccount;
            process.env.CDK_DEFAULT_REGION = longRegion;

            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                expect.objectContaining({
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
                require("../bin/titanic-params");
            }).toThrow(errorMessage);
        });

        it("should propagate validation errors from TitanicStack", () => {
            const validationError = "CloudFormation parameters validation failed";
            mockTitanicStack.mockImplementation(() => {
                throw new Error(validationError);
            });

            expect(() => {
                require("../bin/titanic-params");
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
                require("../bin/titanic-params");
            }).toThrow(appError);

            // Restore original
            (cdk as any).App = originalApp;
        });
    });

    describe("stack configuration validation", () => {
        it("should create stack with correct configuration for CloudFormation parameters mode", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "999888777666";
            process.env.CDK_DEFAULT_REGION = "eu-west-2";

            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledTimes(1);
            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    useCloudFormationParameters: true,
                    env: {
                        account: "999888777666",
                        region: "eu-west-2",
                    },
                }
            );
        });

        it("should create exactly one CDK App instance", () => {
            const appSpy = jest.spyOn(cdk, 'App');
            
            require("../bin/titanic-params");

            expect(appSpy).toHaveBeenCalledTimes(1);
            expect(appSpy).toHaveBeenCalledWith();
            
            appSpy.mockRestore();
        });

        it("should create exactly one TitanicStack instance", () => {
            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledTimes(1);
        });

        it("should always pass useCloudFormationParameters as true", () => {
            // Test with various environment configurations
            const envConfigs = [
                {},
                { CDK_DEFAULT_ACCOUNT: "123456789012" },
                { CDK_DEFAULT_REGION: "us-east-1" },
                { CDK_DEFAULT_ACCOUNT: "123456789012", CDK_DEFAULT_REGION: "us-east-1" },
            ];

            envConfigs.forEach((envConfig, _index) => {
                jest.resetModules();
                jest.clearAllMocks();
                process.env = { ...originalEnv, ...envConfig };

                require("../bin/titanic-params");

                expect(mockTitanicStack).toHaveBeenCalledWith(
                    expect.any(cdk.App),
                    "TitanicStack",
                    expect.objectContaining({
                        useCloudFormationParameters: true,
                    })
                );
            });
        });
    });

    describe("realistic AWS environment scenarios", () => {
        it("should handle typical AWS development environment", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";

            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    useCloudFormationParameters: true,
                    env: {
                        account: "123456789012",
                        region: "us-east-1",
                    },
                }
            );
        });

        it("should handle typical AWS production environment", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "999888777666";
            process.env.CDK_DEFAULT_REGION = "us-west-2";

            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    useCloudFormationParameters: true,
                    env: {
                        account: "999888777666",
                        region: "us-west-2",
                    },
                }
            );
        });

        it("should handle minimal environment with no CDK variables", () => {
            delete process.env.CDK_DEFAULT_ACCOUNT;
            delete process.env.CDK_DEFAULT_REGION;

            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    useCloudFormationParameters: true,
                    env: {
                        account: undefined,
                        region: undefined,
                    },
                }
            );
        });

        it("should work in cross-account deployment scenarios", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "111222333444";
            process.env.CDK_DEFAULT_REGION = "ap-southeast-2";

            require("../bin/titanic-params");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    useCloudFormationParameters: true,
                    env: {
                        account: "111222333444",
                        region: "ap-southeast-2",
                    },
                }
            );
        });
    });

    describe("comparison with titanic.ts behavior", () => {
        it("should not throw errors for missing database environment variables", () => {
            // These would cause titanic.ts to throw, but titanic-params.ts should not
            delete process.env.QUILT_DATABASE_NAME;
            delete process.env.QUILT_READ_POLICY_ARN;

            expect(() => {
                require("../bin/titanic-params");
            }).not.toThrow();
        });

        it("should ignore database-related environment variables", () => {
            process.env.QUILT_DATABASE_NAME = "ignored-database";
            process.env.QUILT_READ_POLICY_ARN = "ignored-arn";
            process.env.USE_S3_TABLE = "true";
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";

            require("../bin/titanic-params");

            const calledWith = mockTitanicStack.mock.calls[0][2];
            expect(calledWith).toEqual({
                useCloudFormationParameters: true,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });
        });

        it("should have a simpler configuration than titanic.ts", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";

            require("../bin/titanic-params");

            const calledWith = mockTitanicStack.mock.calls[0][2];
            const configKeys = Object.keys(calledWith);
            
            // Should only have useCloudFormationParameters and env
            expect(configKeys).toHaveLength(2);
            expect(configKeys).toContain("useCloudFormationParameters");
            expect(configKeys).toContain("env");
        });
    });
});
