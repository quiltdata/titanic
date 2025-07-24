import { Config } from './config';
import * as cdk from 'aws-cdk-lib';

export interface TitanicStackParameters {
  athenaDatabaseName: cdk.CfnParameter;
  quiltReadPolicyArn: cdk.CfnParameter;
  useS3Table: cdk.CfnParameter;
  publicAssetsBucketRoot?: cdk.CfnParameter; // Optional for external deployments
}

export interface TitanicStackProps extends cdk.StackProps {
  parameterDefaults?: {
    athenaDatabaseName?: string;
    quiltReadPolicyArn?: string;
    useS3Table?: boolean;
  };
  externalDeployment?: boolean;  // Flag for third-party deployments (uses parameters and pre-built assets)
}

/**
 * Configuration class for CDK stack construction.
 * Extends base Config with CloudFormation reference methods and parameter management.
 */
export class ConfigStack extends Config {
  private parameters: TitanicStackParameters;

  constructor(
    account: string, 
    region: string,
    props: {
      athenaDatabaseName: string;
      quiltReadPolicyArn: string;
      useS3Table?: boolean;
    }
  ) {
    super({
      awsAccountId: account,
      aws_region: region,
      athenaDatabaseName: props.athenaDatabaseName,
      quiltReadPolicyArn: props.quiltReadPolicyArn,
      useS3Table: props.useS3Table || false,
      // Generate bucket names from account/region
      glueTablesBucketName: Config.generateGlueTablesBucketName(account, region),
      s3TablesBucketName: Config.generateS3TablesBucketName(account, region),
    });
  }

  /**
   * Create CloudFormation parameters for the stack
   */
  public createParameters(
    stack: cdk.Stack,
    parameterDefaults?: TitanicStackProps['parameterDefaults'],
    includePublicAssetsBucket?: boolean
  ): TitanicStackParameters {
    const baseParameters = {
      athenaDatabaseName: new cdk.CfnParameter(stack, "AthenaDatabaseName", {
        type: "String",
        description: "Name of the Athena database containing the source views",
        default: parameterDefaults?.athenaDatabaseName || "",
      }),

      quiltReadPolicyArn: new cdk.CfnParameter(stack, "QuiltReadPolicyArn", {
        type: "String",
        description: "ARN of the IAM policy for reading from Quilt buckets",
        default: parameterDefaults?.quiltReadPolicyArn || "",
      }),

      useS3Table: new cdk.CfnParameter(stack, "UseS3Table", {
        type: "String",
        description: "Whether to use S3 Tables format (true/false)",
        default: (parameterDefaults?.useS3Table ?? false).toString(),
        allowedValues: ["true", "false"],
      }),
    };

    if (includePublicAssetsBucket) {
      this.parameters = {
        ...baseParameters,
        publicAssetsBucketRoot: new cdk.CfnParameter(stack, "PublicAssetsBucketRoot", {
          type: "String",
          description: "Root name of the public S3 bucket containing pre-built Lambda deployment assets (without region suffix)",
          default: "",
        }),
      };
    } else {
      this.parameters = baseParameters;
    }

    return this.parameters;
  }

  /**
   * Generate Lambda environment variables configuration
   */
  public generateLambdaEnvironment(
    glueTablesBucketName: string,
    s3TablesBucketName: string
  ): Record<string, string> {
    return {
      // Source database to read from (always the same, where views are)
      ATHENA_DATABASE_NAME: this.parameters.athenaDatabaseName.valueAsString,

      // Target database to write to (changes based on USE_S3_TABLE)
      S3TABLE_DATABASE_NAME: this.s3TableDatabaseName,

      // Target buckets - Pass bucket names instead of ARNs
      GLUE_TABLES_BUCKET_NAME: glueTablesBucketName,
      S3_TABLES_BUCKET_NAME: s3TablesBucketName,

      // AWS context for ARN generation
      AWS_ACCOUNT_ID: this.awsAccountId,

      // Configuration
      LAMBDA_TIMEOUT: "900",
      QUILT_READ_POLICY_ARN: this.parameters.quiltReadPolicyArn.valueAsString,
      USE_S3_TABLE: this.parameters.useS3Table.valueAsString,
    };
  }

  /**
   * Get the Quilt Read Policy ARN parameter reference for attaching to IAM roles
   */
  public getQuiltReadPolicyArn(): string {
    return this.parameters.quiltReadPolicyArn.valueAsString;
  }

  /**
   * Get the public assets bucket root parameter value (for external deployments)
   */
  public getPublicAssetsBucketRoot(): string | undefined {
    return this.parameters.publicAssetsBucketRoot?.valueAsString;
  }

  /**
   * Factory method to create ConfigStack from stack props and initialize parameters
   */
  public static createForStack(
    stack: cdk.Stack,
    props: TitanicStackProps
  ): ConfigStack {
    const useS3Table = props.parameterDefaults?.useS3Table || false;
    
    const config = useS3Table
      ? new S3StackConfig(stack.account, stack.region, {
          athenaDatabaseName: props.parameterDefaults?.athenaDatabaseName || '',
          quiltReadPolicyArn: props.parameterDefaults?.quiltReadPolicyArn || '',
        })
      : new ConfigStack(stack.account, stack.region, {
          athenaDatabaseName: props.parameterDefaults?.athenaDatabaseName || '',
          quiltReadPolicyArn: props.parameterDefaults?.quiltReadPolicyArn || '',
          useS3Table: false,
        });
    
    // Initialize parameters internally
    config.createParameters(stack, props.parameterDefaults, props.externalDeployment);
    
    return config;
  }

  /**
   * Generate CloudFormation reference for Glue tables bucket name
   * Returns Fn::Join with AWS::AccountId and AWS::Region parameters
   */
  public generateGlueTablesBucketNameRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join('', [
      'titanic-glue-tables-',
      { Ref: 'AWS::AccountId' },
      '-',
      { Ref: 'AWS::Region' }
    ]);
  }

  /**
   * Generate CloudFormation reference for S3 Tables bucket name
   * Returns Fn::Join with AWS::AccountId and AWS::Region parameters
   */
  public generateS3TablesBucketNameRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join('', [
      'titanic-s3-tables-',
      { Ref: 'AWS::AccountId' },
      '-',
      { Ref: 'AWS::Region' }
    ]);
  }

  /**
   * Generate CloudFormation reference for assets bucket name
   * Returns Fn::Join with AWS::AccountId and AWS::Region parameters
   */
  public generateAssetsBucketNameRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join('', [
      'titanic-assets-',
      { Ref: 'AWS::AccountId' },
      '-',
      { Ref: 'AWS::Region' }
    ]);
  }

  /**
   * Generate CloudFormation reference for assets bucket name from root parameter
   * Returns Fn::Join with PublicAssetsBucketRoot parameter and AWS::Region
   */
  public generateAssetsBucketNameFromRootRef(): unknown {
    if (!this.parameters.publicAssetsBucketRoot) {
      throw new Error('PublicAssetsBucketRoot parameter not available - this method is only for external deployments');
    }
    const { Fn } = require('aws-cdk-lib');
    return Fn.join('-', [
      { Ref: 'PublicAssetsBucketRoot' },
      { Ref: 'AWS::Region' }
    ]);
  }

  /**
   * Generate CloudFormation reference for EventBridge rule name
   * Returns Fn::Join with AWS::AccountId and AWS::Region parameters
   */
  public generateEventRuleNameRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join('', [
      'titanic-update-event-rule-',
      { Ref: 'AWS::AccountId' },
      '-',
      { Ref: 'AWS::Region' }
    ]);
  }

  /**
   * Generate CloudFormation reference for Dead Letter Queue name
   * Returns Fn::Join with AWS::AccountId and AWS::Region parameters
   */
  public generateDeadLetterQueueNameRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join('', [
      'titanic-event-dlq-',
      { Ref: 'AWS::AccountId' },
      '-',
      { Ref: 'AWS::Region' }
    ]);
  }

  /**
   * Generate CloudFormation reference for Athena database ARN
   * Returns Fn::Join with AWS::Region, AWS::AccountId and AthenaDatabaseName parameter
   */
  public generateAthenaDatabaseArnRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join(':', [
      'arn:aws:glue',
      { Ref: 'AWS::Region' },
      { Ref: 'AWS::AccountId' },
      'database',
      { Ref: 'AthenaDatabaseName' }
    ]);
  }

  /**
   * Generate CloudFormation reference for S3 Tables database ARN
   * Returns Fn::Join with AWS::Region, AWS::AccountId and computed S3 database name
   */
  public generateS3TablesDatabaseArnRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join(':', [
      'arn:aws:glue',
      { Ref: 'AWS::Region' },
      { Ref: 'AWS::AccountId' },
      'database',
      Fn.join('', [
        'user',
        { Ref: 'AthenaDatabaseName' },
        's3tables'
      ])
    ]);
  }

  /**
   * Generate CloudFormation reference for Athena table ARNs (wildcard)
   * Returns Fn::Join with AWS::Region, AWS::AccountId and AthenaDatabaseName parameter
   */
  public generateAthenaTableArnRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join(':', [
      'arn:aws:glue',
      { Ref: 'AWS::Region' },
      { Ref: 'AWS::AccountId' },
      'table',
      { Ref: 'AthenaDatabaseName' },
      '*'
    ]);
  }

  /**
   * Generate CloudFormation reference for S3 Tables table ARNs (wildcard)
   * Returns Fn::Join with AWS::Region, AWS::AccountId and computed S3 database name
   */
  public generateS3TablesTableArnRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join(':', [
      'arn:aws:glue',
      { Ref: 'AWS::Region' },
      { Ref: 'AWS::AccountId' },
      'table',
      Fn.join('', [
        'user',
        { Ref: 'AthenaDatabaseName' },
        's3tables'
      ]),
      '*'
    ]);
  }

  /**
   * Generate CloudFormation reference for Athena workgroup ARN
   * Returns Fn::Join with AWS::Region, AWS::AccountId and workgroup name (defaults to primary)
   */
  public generateAthenaWorkgroupArnRef(): unknown {
    const { Fn } = require('aws-cdk-lib');
    return Fn.join(':', [
      'arn:aws:athena',
      { Ref: 'AWS::Region' },
      { Ref: 'AWS::AccountId' },
      'workgroup/primary'
    ]);
  }
}

/**
 * S3-specific stack configuration for CDK construction.
 */
export class S3StackConfig extends ConfigStack {
  constructor(
    account: string, 
    region: string,
    props: {
      athenaDatabaseName: string;
      quiltReadPolicyArn: string;
    }
  ) {
    super(account, region, {
      ...props,
      useS3Table: true
    });
  }

  /**
   * Generate Lambda environment variables configuration for S3 Tables
   */
  public generateLambdaEnvironment(
    glueTablesBucketName: string,
    s3TablesBucketName: string
  ): Record<string, string> {
    const baseEnv = super.generateLambdaEnvironment(glueTablesBucketName, s3TablesBucketName);
    return {
      ...baseEnv,
      // Override target database to use S3 Tables database
      S3TABLE_DATABASE_NAME: this.s3TableDatabaseName,
    };
  }

  // S3 overrides
  public getWriteDatabaseName(): string {
    return this.s3TableDatabaseName;
  }

  public getTargetBucket(): string {
    return this.s3TablesBucketName;
  }

  // Always use Glue bucket for Athena query results, even in S3Config
  public getResultsBucket(): string {
    return this.glueTablesBucketName;
  }

  public getS3TableCatalogName(): string {
    // For S3 Tables, Athena expects: s3tablescatalog/bucket-name
    return `s3tablescatalog/${this.s3TablesBucketName}`;
  }

  public createTableQuery(tableName: string, columns: string): string {
    return `
      CREATE TABLE ${tableName} (
        ${columns}
      ) LOCATION 's3://${this.getTargetBucket()}/${tableName}/'
    `;
  }

  public getExecutionContext(): { Catalog: string; Database: string } {
    return {
      Catalog: this.getS3TableCatalogName(),
      Database: this.getWriteDatabaseName()
    };
  }
}
