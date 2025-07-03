/**
 * Centralized configuration management for the Titanic project.
 * Defaults to Glue configuration with S3Config subclass for S3 tables.
 */
export class Config {
  public readonly aws_region: string;
  public readonly glueDatabaseName: string;
  public readonly glueTablesBucketArn: string;
  public readonly s3TableDatabaseName: string;
  public readonly s3TablesBucketArn: string;
  public readonly useS3Table: boolean;

  constructor(config?: Partial<Config>) {
    this.aws_region = config?.aws_region ?? (process.env.AWS_REGION || 'us-east-1');
    this.glueDatabaseName = config?.glueDatabaseName ?? (process.env.GLUE_DATABASE_NAME || 'glue_database');
    this.glueTablesBucketArn = config?.glueTablesBucketArn ?? (process.env.GLUE_TABLES_BUCKET_ARN || '');
    this.s3TableDatabaseName = config?.s3TableDatabaseName ?? (process.env.S3TABLE_DATABASE_NAME || 's3_table_database');
    this.s3TablesBucketArn = config?.s3TablesBucketArn ?? (process.env.S3_TABLES_BUCKET_ARN || '');
    this.useS3Table = config?.useS3Table ?? false;
  }
  
  // Factory method to create appropriate config type based on environment
  public static create(config?: Partial<Config>): Config {
    return process.env.USE_S3_TABLE === 'true' 
      ? new S3Config(config) 
      : new Config(config);
  }
  
  public static createTestInstance(config: Partial<Config> = {}): Config {
    return new Config(config);
  }
  
  // Glue defaults
  public getReadDatabaseName(): string {
    return this.glueDatabaseName;
  }

  public getWriteDatabaseName(): string {
    return this.glueDatabaseName;
  }
  
  public getResultsBucket(): string {
    return this.getGlueTablesBucketName();
  }

  public getTablesBucket(): string {
    return this.getGlueTablesBucketName();
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
    return { Database: this.getReadDatabaseName() };
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
   * Get Glue tables bucket name (extracted from ARN)
   */
  public getGlueTablesBucketName(): string {
    return Config.extractBucketNameFromArn(this.glueTablesBucketArn);
  }

  /**
   * Get Glue tables bucket ARN
   */
  public getGlueTablesBucketArn(): string {
    return this.glueTablesBucketArn;
  }

  /**
   * Get S3 Tables bucket name (extracted from ARN)
   */
  public getS3TablesBucketName(): string {
    return Config.extractBucketNameFromArn(this.s3TablesBucketArn);
  }

  /**
   * Get S3 Tables bucket ARN
   */
  public getS3TablesBucketArn(): string {
    return this.s3TablesBucketArn;
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

  public getTablesBucket(): string {
    return this.getS3TablesBucketName();
  }

  // Always use Glue bucket for Athena query results, even in S3Config
  public getResultsBucket(): string {
    return this.getGlueTablesBucketName();
  }

  public getS3TableCatalogName(): string {
    // For S3 Tables, Athena expects: s3tablescatalog/bucket-name
    const bucketName = this.getS3TablesBucketName();
    return `s3tablescatalog/${bucketName}`;
  }

  public createTableQuery(tableName: string, columns: string): string {
    return `
      CREATE TABLE ${tableName} (
        ${columns}
      ) LOCATION 's3://${this.getTablesBucket()}/${tableName}/'
    `;
  }

  public getExecutionContext(): { Catalog: string; Database: string } {
    return {
      Catalog: this.getS3TableCatalogName(),
      Database: this.getWriteDatabaseName()
    };
  }
}
