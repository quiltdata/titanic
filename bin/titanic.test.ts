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
});
