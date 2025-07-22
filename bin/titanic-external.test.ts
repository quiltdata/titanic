import * as cdk from "aws-cdk-lib";

describe("bin/titanic-external", () => {
    // Mock the TitanicStackExternal to capture the props passed to it
    const mockTitanicStackExternal = jest.fn();
    
    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        
        // Mock the external stack class
        jest.doMock("../lib/titanic-stack-external", () => ({
            TitanicStackExternal: mockTitanicStackExternal
        }));
    });

    afterEach(() => {
        jest.dontMock("../lib/titanic-stack-external");
    });

    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it("should create TitanicStackExternal with correct configuration", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";

        // Import and execute the bin file
        require("../bin/titanic-external");

        // Verify TitanicStackExternal was called with correct props
        expect(mockTitanicStackExternal).toHaveBeenCalledWith(
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

    it("should pass through CDK environment variables", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "999888777666";
        process.env.CDK_DEFAULT_REGION = "eu-west-2";

        require("../bin/titanic-external");

        expect(mockTitanicStackExternal).toHaveBeenCalledWith(
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

        expect(mockTitanicStackExternal).toHaveBeenCalledWith(
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

        expect(mockTitanicStackExternal).toHaveBeenCalledWith(
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

    it("should only pass env properties to TitanicStackExternal", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";

        require("../bin/titanic-external");

        expect(mockTitanicStackExternal).toHaveBeenCalledWith(
            expect.any(cdk.App),
            "TitanicStack",
            {
                env: {
                    account: "123456789012",
                    region: "us-east-1",
                },
            }
        );
    });
});
