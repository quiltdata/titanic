import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { TitanicStack } from "../lib/titanic-stack";

// Mock the TitanicStack to capture the props passed to it
const mockTitanicStack = jest.fn();
jest.mock("../lib/titanic-stack", () => ({
    TitanicStack: mockTitanicStack
}));

describe("bin/titanic-external", () => {
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

    it("should create TitanicStack with external deployment mode enabled", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";

        // Import and execute the bin file
        require("../bin/titanic-external");

        // Verify TitanicStack was called with external deployment mode
        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                externalDeployment: true,
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

        require("../bin/titanic-external");

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

        require("../bin/titanic-external");

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

    it("should not require ATHENA_DATABASE_NAME environment variable", () => {
        delete process.env.ATHENA_DATABASE_NAME;
        delete process.env.QUILT_READ_POLICY_ARN;
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";

        expect(() => {
            require("../bin/titanic-external");
        }).not.toThrow();

        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            expect.objectContaining({
                externalDeployment: true,
            })
        );
    });

    it("should only pass externalDeployment and env properties", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";
        process.env.ATHENA_DATABASE_NAME = "some-database";
        process.env.QUILT_READ_POLICY_ARN = "some-arn";
        process.env.USE_S3_TABLE = "true";

        require("../bin/titanic-external");

        expect(mockTitanicStack).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            {
                externalDeployment: true,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            }
        );

        // Verify no other properties are passed
        const calledWith = mockTitanicStack.mock.calls[0][2];
        expect(calledWith).not.toHaveProperty("athenaDatabaseName");
        expect(calledWith).not.toHaveProperty("quiltReadPolicyArn");
        expect(calledWith).not.toHaveProperty("useS3Table");
    });

    describe("environment variable handling", () => {
        it("should handle empty string environment variables", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "";
            process.env.CDK_DEFAULT_REGION = "";

            require("../bin/titanic-external");

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

            require("../bin/titanic-external");

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

            require("../bin/titanic-external");

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
                require("../bin/titanic-external");
            }).toThrow(errorMessage);
        });

        it("should propagate validation errors from TitanicStack", () => {
            const validationError = "External deployment validation failed";
            mockTitanicStack.mockImplementation(() => {
                throw new Error(validationError);
            });

            expect(() => {
                require("../bin/titanic-external");
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
                require("../bin/titanic-external");
            }).toThrow(appError);

            // Restore original
            (cdk as any).App = originalApp;
        });
    });

    describe("stack configuration validation", () => {
        it("should create stack with correct configuration for external deployment mode", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "999888777666";
            process.env.CDK_DEFAULT_REGION = "eu-west-2";

            require("../bin/titanic-external");

            expect(mockTitanicStack).toHaveBeenCalledTimes(1);
            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    externalDeployment: true,
                    env: {
                        account: "999888777666",
                        region: "eu-west-2",
                    },
                }
            );
        });

        it("should create exactly one CDK App instance", () => {
            const appSpy = jest.spyOn(cdk, 'App');
            
            require("../bin/titanic-external");

            expect(appSpy).toHaveBeenCalledTimes(1);
            expect(appSpy).toHaveBeenCalledWith();
            
            appSpy.mockRestore();
        });

        it("should create exactly one TitanicStack instance", () => {
            require("../bin/titanic-external");

            expect(mockTitanicStack).toHaveBeenCalledTimes(1);
        });

        it("should always pass externalDeployment as true", () => {
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

                require("../bin/titanic-external");

                expect(mockTitanicStack).toHaveBeenCalledWith(
                    expect.any(cdk.App),
                    "TitanicStack",
                    expect.objectContaining({
                        externalDeployment: true,
                    })
                );
            });
        });
    });

    describe("realistic AWS environment scenarios", () => {
        it("should handle typical AWS development environment", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";

            require("../bin/titanic-external");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    externalDeployment: true,
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

            require("../bin/titanic-external");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    externalDeployment: true,
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

            require("../bin/titanic-external");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    externalDeployment: true,
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

            require("../bin/titanic-external");

            expect(mockTitanicStack).toHaveBeenCalledWith(
                expect.any(cdk.App),
                "TitanicStack",
                {
                    externalDeployment: true,
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
            // These would cause titanic.ts to throw, but titanic-external.ts should not
            delete process.env.ATHENA_DATABASE_NAME;
            delete process.env.QUILT_READ_POLICY_ARN;

            expect(() => {
                require("../bin/titanic-external");
            }).not.toThrow();
        });

        it("should ignore database-related environment variables", () => {
            process.env.ATHENA_DATABASE_NAME = "ignored-database";
            process.env.QUILT_READ_POLICY_ARN = "ignored-arn";
            process.env.USE_S3_TABLE = "true";
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";

            require("../bin/titanic-external");

            const calledWith = mockTitanicStack.mock.calls[0][2];
            expect(calledWith).toEqual({
                externalDeployment: true,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });
        });

        it("should have a simpler configuration than titanic.ts", () => {
            process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
            process.env.CDK_DEFAULT_REGION = "us-east-1";

            require("../bin/titanic-external");

            const calledWith = mockTitanicStack.mock.calls[0][2];
            const configKeys = Object.keys(calledWith);
            
            // Should only have externalDeployment and env
            expect(configKeys).toHaveLength(2);
            expect(configKeys).toContain("externalDeployment");
            expect(configKeys).toContain("env");
        });
    });

    describe("external deployment infrastructure restrictions", () => {
        beforeEach(() => {
            // Restore the real TitanicStack for these tests
            jest.restoreAllMocks();
        });

        afterEach(() => {
            // Re-mock TitanicStack for other tests
            jest.mock("../lib/titanic-stack", () => ({
                TitanicStack: mockTitanicStack
            }));
        });

        it("should not create public S3 buckets", () => {
            const app = new cdk.App();
            const stack = new TitanicStack(app, "ExternalTestStack", {
                externalDeployment: true,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            
            // External deployments should not create any S3 buckets
            template.resourceCountIs("AWS::S3::Bucket", 0);
        });

        it("should not create S3 Table buckets", () => {
            const app = new cdk.App();
            const stack = new TitanicStack(app, "ExternalTestStack", {
                externalDeployment: true,
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            });

            const template = Template.fromStack(stack);
            
            // External deployments should not create S3 Tables buckets
            template.resourceCountIs("AWS::S3Tables::TableBucket", 0);
        });
    });
});
