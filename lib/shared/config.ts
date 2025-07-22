/**
 * Base configuration class for Lambda runtime usage.
 * Works with environment variables and resolved string values.
 */
export class Config {
  public static readonly S3_TABLES_PREFIX = 's3tablesbucket';
  public static readonly S3_TABLES_NAMESPACE = 'preview';
  
  public readonly aws_region: string;
  public readonly athenaDatabaseName: string;
  public readonly glueTablesBucketName: string;
  public readonly s3TableDatabaseName: string;
  public readonly s3TablesBucketName: string;
  public readonly useS3Table: boolean;
  public readonly namespace: string;
  public readonly awsAccountId: string;
  public readonly quiltReadPolicyArn: string;

  constructor(config?: Partial<Config>) {
    this.awsAccountId = config?.awsAccountId ?? (process.env.CDK_DEFAULT_ACCOUNT || '');
    this.aws_region = config?.aws_region ?? (process.env.CDK_DEFAULT_REGION || 'us-east-1');
    this.athenaDatabaseName = config?.athenaDatabaseName ?? (process.env.ATHENA_DATABASE_NAME || 'athena_database');
    this.glueTablesBucketName = config?.glueTablesBucketName ?? (process.env.GLUE_TABLES_BUCKET_NAME || '');
    this.s3TableDatabaseName = config?.s3TableDatabaseName ?? (process.env.S3TABLE_DATABASE_NAME || 'quilt_titanic');
    this.s3TablesBucketName = config?.s3TablesBucketName ?? (process.env.S3_TABLES_BUCKET_NAME || '');
    this.useS3Table = config?.useS3Table ?? (process.env.USE_S3_TABLE === 'true' || false);
    this.namespace = config?.namespace ?? (process.env.S3_TABLES_NAMESPACE || Config.S3_TABLES_NAMESPACE);
    this.quiltReadPolicyArn = config?.quiltReadPolicyArn ?? (process.env.QUILT_READ_POLICY_ARN || '');
  }
  
  // Factory method to create appropriate config type based on environment
  public static create(config?: Partial<Config>, useS3Table?: boolean): Config {
    const shouldUseS3Table = useS3Table ?? (process.env.USE_S3_TABLE === 'true');
    return shouldUseS3Table
      ? new S3Config(config) 
      : new Config(config);
  }
  
  public static createTestInstance(config: Partial<Config> = {}): Config {
    return new Config(config);
  }
  
  /**
   * Create config instance from resolved values (for Lambda runtime)
   */
  public static createFromStack(
    account: string, 
    region: string, 
    props: {
      athenaDatabaseName: string;
      quiltReadPolicyArn: string;
      useS3Table: boolean;
    }
  ): Config {
    const baseConfig = {
      awsAccountId: account,
      aws_region: region,
      athenaDatabaseName: props.athenaDatabaseName,
      quiltReadPolicyArn: props.quiltReadPolicyArn,
      // Generate bucket names based on account/region
      glueTablesBucketName: Config.generateGlueTablesBucketName(account, region),
      s3TablesBucketName: Config.generateS3TablesBucketName(account, region),
    };

    return props.useS3Table
      ? new S3Config(baseConfig) 
      : new Config(baseConfig);
  }
  
  // Glue defaults
  public getReadDatabaseName(): string {
    return this.athenaDatabaseName;
  }

  public getWriteDatabaseName(): string {
    return this.athenaDatabaseName;
  }
  
  public getResultsBucket(): string {
    return this.glueTablesBucketName;
  }

  public getTargetBucket(): string {
    return this.glueTablesBucketName;
  }

  public createTableQuery(tableName: string, columns: string): string {
    return `
      CREATE TABLE ${tableName} (
        ${columns}
      ) WITH (format = 'iceberg')
    `;
  }

  public dropTableQuery(tableName: string): string {
    return `DROP TABLE IF EXISTS ${tableName}`;
  }

  public getExecutionContext(): { Database: string } {
    return { Database: this.getWriteDatabaseName() };
  }

  /**
   * Extract bucket name from table name by removing view suffixes
   */
  public static sourceBucketFromTableName(name: string): string {
    return name.replace(/_(objects|packages)-view$/, "");
  }

  /**
   * Extract bucket name from S3 bucket ARN
   * Handles both regular S3 buckets and S3 Tables buckets
   */
  public static extractBucketNameFromArn(arn: string): string {
    // Handle S3 Tables ARN: arn:aws:s3tables:region:account:bucket/bucket-name
    const s3TablesMatch = arn.match(/^arn:aws:s3tables:[^:]+:[^:]+:bucket\/(.+)$/);
    if (s3TablesMatch) {
      return s3TablesMatch[1];
    }
    
    // Handle regular S3 bucket ARN: arn:aws:s3:::bucket-name
    const s3Match = arn.match(/^arn:aws:s3:::(.+)$/);
    if (s3Match) {
      return s3Match[1];
    }
    
    // If not an ARN, assume it's already a bucket name
    return arn;
  }

  /**
   * Get Glue tables bucket name
   */
  public getGlueTablesBucketName(): string {
    return this.glueTablesBucketName;
  }

  /**
   * Get Glue tables bucket ARN (generate from name)
   */
  public getGlueTablesBucketArn(): string {
    return `arn:aws:s3:::${this.glueTablesBucketName}`;
  }

  /**
   * Get S3 Tables bucket name
   */
  public getS3TablesBucketName(): string {
    return this.s3TablesBucketName;
  }

  /**
   * Get S3 Tables bucket ARN (generate from name and region)
   */
  public getS3TablesBucketArn(): string {
    return `arn:aws:s3tables:${this.aws_region}:${this.awsAccountId}:bucket/${this.s3TablesBucketName}`;
  }

  /**
   * Generate standardized Glue tables bucket name
   * Used by CDK stack to ensure consistency with runtime config
   */
  public static generateGlueTablesBucketName(account: string, region: string): string {
    return `titanic-glue-tables-${account}-${region}`;
  }

  /**
   * Generate standardized S3 Tables bucket name
   * Used by CDK stack to ensure consistency with runtime config
   */
  public static generateS3TablesBucketName(account: string, region: string): string {
    return `titanic-s3-tables-${account}-${region}`;
  }

  /**
   * Generate standardized assets bucket name
   * Used by CDK stack to ensure consistency with runtime config
   */
  public static generateAssetsBucketName(account: string, region: string): string {
    return `titanic-assets-${account}-${region}`;
  }

  /**
   * Get the namespace for S3 tables (fully-qualified with prefix)
   */
  public getNamespace(): string {
    return `${Config.S3_TABLES_PREFIX}.${this.namespace}`;
  }

  /**
   * Get the namespaced table name for the given table
   * For Glue tables: just the table name
   * For S3 tables: s3tablesbucket.namespace.tablename (literal prefix)
   */
  public getNamespacedTableName(tableName: string): string {
    if (this.useS3Table) {
      return `${this.namespace}.${tableName}`;
    } else {
      return tableName;
    }
  }

  /**
   * Generate Glue tables bucket name for this config instance
   */
  public generateGlueTablesBucketName(): string {
    return Config.generateGlueTablesBucketName(this.awsAccountId, this.aws_region);
  }

  /**
   * Generate S3 Tables bucket name for this config instance  
   */
  public generateS3TablesBucketName(): string {
    return Config.generateS3TablesBucketName(this.awsAccountId, this.aws_region);
  }

  /**
   * Generate assets bucket name for this config instance  
   */
  public generateAssetsBucketName(): string {
    return Config.generateAssetsBucketName(this.awsAccountId, this.aws_region);
  }

  /**
   * Generate S3 Tables bucket ARN for this config instance  
   */
  public generateS3TablesBucketArn(): string {
    const bucketName = this.generateS3TablesBucketName();
    return `arn:aws:s3tables:${this.aws_region}:${this.awsAccountId}:bucket/${bucketName}`;
  }

  /**
   * Generate deployment configuration for the Titanic project.
   */
  public generateDeploymentConfig(): object {
    return {
      stackName: "TitanicStack",
      account: this.awsAccountId,
      region: this.aws_region,
      athenaDatabaseName: this.athenaDatabaseName,
      quiltReadPolicyArn: this.quiltReadPolicyArn,
      useS3Table: this.useS3Table,
      buckets: {
        glueTablesBucket: this.glueTablesBucketName,
        s3TablesBucket: this.s3TablesBucketName,
        assetsBucket: Config.generateAssetsBucketName(this.awsAccountId, this.aws_region),
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

export class S3Config extends Config {
  constructor(config?: Partial<Config>) {
    super({
      ...config,
      useS3Table: true
    });
  }

  public static createTestInstance(config: Partial<Config> = {}): S3Config {
    return new S3Config(config);
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

