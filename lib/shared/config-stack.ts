import { Config } from './config';
/**
 * Configuration class for CDK stack construction.
 * Extends base Config with CloudFormation reference methods.
 */
export class ConfigStack extends Config {
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
